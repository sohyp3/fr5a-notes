import { list, parseFrontmatter, str, stringifyFrontmatter } from './frontmatter';
import { formatRecord, parseRecord, type UsageRecord } from './usage';
import type { ChatMessage } from './types';

/**
 * A harness session is a readable Markdown file in `.fr5a/sessions/`: a
 * frontmatter header plus turns separated by `<!-- turn: … -->` markers (HTML
 * comments, so the transcript still reads cleanly as Markdown and git diffs
 * stay line-based). Tool turns keep a truncated result for the record.
 */

export const SESSIONS_DIR = 'sessions';

export type TurnRole = 'you' | 'ai' | 'tool';

export interface Turn {
	role: TurnRole;
	text: string;
	/** Tool name, for `tool` turns. */
	tool?: string;
}

export interface Session {
	/** File name inside `.fr5a/sessions/`. */
	file: string;
	title: string;
	created: string;
	provider: string;
	skill: string;
	/** Note ids attached as context. */
	notes: string[];
	turns: Turn[];
	/** The workspace note this chat was saved to ("Save to notes"). */
	saved?: string;
	/** `hashText` of what was last written there, to notice edits made since. */
	savedHash?: string;
	/** Tokens and cost, one record per run (see usage.ts). */
	usage?: UsageRecord[];
}

const MARK_RE = /^<!-- turn: (you|ai|tool)(?: ([\w.-]+))? -->$/;
const TOOL_KEEP = 4000;

export function slugify(s: string): string {
	return (
		s
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'session'
	);
}

export function sessionFileName(title: string, now = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `${stamp}-${slugify(title)}.md`;
}

export function serializeSession(s: Session): string {
	const head = stringifyFrontmatter({
		title: s.title,
		created: s.created,
		provider: s.provider || undefined,
		skill: s.skill || undefined,
		notes: s.notes,
		saved: s.saved || undefined,
		savedHash: s.savedHash || undefined,
		usage: s.usage?.length ? s.usage.map(formatRecord) : undefined
	});
	const parts = s.turns.map((t) => {
		const text =
			t.role === 'tool' && t.text.length > TOOL_KEEP ? `${t.text.slice(0, TOOL_KEEP)}\n…` : t.text;
		return `<!-- turn: ${t.role}${t.tool ? ` ${t.tool}` : ''} -->\n\n${text.trim()}\n`;
	});
	return `${head}\n# ${s.title}\n\n${parts.join('\n')}`;
}

export function parseSession(file: string, text: string): Session {
	const { data, body } = parseFrontmatter(text);
	const turns: Turn[] = [];
	let cur: Turn | null = null;
	const lines: string[] = [];
	const close = () => {
		if (cur) turns.push({ ...cur, text: lines.join('\n').trim() });
		lines.length = 0;
	};
	for (const line of body.split('\n')) {
		const m = MARK_RE.exec(line);
		if (m) {
			close();
			cur = { role: m[1] as TurnRole, text: '', ...(m[2] ? { tool: m[2] } : {}) };
		} else if (cur) lines.push(line);
	}
	close();
	return {
		file,
		title: str(data.title) || file.replace(/\.md$/, ''),
		created: str(data.created),
		provider: str(data.provider),
		skill: str(data.skill),
		notes: list(data.notes),
		turns,
		...(str(data.saved) ? { saved: str(data.saved), savedHash: str(data.savedHash) } : {}),
		...(data.usage ? { usage: sessionUsage(data.usage) } : {})
	};
}

/** Usage records of a session's frontmatter (`usage: [...]`). */
export function sessionUsage(v: string | string[] | undefined): UsageRecord[] {
	return (Array.isArray(v) ? v : v ? [v] : [])
		.map(parseRecord)
		.filter((r): r is UsageRecord => r !== null);
}

/** Short, stable fingerprint of a text (FNV-1a), enough to notice a change. */
export function hashText(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return `${text.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/** Title for a copy of a session: "Plan (fork)", then "Plan (fork 2)", … */
export function forkTitle(title: string): string {
	const m = /^(.*) \(fork(?: (\d+))?\)$/.exec(title);
	if (!m) return `${title} (fork)`;
	return `${m[1]} (fork ${m[2] ? Number(m[2]) + 1 : 2})`;
}

/** Notes a conversation read with the read_note tool (from the recorded tool turns). */
export function notesRead(turns: Turn[]): string[] {
	const ids: string[] = [];
	for (const t of turns) {
		if (t.role !== 'tool' || t.tool !== 'read_note') continue;
		const m = /^\{.*?\}/.exec(t.text);
		try {
			const id = m ? (JSON.parse(m[0]) as { id?: unknown }).id : null;
			if (typeof id === 'string') ids.push(id);
		} catch {
			/* not the args line */
		}
	}
	return ids;
}

/**
 * A chat as a readable note for the workspace ("Save to notes"): title, a
 * byline, then each question as a quote followed by the reply. Tool calls
 * shrink to one line; `<!-- ai: local -->` keeps a chat about notes hidden
 * from cloud AI hidden too.
 */
export function sessionToNote(
	s: Session,
	opts: { provider?: string; local?: boolean; date?: Date } = {}
): string {
	const date = opts.date ?? (s.created ? new Date(s.created) : new Date());
	const pad = (n: number) => String(n).padStart(2, '0');
	// The local day the chat started (created is stored in UTC).
	const day = Number.isNaN(date.getTime())
		? ''
		: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	const byline = ['AI chat', day, opts.provider, s.skill ? `/${s.skill}` : '']
		.filter(Boolean)
		.join(' · ');
	const out: string[] = [];
	if (opts.local) out.push('<!-- ai: local -->');
	out.push(`# ${s.title}`, '', `*${byline}*`);
	let tools: string[] = [];
	const flushTools = () => {
		if (tools.length) out.push('', `*Used ${[...new Set(tools)].join(', ')}*`);
		tools = [];
	};
	s.turns.forEach((t, i) => {
		if (t.role === 'tool') {
			tools.push(t.tool ?? 'a tool');
			return;
		}
		flushTools();
		if (t.role === 'you') {
			if (i > 0) out.push('', '---');
			out.push(
				'',
				...t.text.split('\n').map((l, j) => (j === 0 ? `> **You:** ${l}` : `> ${l}`.trimEnd()))
			);
		} else out.push('', t.text.trim());
	});
	flushTools();
	return `${out.join('\n')}\n`;
}

/**
 * Conversation history for the model when resuming. Tool turns are folded in
 * as short user-side context (the original call ids aren't kept on disk).
 */
export function turnsToMessages(turns: Turn[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	for (const t of turns) {
		if (t.role === 'you') out.push({ role: 'user', content: t.text });
		else if (t.role === 'ai') out.push({ role: 'assistant', content: t.text });
		else out.push({ role: 'user', content: `[earlier ${t.tool ?? 'tool'} result]\n${t.text}` });
	}
	return out;
}
