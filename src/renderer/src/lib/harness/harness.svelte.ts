import { platform } from '../platform';
import { getAppState } from '../stores/app.svelte';
import { docToText } from '../editor/markdown';
import { getAiSettings } from './config.svelte';
import { buildSystemPrompt, estimateTokens, today, type AttachedNote } from './context';
import { compactDiff, diffLines } from './diff';
import { abortable, closeCalls, runLoop } from './loop';
import { describeError } from './errors';
import { AbortError, ProviderError, chatCompletion } from './openai';
import { blockedReason } from './privacy';
import { prepareWrite, type PreparedWrite } from './apply';
import {
	DEVICE_DIR,
	forkTitle,
	hashText,
	notesRead,
	parseSession,
	serializeSession,
	sessionFileName,
	sessionPath,
	sessionToNote,
	SESSIONS_DIR,
	SESSIONS_IGNORE,
	sessionUsage,
	turnsToMessages,
	withDeviceIgnored,
	type Session,
	type Turn
} from './session';
import { cleanFolder, cleanName, remapPath } from '../../../../shared/paths';
import {
	BUILTIN_SKILLS,
	SEEDED_MARKER,
	SKILLS_DIR,
	allowedTools,
	loadSkillTree,
	serializeSkill,
	type Skill
} from './skills';
import { createTools, type WriteProposal } from './tools';
import { parseFrontmatter, str } from './frontmatter';
import { addUsage, runRecord, type ChatUsage, type Usage, type UsageRecord } from './usage';
import { expandMentions, mentionKey, parseMentions, remapKey } from './mentions';
import { fetchPage, webSearch } from './web';
import type { QuestionItem } from './questions';
import { OPENCODE_ZEN, ZEN_KEY_URL, type ChatMessage, type ProviderProfile } from './types';

/**
 * Harness runtime: tmux-like tabs, one session each. A run builds the system
 * prompt (skill + attached notes) on-device, drives the agent loop, streams
 * text into the transcript, and pauses for questions / write approvals.
 * Every session is mirrored to `.fr5a/sessions/<file>.md` after each change;
 * one that read an encrypted note to `sessions/device/` (never synced, see
 * session.ts `DEVICE_DIR`) until the user syncs it.
 */

export type Entry =
	/** `mark`: history length before this message, so Retry can rewind to it. */
	| { kind: 'you'; text: string; mark?: number }
	/** `usage`: tokens and cost of the run this reply ended (live sessions only). */
	| { kind: 'ai'; text: string; streaming: boolean; usage?: UsageRecord }
	| {
			kind: 'tool';
			/** The model's call id (live sessions only). */
			id?: string;
			name: string;
			args: string;
			result: string | null;
			/** write_note: the reviewed diff and whether it was applied. */
			write?: Approval & { applied: boolean };
	  }
	/** `status`: the provider's HTTP status, when there was one. */
	| { kind: 'error'; text: string; status?: number }
	| { kind: 'info'; text: string };

/** A pending ask_user call: one or more questions shown as one card. */
export interface Question {
	items: QuestionItem[];
}

export interface Approval {
	label: string;
	mode: WriteProposal['mode'];
	diff: ReturnType<typeof compactDiff>;
	added: number;
	removed: number;
}

const SAVE_DEBOUNCE = 400;
/** A tool result left out after the provider's content filter refused the chat with it. */
const WITHHELD =
	"Withheld: the provider's content filter refused the conversation with this result in it.";
/** Most notes inlined in one request; folder/tag mentions list the rest by id. */
const MAX_INLINE_NOTES = 25;

export class HarnessTab {
	session = $state<Session>() as Session;
	entries = $state<Entry[]>([]);
	/** Conversation sent to the model (no system message — rebuilt each run). */
	history: ChatMessage[] = [];
	running = $state(false);
	question = $state<Question | null>(null);
	approval = $state<Approval | null>(null);
	/** Attach the open note automatically. */
	useCurrent = $state(true);
	/** Mention keys attached with @: note ids, `@folder/`, `#tag` (see mentions.ts). */
	attached = $state<string[]>([]);
	providerId = $state<string | null>(null);
	skill = $state<string | null>(null);
	/** It read an encrypted note: saved in `sessions/device/`, out of sync. */
	deviceOnly = $state(false);

