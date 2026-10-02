import { list, parseFrontmatter, str, stringifyFrontmatter } from './frontmatter';
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
		notes: s.notes
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
		turns
	};
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
