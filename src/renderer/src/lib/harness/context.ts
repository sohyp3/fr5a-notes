import type { ChatMessage } from './types';
import type { Tool } from './tools';

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
- Do not change notes unless the user asked or agreed. Every AI change waits for user approval.
- When you use web sources, cite them as [title](url). Never invent sources or quotes.
- Reply in the language the user writes in. Be concise.`;

/** The provider already receives schemas; this summary follows the enabled definitions only. */
export function availableTools(tools: readonly Tool[]): string {
	return `## Available tools\n${tools.length ? tools.map((t) => `- ${t.def.name}: ${t.def.description}`).join('\n') : 'No tools are available for this run.'}`;
}

export function buildSystemPrompt(opts: {
	skillPrompt?: string;
	notes: AttachedNote[];
	noteBudget: number;
	readAll: boolean;
	currentNoteAttached: boolean;
	localProvider: boolean;
	tools: readonly Tool[];
	today?: string;
}): string {
	const parts = [BASE_PROMPT];
	if (opts.today) parts.push(`Today is ${opts.today}.`);
	parts.push(
		opts.readAll
			? 'Read all notes is enabled for this chat. Eligible workspace notes may be read.'
			: `Only ${opts.currentNoteAttached ? 'the attached open/current note and ' : ''}notes explicitly mentioned or attached in this chat are readable. ${opts.currentNoteAttached ? '' : 'The open/current note is not attached and cannot be read or changed as "current". '}Knowing a path, or seeing a note linked on a map, does not grant read access. Ask the user to mention another note with @ or enable Read all notes.`
	);
	if (opts.readAll && !opts.currentNoteAttached)
		parts.push(
			'The open/current note is not attached: it may be read by id if eligible, but cannot be changed using "current".'
		);
	const enabled = new Set(opts.tools.map((t) => t.def.name));
	if (enabled.has('list_notes') || enabled.has('search_notes'))
		parts.push('Discovery returns only eligible matches, not unrestricted full note contents.');
	if (enabled.has('write_note'))
		parts.push(
			`Read a note before editing it${enabled.has('read_note') ? '.' : ' if reading is available; otherwise ask the user for its contents.'}`
		);
	if (enabled.has('read_map'))
		parts.push(
			'A map link reveals only linked note metadata, never the note contents or permission to edit it. Read a map before proposing edits. Every map change needs approval; deleting a map also needs a separate destructive confirmation.'
		);
	parts.push(
		`Locked/encrypted protections still apply. ${opts.localProvider ? 'Local providers may read local-only notes.' : 'Local-only notes are hidden from cloud providers.'}`
	);
	parts.push(availableTools(opts.tools));
	parts.push(
		'Only the operations in Available tools can be called; task instructions do not grant additional tools. If a task needs an unavailable tool, explain the limitation.'
	);
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
