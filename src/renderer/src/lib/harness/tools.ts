import type { NoteMeta } from '../../../../shared/types';
import { blockedReason } from './privacy';
import { formatResults, type SearchResult } from './web';
import {
	ASK_USER_PARAMETERS,
	formatAnswers,
	normalizeQuestions,
	type QuestionItem
} from './questions';
import type { AiConfig, ProviderProfile, ToolDef } from './types';

/**
 * The harness tools. Each runs on-device against injected deps, so the same
 * code drives the desktop and Android UIs and the unit tests. Writes are only
 * ever *proposed*: the UI shows a diff and the user decides.
 */

export type WriteMode = 'append' | 'replace' | 'insert';

export interface WriteProposal {
	/** 'current' (open note), 'new', or a note id. */
	target: string;
	mode: WriteMode;
	content: string;
	/** Title for a new note. */
	title?: string;
}

export interface ToolDeps {
	profile: ProviderProfile;
	config: AiConfig;
	notes(): NoteMeta[];
	readNote(id: string): Promise<string>;
	/** One answer per question (several picks joined with ", "). */
	ask(questions: QuestionItem[]): Promise<string[]>;
	/** Resolves with what happened, e.g. "Applied to x.md" or "Rejected by the user". */
	proposeWrite(p: WriteProposal): Promise<string>;
	/** Absent when no search provider is configured. */
	search?(query: string): Promise<SearchResult[]>;
	fetchPage?(url: string): Promise<string>;
}

export interface Tool {
	def: ToolDef;
	run(args: Record<string, unknown>): Promise<string>;
}

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function scoreNote(n: NoteMeta, terms: string[]): number {
	const title = n.title.toLowerCase();
	const hay = `${n.id} ${n.snippet} ${n.tags.join(' ')}`.toLowerCase();
	let score = 0;
	for (const t of terms) {
		if (title.includes(t)) score += 3;
		else if (hay.includes(t)) score += 1;
		else return 0;
	}
	return score;
}

export function createTools(d: ToolDeps): Tool[] {
	const tools: Tool[] = [
		{
			def: {
				name: 'read_note',
				description: 'Read the full Markdown of a note by id (its workspace-relative path).',
				parameters: {
					type: 'object',
					properties: { id: { type: 'string', description: 'Note id, e.g. "drafts/post.md"' } },
					required: ['id']
				}
			},
			async run(a) {
				const id = s(a.id);
				if (!d.notes().some((n) => n.id === id))
					return `No note with id "${id}". Use list_notes or search_notes.`;
				const content = await d.readNote(id);
				return blockedReason(id, content, d.profile, d.config) ?? content;
			}
		},
		{
			def: {
				name: 'list_notes',
				description: 'List notes (id, title, tags), optionally only inside a folder.',
				parameters: {
					type: 'object',
					properties: { folder: { type: 'string', description: 'Folder path; omit for all' } }
				}
			},
			async run(a) {
				const folder = s(a.folder).replace(/^\/+|\/+$/g, '');
				const rows = d
					.notes()
					.filter((n) => !folder || n.id.startsWith(`${folder}/`))
					.slice(0, 200)
					.map((n) => `- ${n.id} — ${n.title}${n.tags.length ? ` (#${n.tags.join(' #')})` : ''}`);
				return rows.length ? rows.join('\n') : 'No notes.';
			}
		},
		{
			def: {
				name: 'search_notes',
				description: "Search the user's notes by words in the title, path, tags or opening text.",
				parameters: {
					type: 'object',
					properties: { query: { type: 'string' } },
					required: ['query']
				}
			},
			async run(a) {
				const terms = s(a.query).toLowerCase().split(/\s+/).filter(Boolean);
				if (!terms.length) return 'Empty query.';
				const hits = d
					.notes()
					.map((n) => ({ n, score: scoreNote(n, terms) }))
					.filter((h) => h.score > 0)
					.sort((x, y) => y.score - x.score)
					.slice(0, 15);
				return hits.length
					? hits.map(({ n }) => `- ${n.id} — ${n.title}: ${n.snippet.slice(0, 100)}`).join('\n')
					: 'No matching notes.';
			}
		},
		{
			def: {
				name: 'ask_user',
				description:
					'Ask the user and wait for the answers. Group related questions in one call (up to 4), each with 2-4 short, concrete options (label + optional description); the user can always type their own answer. Set multiSelect when several options may apply.',
				parameters: ASK_USER_PARAMETERS
			},
			async run(a) {
				const items = normalizeQuestions(a);
				if (!items.length) return 'No question given. Pass questions: [{question, options}].';
				return formatAnswers(items, await d.ask(items));
			}
		},
		{
			def: {
				name: 'write_note',
				description:
					'Propose a change to a note. The user sees a diff and approves or rejects it. target: "current" (open note), "new", or a note id. mode: append (end of note), insert (at the cursor, current note only), replace (whole note).',
				parameters: {
					type: 'object',
					properties: {
						target: { type: 'string' },
						mode: { type: 'string', enum: ['append', 'insert', 'replace'] },
						content: { type: 'string', description: 'Markdown to write' },
						title: { type: 'string', description: 'Title when target is "new"' }
					},
					required: ['target', 'mode', 'content']
				}
			},
			async run(a) {
				const mode = (
					['append', 'insert', 'replace'].includes(s(a.mode)) ? s(a.mode) : 'append'
				) as WriteMode;
				const target = s(a.target) || 'current';
				if (target !== 'current' && target !== 'new' && !d.notes().some((n) => n.id === target))
					return `No note with id "${target}".`;
				return d.proposeWrite({
					target,
					mode,
					content: s(a.content),
					title: s(a.title) || undefined
				});
			}
		}
	];

	if (d.search) {
		const search = d.search;
		tools.push({
			def: {
				name: 'web_search',
				description: 'Search the web. Returns titles, URLs and snippets.',
				parameters: {
					type: 'object',
					properties: { query: { type: 'string' } },
					required: ['query']
				}
			},
			async run(a) {
				return formatResults(await search(s(a.query)));
			}
		});
	}
	if (d.fetchPage) {
		const fetchPage = d.fetchPage;
		tools.push({
			def: {
				name: 'fetch_url',
				description: 'Fetch a web page and return its readable text (truncated).',
				parameters: {
					type: 'object',
					properties: { url: { type: 'string' } },
					required: ['url']
				}
			},
			async run(a) {
				return fetchPage(s(a.url));
			}
		});
	}
	return tools;
}