	private answer: ((a: string[]) => void) | null = null;
	private decide: ((ok: boolean) => void) | null = null;
	private reject: ((e: Error) => void) | null = null;
	ctl: AbortController | null = null;
	/**
	 * The last run broke off (an error, Stop): entries from here on aren't in
	 * `history`, and Retry carries on from there instead of starting over.
	 */
	resumeAt: number | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	/** Session file writes / moves, in order (a move must not race a save). */
	private writing: Promise<void> = Promise.resolve();

	constructor(session: Session, history: ChatMessage[] = [], deviceOnly = false) {
		this.session = session;
		this.history = history;
		this.deviceOnly = deviceOnly;
		this.skill = session.skill || null;
		this.providerId = session.provider || null;
		this.attached = session.notes.filter((n) => n !== getAppState().activeId);
		this.entries = session.turns.map((t): Entry =>
			t.role === 'you'
				? { kind: 'you', text: t.text }
				: t.role === 'ai'
					? { kind: 'ai', text: t.text, streaming: false }
					: { kind: 'tool', name: t.tool ?? 'tool', args: '', result: t.text }
		);
	}

	get title(): string {
		return this.session.title;
	}

	/** Its entry in a session list: the file name, under `device/` when device-only. */
	get key(): string {
		return `${this.deviceOnly ? `${DEVICE_DIR}/` : ''}${this.session.file}`;
	}

	/** Wait for the user to answer an ask_user call (one answer per question). */
	ask(q: Question): Promise<string[]> {
		this.question = q;
		return new Promise((resolve, reject) => {
			this.answer = resolve;
			this.reject = reject;
		});
	}

	reply(answers: string[]): void {
		const a = this.answer;
		this.question = null;
		this.answer = null;
		this.reject = null;
		a?.(answers);
	}

	/** Wait for the user to accept / reject a write. */
	confirm(a: Approval): Promise<boolean> {
		this.approval = a;
		return new Promise((resolve, reject) => {
			this.decide = resolve;
			this.reject = reject;
		});
	}

	settle(ok: boolean): void {
		const d = this.decide;
		this.approval = null;
		this.decide = null;
		this.reject = null;
		d?.(ok);
	}

	stop(): void {
		this.ctl?.abort();
		const r = this.reject;
		this.question = null;
		this.approval = null;
		this.answer = this.decide = this.reject = null;
		r?.(new AbortError());
	}

	/** Replace the last step's tool results (model history and their rows) with a note. */
	withholdResults(): void {
		for (let i = this.history.length - 1; i >= 0; i--) {
			const m = this.history[i];
			if (m.role !== 'tool') break;
			this.history[i] = { ...m, content: WITHHELD };
			for (let k = this.entries.length - 1; k >= 0; k--) {
				const e = this.entries[k];
				if (e.kind === 'tool' && e.id === m.tool_call_id) {
					e.result = WITHHELD;
					break;
				}
			}
		}
	}

	turns(): Turn[] {
		const out: Turn[] = [];
		for (const e of this.entries) {
			if (e.kind === 'you') out.push({ role: 'you', text: e.text });
			else if (e.kind === 'ai' && e.text.trim()) out.push({ role: 'ai', text: e.text });
			else if (e.kind === 'tool' && e.result !== null)
				out.push({ role: 'tool', tool: e.name, text: `${e.args}\n\n${e.result}`.trim() });
		}
		return out;
	}

	/** Debounced mirror of the transcript to `.fr5a/sessions/`. */
	scheduleSave(): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.save(), SAVE_DEBOUNCE);
	}

	async save(): Promise<void> {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		const turns = this.turns();
		if (!turns.length) return;
		this.session.turns = turns;
		this.session.skill = this.skill ?? '';
		this.session.provider = this.providerId ?? '';
		const text = serializeSession($state.snapshot(this.session));
		// Where it goes is decided when the write runs, after any earlier move.
		await this.queue(async () => {
			if (this.deviceOnly) await ensureDeviceIgnored();
			await platform.writeMeta(sessionPath(this.session.file, this.deviceOnly), text);
		});
	}

	/**
	 * Text from an encrypted note is about to enter the chat: from now on it's
	 * saved where sync never looks, and the synced copy (saved before) goes.
	 */
	keepOnDevice(): void {
		if (this.deviceOnly) return;
		this.deviceOnly = true;
		const file = this.session.file;
		void this.queue(() => platform.deleteMeta(sessionPath(file, false)));
	}

	/** "Sync this chat": back to the synced folder, so the next sync carries it. */
	async allowSync(): Promise<void> {
		if (!this.deviceOnly) return;
		const file = this.session.file;
		this.deviceOnly = false;
		await this.save();
		await this.queue(() => platform.deleteMeta(sessionPath(file, true)));
	}

	private queue(job: () => Promise<void>): Promise<void> {
		this.writing = this.writing
			.then(job)
			.catch((err) => console.error('[harness] session save failed', err));
		return this.writing;
	}
}

