import type { ChatMessage } from './types';

/** Rough token estimate (~4 chars/token; denser for non-Latin scripts). */
export function estimateTokens(text: string): number {
	let ascii = 0;
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
	return Math.ceil(ascii / 4 + (text.length - ascii) / 2);
}

export function messageTokens(m: ChatMessage): number {
	const calls = m.role === 'assistant' ? (m.tool_calls ?? []) : [];
	return (
		4 +
		estimateTokens(m.content ?? '') +
		calls.reduce((n, c) => n + estimateTokens(c.name + c.arguments), 0)
	);
}

/** Cut text to roughly `maxTokens`, marking the cut. */
export function truncateToTokens(text: string, maxTokens: number): string {
	if (estimateTokens(text) <= maxTokens) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (estimateTokens(text.slice(0, mid)) <= maxTokens) lo = mid;
		else hi = mid - 1;
	}
	return `${text.slice(0, lo)}\n\n[… truncated to fit the context window]`;
}

/**
 * Keep the system message(s) and as many recent messages as fit `budget`.
 * Never starts the kept history on an orphaned tool result.
 */
export function fitHistory(messages: ChatMessage[], budget: number): ChatMessage[] {
	const system = messages.filter((m) => m.role === 'system');
	const rest = messages.filter((m) => m.role !== 'system');
	let used = system.reduce((n, m) => n + messageTokens(m), 0);
	let start = rest.length;
	while (start > 0) {
		const cost = messageTokens(rest[start - 1]);
		if (used + cost > budget && start < rest.length) break;
		used += cost;
		start--;
	}
	while (start < rest.length && rest[start].role === 'tool') start++;
	return [...system, ...rest.slice(start)];
}

export interface AttachedNote {
	id: string;
	content: string;
}

export const BASE_PROMPT = `You are the writing and thinking assistant inside fr5a, a Markdown notes app. You work on the user's own notes.
- Notes are plain Markdown files; refer to them by id (their path).
- When a decision is genuinely the user's, use ask_user with 2-4 short, concrete options rather than guessing. Put related questions in one ask_user call; they are shown together.
- Only change notes through write_note, and only when the user asked or agreed. The user approves every write.
- When you use web sources, cite them as [title](url). Never invent sources or quotes.
- Reply in the language the user writes in. Be concise.`;

export function buildSystemPrompt(opts: {
	skillPrompt?: string;
	notes: AttachedNote[];
	noteBudget: number;
	today?: string;
}): string {
	const parts = [BASE_PROMPT];
	if (opts.today) parts.push(`Today is ${opts.today}.`);
	if (opts.skillPrompt) parts.push(`## Task\n${opts.skillPrompt}`);
	if (opts.notes.length) {
		const each = Math.max(500, Math.floor(opts.noteBudget / opts.notes.length));
		parts.push(
			'## Attached notes\n' +
				opts.notes
					.map((n) => `<note id="${n.id}">\n${truncateToTokens(n.content, each)}\n</note>`)
					.join('\n\n')
		);
	}
	return parts.join('\n\n');
}

/** Local date as YYYY-MM-DD, for the system prompt. */
export function today(now = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
