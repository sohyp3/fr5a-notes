import { platform } from '../platform';
import { getAppState } from '../stores/app.svelte';
import { docToText } from '../editor/markdown';
import { getAiSettings } from './config.svelte';
import { buildSystemPrompt, estimateTokens, today, type AttachedNote } from './context';
import { compactDiff, diffLines } from './diff';
import { runLoop } from './loop';
import { AbortError, ProviderError, chatCompletion } from './openai';
import { blockedReason } from './privacy';
import { prepareWrite, type PreparedWrite } from './apply';
import {
	parseSession,
	serializeSession,
	sessionFileName,
	SESSIONS_DIR,
	turnsToMessages,
	type Session,
	type Turn
} from './session';
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
import { expandMentions, mentionKey, parseMentions } from './mentions';
import { fetchPage, webSearch } from './web';
import type { QuestionItem } from './questions';
import { OPENCODE_ZEN, ZEN_KEY_URL, type ChatMessage, type ProviderProfile } from './types';

/**
 * Harness runtime: tmux-like tabs, one session each. A run builds the system
 * prompt (skill + attached notes) on-device, drives the agent loop, streams
 * text into the transcript, and pauses for questions / write approvals.
 * Every session is mirrored to `.fr5a/sessions/<file>.md` after each change.
 */

export type Entry =
	/** `mark`: history length before this message, so Retry can rewind to it. */
	| { kind: 'you'; text: string; mark?: number }
	| { kind: 'ai'; text: string; streaming: boolean }
	| {
			kind: 'tool';
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

	private answer: ((a: string[]) => void) | null = null;
	private decide: ((ok: boolean) => void) | null = null;
	private reject: ((e: Error) => void) | null = null;
	ctl: AbortController | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(session: Session, history: ChatMessage[] = []) {
		this.session = session;
		this.history = history;
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
		await platform
			.writeMeta(
				`${SESSIONS_DIR}/${this.session.file}`,
				serializeSession($state.snapshot(this.session))
			)
			.catch((err) => console.error('[harness] session save failed', err));
	}
}