/** `sessions/.gitignore` lists the device folder before anything is written there. */
async function ensureDeviceIgnored(): Promise<void> {
	const next = withDeviceIgnored((await platform.readMeta(SESSIONS_IGNORE)) ?? '');
	if (next !== null) await platform.writeMeta(SESSIONS_IGNORE, next);
}

/** Now, as stored in a session's `created`. */
function stamp(): string {
	return new Date().toISOString();
}

function newSession(title = 'New session'): Session {
	return {
		file: sessionFileName(title),
		title,
		created: stamp(),
		provider: '',
		skill: '',
		notes: [],
		turns: []
	};
}

/** A leading `/skill` plus `@note` / `@folder/` / `@#tag` mentions (see mentions.ts). */
export function parseInput(input: string): {
	skill: string | null;
	text: string;
	mentions: string[];
} {
	let text = input.trim();
	let skill: string | null = null;
	const m = /^\/([\w-]+)\s*/.exec(text);
	if (m) {
		skill = m[1];
		text = text.slice(m[0].length);
	}
	return { skill, text, mentions: parseMentions(text).map(mentionKey) };
}

class HarnessState {
	tabs = $state<HarnessTab[]>([]);
	active = $state(0);
	skills = $state<Skill[]>([]);
	/** Recent session files, newest first. */
	sessionFiles = $state<string[]>([]);
	sessionsLoading = $state(false);
	sessionsError = $state<string | null>(null);
	ready = $state(false);

	get tab(): HarnessTab | undefined {
		return this.tabs[this.active];
	}

	async init(): Promise<void> {
		if (this.ready) return;
		// Attachments and saved-chat links follow notes / folders that move.
		getAppState().onMoved((from, to) => {
			for (const t of this.tabs) {
				t.attached = t.attached.map((k) => remapKey(k, from, to));
				const saved = t.session.saved && remapPath(t.session.saved, from, to);
				if (saved) {
					t.session.saved = saved;
					t.scheduleSave();
				}
			}
		});
		await getAiSettings().load();
		// Prices for providers that don't report a cost (models.dev, cached).
		void getAiSettings().loadPrices();
		await this.loadSkills().catch((err) => console.error('[harness] skills', err));
		await this.refreshSessions();
		if (!this.tabs.length) this.newTab();
		this.ready = true;
	}

	/**
	 * Load `.fr5a/skills/` (own files + packs cloned from git). The built-ins
	 * are written once; after that they're ordinary files you can edit/delete.
	 */
	async loadSkills(): Promise<void> {
		if ((await platform.readMeta(SEEDED_MARKER)) === null) {
			const have = await platform.listMeta(SKILLS_DIR).catch(() => [] as string[]);
			await Promise.all(
				BUILTIN_SKILLS.filter((s) => !have.includes(`${s.name}.md`)).map((s) =>
					platform.writeMeta(`${SKILLS_DIR}/${s.name}.md`, serializeSkill(s))
				)
			);
			await platform.writeMeta(SEEDED_MARKER, 'built-in skills seeded\n');
		}
		this.skills = await loadSkillTree({
			list: (rel) => platform.listMeta(rel),
			read: (rel) => platform.readMeta(rel)
		});
	}

	newTab(): void {
		this.tabs.push(new HarnessTab(newSession()));
		this.active = this.tabs.length - 1;
	}

	closeTab(i: number): void {
		const t = this.tabs[i];
		if (!t) return;
		t.stop();
		void t.save();
		this.tabs.splice(i, 1);
		if (!this.tabs.length) this.newTab();
		this.active = Math.min(this.active, this.tabs.length - 1);
	}

