import type { NoteMeta } from '../../../../shared/types';
import { blockedReason, isHidden } from './privacy';
import { formatResults, type SearchResult } from './web';
import {
	ASK_USER_PARAMETERS,
	formatAnswers,
	normalizeQuestions,
	type QuestionItem
} from './questions';
import type { AiConfig, ProviderProfile, ToolDef } from './types';
import { allowedTools, type Skill } from './skills';
import { validMapName } from './mapTools';

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

export interface EditProposal {
	target: string;
	oldText: string;
	newText: string;
}

export interface ToolDeps {
	profile: ProviderProfile;
	config: AiConfig;
	notes(): NoteMeta[];
	/** Mentioned/attached note ids, or null when this chat may read every note. */
	allowedNoteIds: ReadonlySet<string> | null;
	readNote(id: string): Promise<string>;
	/** One answer per question (several picks joined with ", "). */
	ask(questions: QuestionItem[]): Promise<string[]>;
	/** Resolves with what happened, e.g. "Applied to x.md" or "Rejected by the user". */
	proposeWrite(p: WriteProposal): Promise<string>;
	proposeEdit?(p: EditProposal): Promise<string>;
	proposeDelete?(id: string): Promise<string>;
	maps?: {
		list(): Promise<string[]>;
		read(name: string): Promise<string>;
		create(name: string, patch?: unknown): Promise<string>;
		edit(name: string, patch: unknown): Promise<string>;
		delete(name: string): Promise<string>;
	};
	/** Absent when no search provider is configured. */
	search?(query: string): Promise<SearchResult[]>;
	fetchPage?(url: string): Promise<string>;
}

export interface Tool {
	def: ToolDef;
	run(args: Record<string, unknown>): Promise<string>;
}

/** Exactly the tools handed to the model and accepted by the loop for this run. */
export function toolsForRun(skill: Skill | null, deps: ToolDeps): Tool[] {
	return deps.profile.tools ? allowedTools(skill, createTools(deps), (tool) => tool.def.name) : [];
}

/** "current" is a chat attachment, not a bypass around note permissions. */
export function canWriteCurrent(
	useCurrent: boolean,
	current: { id: string | null } | null
): boolean {
	return useCurrent && current !== null;
}

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