function newSession(title = 'New session'): Session {
	return {
		file: sessionFileName(title),
		title,
		created: new Date().toISOString(),
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
		await getAiSettings().load();
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

	async openSession(file: string): Promise<void> {
		const open = this.tabs.findIndex((t) => t.session.file === file);
		if (open !== -1) {
			this.active = open;
			return;
		}
		const text = await platform.readMeta(`${SESSIONS_DIR}/${file}`);
		if (text === null) return;
		const session = parseSession(file, text);
		const tab = new HarnessTab(session, turnsToMessages(session.turns));
		// Reuse an untouched blank tab rather than piling up empties.
		if (this.tab && !this.tab.entries.length && !this.tab.running) this.tabs[this.active] = tab;
		else {
			this.tabs.push(tab);
			this.active = this.tabs.length - 1;
		}
	}

	async deleteSession(file: string): Promise<void> {
		await platform.deleteMeta(`${SESSIONS_DIR}/${file}`);
		this.sessionFiles = this.sessionFiles.filter((f) => f !== file);
	}

	async refreshSessions(): Promise<void> {
		this.sessionsLoading = true;
		try {
			const entries = await platform.listMeta(SESSIONS_DIR);
			this.sessionFiles = entries.filter((f) => f.endsWith('.md'));
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
		const first = tab.useCurrent && app.activeId ? [app.activeId] : [];
		return expandMentions(tab.attached, app.notes, first, MAX_INLINE_NOTES);
	}

	private async gatherNotes(tab: HarnessTab, profile: ProviderProfile): Promise<AttachedNote[]> {
		const app = getAppState();
		const ai = getAiSettings();
		const ctx = this.context(tab);
		if (ctx.missing.length) throw new Error(`Nothing matches ${ctx.missing.join(', ')}.`);
		const notes: AttachedNote[] = [];
		const skipped: string[] = [];
		const explicit = [...tab.attached, ...(tab.useCurrent && app.activeId ? [app.activeId] : [])];
		for (const id of ctx.ids) {
			const content =
				id === app.activeId && app.editor ? docToText(app.editor) : await platform.readNote(id);
			const why = blockedReason(id, content, profile, ai.config);
			// A note named on its own is an error; one swept in by a folder/tag is just left out.
			if (why && explicit.includes(id))
				throw new Error(`${why} Pick a local provider or detach it.`);
			if (why) skipped.push(id);
			else notes.push({ id, content });
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
					skipped.length ? `${skipped.length} local-only notes left out for ${profile.name}.` : ''
				]
					.filter(Boolean)
					.join(' ')
			});
		// An unsaved draft is still "the open note".
		if (tab.useCurrent && !app.activeId && app.draft && app.editor)
			notes.unshift({ id: '(unsaved draft)', content: docToText(app.editor) });
		return notes;
	}

	/** Rough size of what the next request would carry. */
	estimate(tab: HarnessTab): number {
		const app = getAppState();
		let n = estimateTokens(
			tab.history.map((m) => ('content' in m ? (m.content ?? '') : '')).join('\n')
		);
		if (tab.useCurrent) n += estimateTokens(app.activeContent);
		return n;
	}

	async send(input: string): Promise<void> {
		const tab = this.tab;
		if (!tab || tab.running) return;
		const { skill: skillName, text, mentions } = parseInput(input);
		const app = getAppState();
		const ai = getAiSettings();

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
				? `${skill.name} ${app.notes.find((n) => n.id === app.activeId)?.title ?? ''}`
				: userText;
			tab.session.title = base.trim().split('\n')[0].slice(0, 60) || 'Session';
			tab.session.file = sessionFileName(tab.session.title);
		}

		tab.entries.push({ kind: 'you', text: input.trim(), mark: tab.history.length });
		tab.running = true;
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
			const [notes, apiKey, searchKey] = await Promise.all([
				this.gatherNotes(tab, profile),
				ai.apiKey(profile.id),
				ai.searchKey(ai.config.search?.kind)
			]);
			if (!apiKey && !profile.local)
				throw new Error(
					profile.id === OPENCODE_ZEN.id
						? `${profile.name} needs a free API key: get one at ${ZEN_KEY_URL}, then paste it in Settings → AI → Edit.`
						: `${profile.name} has no API key. Add it in Settings → AI → Edit, or mark the provider as local.`
				);
			tab.session.notes = [
				...(app.activeId && tab.useCurrent ? [app.activeId] : []),
				...tab.attached
			];
			const system = buildSystemPrompt({
				skillPrompt: skill?.prompt,
				notes,
				noteBudget: Math.floor(profile.contextTokens * 0.5),
				today: today()
			});
			tab.history.push({ role: 'user', content: userText });
			const messages: ChatMessage[] = [{ role: 'system', content: system }, ...tab.history];

			const search = ai.config.search;
			const tools = allowedTools(
				skill,
				createTools({
					profile,
					config: ai.config,
					notes: () => app.notes,
					readNote: (id) => platform.readNote(id),
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
				complete: (req) => {
					startAi();
					return chatCompletion(platform, { ...req, profile, apiKey });
				},
				onDelta: (t) => {
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
					tab.scheduleSave();
				},
				onToolStart: (call) => {
					tab.entries.push({ kind: 'tool', name: call.name, args: call.arguments, result: null });
				},
				onToolResult: (call, result) => {
					for (let i = tab.entries.length - 1; i >= 0; i--) {
						const e = tab.entries[i];
						if (e.kind === 'tool' && e.name === call.name && e.result === null) {
							e.result = result;
							break;
						}
					}
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
			await tab.save();
			void this.refreshSessions();
		}
	}

	/**
	 * Run the last message again — after a network error, a stop, or for a
	 * fresh answer. Rewinds the transcript and model history to just before it.
	 */
	async retry(tab = this.tab): Promise<void> {
		if (!tab || tab.running) return;
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
		await this.send(you.text);
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