	/**
	 * Copy a conversation into a new tab and continue there; the original
	 * session stays as it was. The copy keeps the model history, so it picks
	 * up exactly where the original stopped.
	 */
	fork(tab = this.tab): void {
		if (!tab || tab.running || !tab.entries.length) return;
		void tab.save();
		const title = forkTitle(tab.session.title);
		const source = $state.snapshot(tab.session);
		const copy = new HarnessTab(
			{
				...source,
				file: sessionFileName(title),
				title,
				created: stamp(),
				turns: tab.turns(),
				saved: undefined,
				savedHash: undefined,
				// What the original cost stays with the original.
				usage: undefined
			},
			// Plain JSON messages: a deep copy so the two tabs never share one.
			JSON.parse(JSON.stringify(tab.history)) as ChatMessage[],
			tab.deviceOnly
		);
		// Live entries keep what the files drop (diff cards, retry marks).
		copy.entries = $state.snapshot(tab.entries) as Entry[];
		copy.attached = [...tab.attached];
		copy.useCurrent = tab.useCurrent;
		copy.skill = tab.skill;
		copy.providerId = tab.providerId;
		copy.resumeAt = tab.resumeAt;
		this.tabs.splice(this.active + 1, 0, copy);
		this.active += 1;
		void copy.save().then(() => this.refreshSessions());
	}

	/**
	 * Write the chat as a readable note in the workspace (Settings → AI →
	 * saved chats folder), so it syncs with the notes. Saving again updates
	 * that note — after asking, if it was edited since. Returns a status line.
	 */
	async saveToNotes(tab = this.tab, asNew = false): Promise<string> {
		if (!tab) return '';
		const app = getAppState();
		const ai = getAiSettings();
		const turns = tab.turns();
		if (!turns.length) throw new Error('Nothing to save yet.');
		await tab.save();
		const session = { ...$state.snapshot(tab.session), turns };
		const provider = this.providerFor(tab);
		// A local-only chat that read notes hidden from cloud AI stays hidden.
		const touched = [...session.notes, ...notesRead(turns)];
		const local =
			!!provider?.local &&
			touched.some((id) => {
				const n = app.notes.find((x) => x.id === id);
				return !!n && app.hiddenFromAi(n);
			});
		const text = sessionToNote(session, {
			provider: provider ? `${provider.name} (${provider.model})` : '',
			local
		});

		const existing = asNew ? undefined : app.notes.find((n) => n.id === tab.session.saved);
		const folder = cleanFolder(ai.config.chatsFolder ?? '');
		// A chat that read encrypted notes is saved encrypted, as is one going into an encrypted folder.
		const seal =
			!!app.vault?.hasKey &&
			(tab.deviceOnly || existing?.encrypted || (!existing && app.folderEncrypted(folder)));
		if (tab.deviceOnly && !seal) {
			const ok = await app.confirm({
				title: 'Save as plain text?',
				body: 'This chat read encrypted notes, and encryption is off now: the note is saved as plain text and syncs like any other.',
				confirm: 'Save'
			});
			if (!ok) return '';
		}
		const body = seal ? await app.vault!.encrypt(text) : text;
		let id: string;
		if (existing) {
			id = existing.id;
			if (id === app.activeId) await app.flush();
			const current = await platform.readNote(id);
			if (current === text) return `${id} is up to date`;
			if (tab.session.savedHash && hashText(current) !== tab.session.savedHash) {
				const ok = await app.confirm({
					title: 'Replace your edits?',
					body: `“${existing.title}” was edited after the chat was saved. Updating it replaces those edits with the whole chat. Cancel, then “Save as new note” to keep both.`,
					confirm: 'Replace',
					danger: true
				});
				if (!ok) return '';
			}
			await platform.writeNote(id, body);
			if (id === app.activeId) await app.reloadFromDisk();
		} else {
			const meta = await platform.createNote(cleanName(session.title) || 'AI chat', folder, body);
			id = meta.id;
		}
		tab.session.saved = id;
		tab.session.savedHash = hashText(text);
		await tab.save();
		await app.refresh();
		return existing ? `Updated ${id}` : `Saved to ${id}`;
	}