const MAP_PATCH_SYNTAX =
	'JSON Canvas patch: nodes and edges are upsert arrays (existing ids update, new ids add); removeNodes and removeEdges are arrays of existing ids. New nodes need unique nonempty id, type, finite numeric x and y; use type "text" with text for concepts, or type "file" with file set to an existing workspace-relative note id. Optional width/height are positive numbers (defaults: 200/60); tag nodes are type "text" with fr5a: {tag: "tag-name"}. New edges need unique nonempty id, fromNode and toNode set to node ids on this map (including nodes added in the same patch). Use JSON Canvas fields x/y and fromNode/toNode, NOT Svelte Flow position/source/target. Example: {"nodes":[{"id":"idea","type":"text","text":"Idea","x":0,"y":0},{"id":"plan","type":"text","text":"Plan","x":280,"y":0}],"edges":[{"id":"idea-plan","fromNode":"idea","toNode":"plan"}]}. Updates to existing nodes/edges may include only id and fields being changed. Removing a node also requires removing its connected edges.';

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
	const canRead = (id: string) => d.allowedNoteIds === null || d.allowedNoteIds.has(id);
	const readableNotes = () =>
		d
			.notes()
			.filter((n) => canRead(n.id) && (d.profile.local || !isHidden(n, d.config.localOnlyFolders)));
	const restricted = d.allowedNoteIds !== null;
	const eligible = (id: string): string | null => {
		if (!canRead(id))
			return `Cannot change "${id}": it wasn't mentioned or attached in this chat. Ask the user to mention it with @, or enable Read all notes.`;
		const note = d.notes().find((n) => n.id === id);
		if (!note) return `No note with id "${id}".`;
		if (note.locked || note.encrypted) return `Cannot change "${id}": it is locked or encrypted.`;
		if (!d.profile.local && isHidden(note, d.config.localOnlyFolders))
			return `Cannot change "${id}": it is hidden from cloud AI.`;
		return null;
	};
	const tools: Tool[] = [
		{
			def: {
				name: 'read_note',
				description: restricted
					? 'Read the full Markdown of a note that the user attached or mentioned, by id (its workspace-relative path).'
					: 'Read the full Markdown of any note by id (its workspace-relative path).',
				parameters: {
					type: 'object',
					properties: { id: { type: 'string', description: 'Note id, e.g. "drafts/post.md"' } },
					required: ['id']
				}
			},
			async run(a) {
				const id = s(a.id);
				if (!canRead(id))
					return `Cannot read "${id}": it wasn't mentioned or attached in this chat. Ask the user to mention it with @, or ask them to turn on Read all notes.`;
				const note = d.notes().find((n) => n.id === id);
				if (note && !d.profile.local && isHidden(note, d.config.localOnlyFolders))
					return blockedReason(id, null, d.profile, d.config) ?? `"${id}" is hidden from cloud AI.`;
				if (!readableNotes().some((n) => n.id === id))
					return `No note with id "${id}". Use list_notes or search_notes.`;
				const content = await d.readNote(id);
				return blockedReason(id, content, d.profile, d.config) ?? content;
			}
		},
		{
			def: {
				name: 'list_notes',
				description: restricted
					? 'List eligible attached or mentioned notes by id, title and tags, optionally in a folder; not full contents.'
					: 'List eligible workspace notes by id, title and tags, optionally in a folder; not full contents.',
				parameters: {
					type: 'object',
					properties: { folder: { type: 'string', description: 'Folder path; omit for all' } }
				}
			},
			async run(a) {
				const folder = s(a.folder).replace(/^\/+|\/+$/g, '');
				const rows = readableNotes()
					.filter((n) => !folder || n.id.startsWith(`${folder}/`))
					.slice(0, 200)
					.map((n) => `- ${n.id} — ${n.title}${n.tags.length ? ` (#${n.tags.join(' #')})` : ''}`);
				return rows.length ? rows.join('\n') : 'No notes.';
			}
		},
		{
			def: {
				name: 'search_notes',
				description: restricted
					? 'Search eligible attached or mentioned notes by title, path, tags or opening snippet; returns matches, not full contents.'
					: 'Search eligible workspace notes by title, path, tags or opening snippet; returns matches, not full contents.',
				parameters: {
					type: 'object',
					properties: { query: { type: 'string' } },
					required: ['query']
				}
			},
			async run(a) {
				const terms = s(a.query).toLowerCase().split(/\s+/).filter(Boolean);
				if (!terms.length) return 'Empty query.';
				const hits = readableNotes()
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
					'Propose an approved note change after reading the note. The user reviews a diff. target: "current" (only if the open note is attached), "new", or an eligible note id. mode: append (end), insert (at cursor, current only), replace (whole note).',
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
				if (target !== 'current' && target !== 'new') {
					const reason = eligible(target);
					if (reason) return reason;
				}
				return d.proposeWrite({
					target,
					mode,
					content: s(a.content),
					title: s(a.title) || undefined
				});
			}
		},
		...(d.proposeEdit
			? [
					{
						def: {
							name: 'edit_note',
							description:
								'Propose a precise edit to an eligible note after reading it. Replace exactly one occurrence of oldText with newText; ambiguous or missing text is rejected. The user reviews a diff and must approve. target is a note id or "current" for an attached open note.',
							parameters: {
								type: 'object',
								properties: {
									target: { type: 'string' },
									oldText: { type: 'string' },
									newText: { type: 'string' }
								},
								required: ['target', 'oldText', 'newText']
							}
						},
						async run(a: Record<string, unknown>) {
							const target = s(a.target);
							if (target !== 'current') {
								const reason = eligible(target);
								if (reason) return reason;
							}
							if (!target || !s(a.oldText) || typeof a.newText !== 'string')
								return 'Not edited: target, nonempty oldText and newText are required.';
							return d.proposeEdit!({ target, oldText: s(a.oldText), newText: a.newText });
						}
					} satisfies Tool
				]
			: []),
		...(d.proposeDelete
			? [
					{
						def: {
							name: 'delete_note',
							description:
								'Propose moving an eligible note to Trash. Requires approval and a separate destructive confirmation; it can be restored from Trash. Pass its exact note id (not "current").',
							parameters: {
								type: 'object',
								properties: { id: { type: 'string' } },
								required: ['id']
							}
						},
						async run(a: Record<string, unknown>) {
							const id = s(a.id);
							const reason = eligible(id);
							return reason ?? d.proposeDelete!(id);
						}
					} satisfies Tool
				]
			: [])
	];
	if (d.maps) {
		const maps = d.maps;
		const checked = async (name: unknown, action: (name: string) => Promise<string>) => {
			try {
				return await action(validMapName(s(name)));
			} catch (err) {
				return `Map operation failed: ${err instanceof Error ? err.message : String(err)}`;
			}
		};
		tools.push(
			{
				def: {
					name: 'list_maps',
					description: 'List saved mind map names (not note contents). Mind maps must be enabled.',
					parameters: { type: 'object', properties: {} }
				},
				run: () => maps.list().then((names) => JSON.stringify(names))
			},
			{
				def: {
					name: 'read_map',
					description:
						'Read a map as structured node ids, labels, linked note ids and edges. Linked notes are metadata only: reading their contents requires separate chat permission via read_note.',
					parameters: {
						type: 'object',
						properties: { name: { type: 'string' } },
						required: ['name']
					}
				},
				run: (a) => checked(a.name, maps.read)
			},
			{
				def: {
					name: 'create_map',
					description: `Propose a new mind map by name, optionally populated with patch containing nodes/edges (no removals on a new map). User approval required. ${MAP_PATCH_SYNTAX}`,
					parameters: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							patch: {
								type: 'object',
								description:
									'Optional initial nodes and edges; same JSON Canvas patch syntax as edit_map.',
								properties: {
									nodes: { type: 'array', items: { type: 'object', additionalProperties: true } },
									edges: { type: 'array', items: { type: 'object', additionalProperties: true } }
								}
							}
						},
						required: ['name']
					}
				},
				run: (a) => checked(a.name, (name) => maps.create(name, a.patch))
			},
			{
				def: {
					name: 'edit_map',
					description: `Propose changes to an existing map after read_map. Requires approval and rejects stale maps; existing unknown fields remain. ${MAP_PATCH_SYNTAX}`,
					parameters: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							patch: {
								type: 'object',
								properties: {
									nodes: { type: 'array', items: { type: 'object', additionalProperties: true } },
									edges: { type: 'array', items: { type: 'object', additionalProperties: true } },
									removeNodes: { type: 'array', items: { type: 'string' } },
									removeEdges: { type: 'array', items: { type: 'string' } }
								}
							}
						},
						required: ['name', 'patch']
					}
				},
				run: (a) => checked(a.name, (name) => maps.edit(name, a.patch))
			},
			{
				def: {
					name: 'delete_map',
					description:
						'Propose permanent deletion of a named mind map (not its linked notes). Requires approval and separate destructive confirmation.',
					parameters: {
						type: 'object',
						properties: { name: { type: 'string' } },
						required: ['name']
					}
				},
				run: (a) => checked(a.name, maps.delete)
			}
		);
	}

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