	/** Open a session by its list key (`<file>` or `device/<file>`). */
	async openSession(key: string): Promise<void> {
		const open = this.tabs.findIndex((t) => t.key === key);
		if (open !== -1) {
			this.active = open;
			return;
		}
		const text = await platform.readMeta(`${SESSIONS_DIR}/${key}`);
		if (text === null) return;
		const deviceOnly = key.startsWith(`${DEVICE_DIR}/`);
		const session = parseSession(key.slice(deviceOnly ? DEVICE_DIR.length + 1 : 0), text);
		const tab = new HarnessTab(session, turnsToMessages(session.turns), deviceOnly);
		// Reuse an untouched blank tab rather than piling up empties.
		if (this.tab && !this.tab.entries.length && !this.tab.running) this.tabs[this.active] = tab;
		else {
			this.tabs.push(tab);
			this.active = this.tabs.length - 1;
		}
	}

	/** Usage of every chat (open tabs as they are now), for the Usage window. */
	async loadUsage(): Promise<ChatUsage[]> {
		await this.refreshSessions();
		const chats = await Promise.all(
			this.sessionFiles.map(async (file): Promise<ChatUsage | null> => {
				const text = await platform.readMeta(`${SESSIONS_DIR}/${file}`).catch(() => null);
				if (!text) return null;
				const { data } = parseFrontmatter(text);
				return {
					file,
					title: str(data.title) || file.replace(/\.md$/, ''),
					records: sessionUsage(data.usage)
				};
			})
		);
		const out = chats.filter((c): c is ChatUsage => c !== null);
		for (const t of this.tabs) {
			const live = { file: t.key, title: t.title, records: t.session.usage ?? [] };
			const i = out.findIndex((c) => c.file === live.file);
			if (i === -1) out.push(live);
			else out[i] = live;
		}
		return out;
	}

	async deleteSession(key: string): Promise<void> {
		await platform.deleteMeta(`${SESSIONS_DIR}/${key}`);
		this.sessionFiles = this.sessionFiles.filter((f) => f !== key);
	}

	async refreshSessions(): Promise<void> {
		this.sessionsLoading = true;
		try {
			const [synced, device] = await Promise.all([
				platform.listMeta(SESSIONS_DIR),
				platform.listMeta(`${SESSIONS_DIR}/${DEVICE_DIR}`).catch(() => [] as string[])
			]);
			const md = (f: string) => f.endsWith('.md');
			// Device-only chats first: there are few, and they're the ones to sync or delete.
			this.sessionFiles = [
				...device.filter(md).map((f) => `${DEVICE_DIR}/${f}`),
				...synced.filter(md)
			];
			this.sessionsError = null;
		} catch (err) {
			// A missing folder just means no sessions yet.
			const msg = err instanceof Error ? err.message : String(err);
			if (/ENOENT|not exist|no such/i.test(msg)) {
				this.sessionFiles = [];
				this.sessionsError = null;
			} else this.sessionsError = msg;
		} finally {
			this.sessionsLoading = false;
		}
	}

	skill(name: string | null): Skill | null {
		return name ? (this.skills.find((s) => s.name === name) ?? null) : null;
	}

	/** The provider a tab will use: its pick, else the skill's, else the default. */
	providerFor(tab: HarnessTab): ProviderProfile | null {
		const ai = getAiSettings();
		return ai.provider(tab.providerId ?? (this.skill(tab.skill)?.provider || null));
	}

	/** Notes that will be inlined on the next send (open note first, folders/tags expanded). */
	context(tab: HarnessTab) {
		const app = getAppState();
		// Encrypted notes only while unlocked and allowed (`app.aiNotes`); see `keepOnDevice`.
		const first = tab.useCurrent && app.aiActiveId ? [app.aiActiveId] : [];
		return expandMentions(tab.attached, app.aiNotes, first, MAX_INLINE_NOTES, app.tabIds);
	}

	private async gatherNotes(tab: HarnessTab, profile: ProviderProfile): Promise<AttachedNote[]> {
		const app = getAppState();
		const ai = getAiSettings();
		const ctx = this.context(tab);
		if (ctx.missing.length) throw new Error(`Nothing matches ${ctx.missing.join(', ')}.`);
		const notes: AttachedNote[] = [];
		const skipped: string[] = [];
		const explicit = [
			...tab.attached,
			...(tab.useCurrent && app.aiActiveId ? [app.aiActiveId] : [])
		];
		for (const id of ctx.ids) {
			const content =
				id === app.activeId && app.editor ? docToText(app.editor) : await platform.readNote(id);
			const why = blockedReason(id, content, profile, ai.config);
			// A note named on its own is an error; one swept in by a folder/tag is just left out.
			if (why && explicit.includes(id))
				throw new Error(`${why} Pick a local provider or detach it.`);
			if (why) skipped.push(id);
			else {
				if (app.noteMeta(id)?.encrypted) tab.keepOnDevice();
				notes.push({ id, content });
			}
		}
		// Folder / tag mentions also get an index, so the model can read_note the rest.
		for (const g of ctx.groups) {
			const listed = g.ids.filter((id) => !skipped.includes(id));
			notes.push({
				id: `index of ${g.key}`,
				content: `${listed.length} notes match ${g.key}:\n${listed.map((id) => `- ${id}`).join('\n')}`
			});
		}
		if (ctx.omitted || skipped.length)
			tab.entries.push({
				kind: 'info',
				text: [
					ctx.omitted
						? `${ctx.omitted} more notes listed but not inlined (the model can read them).`
						: '',
					skipped.length
						? `${skipped.length} ${skipped.length === 1 ? 'note' : 'notes'} hidden from cloud AI left out for ${profile.name}.`
						: ''
				]
					.filter(Boolean)
					.join(' ')
			});
		// An unsaved draft is still "the open note".
		if (tab.useCurrent && !app.activeId && app.draft && !app.aiBlocksActive && app.editor) {
			if (app.draftEncrypted) tab.keepOnDevice();
			notes.unshift({ id: '(unsaved draft)', content: docToText(app.editor) });
		}
		return notes;
	}

	/** Rough size of what the next request would carry. */
	estimate(tab: HarnessTab): number {
		const app = getAppState();
		let n = estimateTokens(
			tab.history.map((m) => ('content' in m ? (m.content ?? '') : '')).join('\n')
		);
		if (tab.useCurrent && !app.aiBlocksActive) n += estimateTokens(app.activeContent);
		return n;
	}

	async send(input: string, tab = this.tab): Promise<void> {
		if (!tab || tab.running) return;
		const { skill: skillName, text, mentions } = parseInput(input);
		const app = getAppState();

		if (skillName) {
			if (!this.skill(skillName)) {
				tab.entries.push({ kind: 'error', text: `No skill “/${skillName}”.` });
				return;
			}
			tab.skill = skillName;
		}
		for (const key of mentions) if (!tab.attached.includes(key)) tab.attached.push(key);
		const skill = this.skill(tab.skill);
		const userText = text || (skill ? `Run /${skill.name} on the attached note.` : '');
		if (!userText) return;

		const profile = this.providerFor(tab);
		if (!profile) {
			tab.entries.push({ kind: 'error', text: 'Add an AI provider in Settings → AI first.' });
			return;
		}

		if (!tab.history.length && tab.session.title === 'New session') {
			const base = skill
				? `${skill.name} ${app.aiNotes.find((n) => n.id === app.aiActiveId)?.title ?? ''}`
				: userText;
			tab.session.title = base.trim().split('\n')[0].slice(0, 60) || 'Session';
			tab.session.file = sessionFileName(tab.session.title);
		}

		tab.entries.push({ kind: 'you', text: input.trim(), mark: tab.history.length });
		await this.run(tab, profile, userText);
	}

	/**
	 * One run of the agent loop. With `userText` it starts a new turn; with
	 * null it carries on one that broke off, from its last finished tool call.
	 */
	private async run(
		tab: HarnessTab,
		profile: ProviderProfile,
		userText: string | null
	): Promise<void> {
		const app = getAppState();
		const ai = getAiSettings();
		const skill = this.skill(tab.skill);
		const runStart = tab.entries.length;
		/** Entries up to here are in the model history (see `resumeAt`). */
		let settled = runStart;
		/** Set once the history is handed to the loop: a failure after that can be resumed. */
		let messages: ChatMessage[] | null = null;
		/** Tokens of every model call in this run (tool steps included). */
		let used: Usage | null = null;
		tab.running = true;
		tab.resumeAt = null;
		tab.ctl = new AbortController();
		const signal = tab.ctl.signal;

		// Stream batching: one DOM update per frame, not per token.
		let current: Extract<Entry, { kind: 'ai' }> | null = null;
		let pending = '';
		let frame = 0;
		const flush = () => {
			frame = 0;
			if (current && pending) current.text += pending;
			pending = '';
		};
		const startAi = () => {
			tab.entries.push({ kind: 'ai', text: '', streaming: true });
			current = tab.entries[tab.entries.length - 1] as Extract<Entry, { kind: 'ai' }>;
		};

		try {
			const [notes, apiKey, searchKey] = await abortable(
				Promise.all([
					this.gatherNotes(tab, profile),
					ai.apiKey(profile.id),
					ai.searchKey(ai.config.search?.kind)
				]),
				signal
			);
			if (!apiKey && !profile.local)
				throw new Error(
					profile.id === OPENCODE_ZEN.id
						? `${profile.name} needs a free API key: get one at ${ZEN_KEY_URL}, then paste it in Settings → AI → Edit.`
						: `${profile.name} has no API key. Add it in Settings → AI → Edit, or mark the provider as local.`
				);
			tab.session.notes = [
				...(app.aiActiveId && tab.useCurrent ? [app.aiActiveId] : []),
				...tab.attached
			];
			const system = buildSystemPrompt({
				skillPrompt: skill?.prompt,
				notes,
				noteBudget: Math.floor(profile.contextTokens * 0.5),
				today: today()
			});
			// A new message answers calls a stopped run left open (the API wants one result each).
			if (userText !== null)
				tab.history = [...closeCalls(tab.history), { role: 'user', content: userText }];
			messages = [{ role: 'system', content: system }, ...tab.history];

			const search = ai.config.search;
			const tools = allowedTools(
				skill,
				createTools({
					profile,
					config: ai.config,
					notes: () => app.aiNotes,
					readNote: (id) => {
						if (app.noteMeta(id)?.encrypted) tab.keepOnDevice();
						return platform.readNote(id);
					},
					ask: (items) => tab.ask({ items }),
					proposeWrite: (p) => this.reviewWrite(tab, p),
					search: search ? (q) => webSearch(platform, search, searchKey, q) : undefined,
					fetchPage: search ? (url) => fetchPage(platform, url) : undefined
				}),
				(t) => t.def.name
			);

			const outcome = await runLoop({
				profile,
				messages,
				tools,
				maxSteps: ai.config.maxSteps,
				signal,
				complete: async (req) => {
					startAi();
					const res = await chatCompletion(platform, { ...req, profile, apiKey });
					if (res.usage) used = addUsage(used, res.usage);
					return res;
				},
				onDelta: (t) => {
					// A request that outlives Stop may still stream a little.
					if (signal.aborted) return;
					pending += t;
					if (!frame) frame = requestAnimationFrame(flush);
				},
				onAssistant: (content) => {
					cancelAnimationFrame(frame);
					frame = 0;
					if (current) {
						current.text = content;
						current.streaming = false;
						if (!content.trim()) tab.entries.splice(tab.entries.indexOf(current), 1);
					}
					pending = '';
					current = null;
					settled = tab.entries.length;
					tab.scheduleSave();
				},
				onToolStart: (call) => {
					tab.entries.push({
						kind: 'tool',
						id: call.id,
						name: call.name,
						args: call.arguments,
						result: null
					});
				},
				onToolResult: (call, result) => {
					for (let i = tab.entries.length - 1; i >= 0; i--) {
						const e = tab.entries[i];
						if (e.kind === 'tool' && e.id === call.id && e.result === null) {
							e.result = result;
							break;
						}
					}
					settled = tab.entries.length;
					tab.scheduleSave();
				}
			});
			tab.history = messages.slice(1);
			if (outcome === 'max-steps')
				tab.entries.push({
					kind: 'info',
					text: `Stopped after ${ai.config.maxSteps} steps. Send “continue” to keep going.`
				});
		} catch (err) {
			cancelAnimationFrame(frame);
			const c = current as Extract<Entry, { kind: 'ai' }> | null;
			if (c) {
				c.streaming = false;
				if (!c.text.trim()) tab.entries.splice(tab.entries.indexOf(c), 1);
			}
			// Keep what finished (answers, tool results) so Retry carries on from there.
			if (messages) tab.history = messages.slice(1);
			if (messages || userText === null) tab.resumeAt = Math.min(settled, tab.entries.length);
			if (err instanceof AbortError) tab.entries.push({ kind: 'info', text: 'Stopped.' });
			else
				tab.entries.push({
					kind: 'error',
					text: err instanceof Error ? err.message : String(err),
					...(err instanceof ProviderError && err.status ? { status: err.status } : {})
				});
		} finally {
			for (const e of tab.entries)
				if (e.kind === 'tool' && e.result === null) e.result = '(cancelled)';
			tab.running = false;
			tab.ctl = null;
			// Calls that finished cost money even when the run failed or was stopped.
			if (used) {
				const record = runRecord(used, profile, ai.priced(profile.id, profile.model));
				tab.session.usage = [...(tab.session.usage ?? []), record];
				for (let i = tab.entries.length - 1; i >= runStart; i--) {
					const e = tab.entries[i];
					if (e.kind === 'ai') {
						e.usage = record;
						break;
					}
				}
			}
			await tab.save();
			void this.refreshSessions();
		}
	}

	/**
	 * Retry. A run that broke off (a network or provider error, Stop) carries
	 * on from its last finished tool call, so answers already given stay; a
	 * question or change it was waiting on comes back. After a finished reply,
	 * the last message runs again for a fresh answer.
	 */
	async retry(tab = this.tab): Promise<void> {
		if (!tab || tab.running) return;
		if (tab.resumeAt !== null) {
			const profile = this.providerFor(tab);
			if (!profile) {
				tab.entries.push({ kind: 'error', text: 'Add an AI provider in Settings → AI first.' });
				return;
			}
			const last = tab.entries[tab.entries.length - 1];
			// Sending the same thing again would trip the same filter: leave the latest results out.
			const filtered =
				last?.kind === 'error' && describeError(last.text, last.status).kind === 'content';
			// The error / "Stopped." note and whatever the history doesn't have (a cut-off reply).
			tab.entries.splice(tab.resumeAt);
			if (filtered) tab.withholdResults();
			await this.run(tab, profile, null);
			return;
		}
		let i = tab.entries.length - 1;
		while (i >= 0 && tab.entries[i].kind !== 'you') i--;
		if (i < 0) return;
		const you = tab.entries[i] as Extract<Entry, { kind: 'you' }>;
		let mark = you.mark;
		if (mark === undefined) {
			// Reopened sessions carry no marks: rewind to the last user message.
			mark = tab.history.length;
			while (mark > 0 && tab.history[mark - 1].role !== 'user') mark--;
			mark = Math.max(0, mark - 1);
		}
		tab.entries.splice(i);
		tab.history = tab.history.slice(0, mark);
		await this.send(you.text, tab);
	}

	/** write_note: show the diff card, apply on approval. */
	private async reviewWrite(tab: HarnessTab, p: WriteProposal): Promise<string> {
		let prepared: PreparedWrite;
		try {
			prepared = await prepareWrite(p);
		} catch (err) {
			return `Not written: ${err instanceof Error ? err.message : String(err)}`;
		}
		const lines = diffLines(prepared.before, prepared.after);
		const approval: Approval = {
			label: prepared.label,
			mode: p.mode,
			diff: compactDiff(lines),
			added: lines.filter((l) => l.op === 'add').length,
			removed: lines.filter((l) => l.op === 'del').length
		};
		const ok = await tab.confirm(approval);
		// Keep the reviewed diff on the tool row, so the transcript shows what changed.
		let row: Extract<Entry, { kind: 'tool' }> | null = null;
		for (let i = tab.entries.length - 1; i >= 0 && !row; i--) {
			const e = tab.entries[i];
			if (e.kind === 'tool' && e.name === 'write_note' && e.result === null) row = e;
		}
		if (row) row.write = { ...approval, applied: ok };
		if (!ok) return 'The user rejected this change. Ask what they want instead.';
		try {
			return await prepared.apply();
		} catch (err) {
			if (row?.write) row.write.applied = false;
			return `Not written: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	/** Manual action on an AI reply (user clicked, so no approval card). */
	async applyText(text: string, mode: 'insert' | 'append' | 'new'): Promise<string> {
		const prepared = await prepareWrite(
			mode === 'new'
				? { target: 'new', mode: 'append', content: text }
				: { target: 'current', mode, content: text }
		);
		return prepared.apply();
	}
}

let instance: HarnessState | null = null;

export function getHarness(): HarnessState {
	return (instance ??= new HarnessState());
}

export type { HarnessState };
