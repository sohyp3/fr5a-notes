/**
 * Mind maps as JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/) files at
 * `.fr5a/maps/<Name>.canvas`. fr5a's own fields sit under an `fr5a` key on a
 * node / edge, which other canvas apps (Obsidian) ignore; every field this
 * module doesn't know round-trips untouched. Pure: no Svelte, no platform, so
 * it is unit-tested in Node and cheap for the store to import on a move.
 */
import { remapPath } from '../../../../shared/paths';
import { ACCENTS } from '../accents';

export const MAPS_DIR = 'maps';
export const MAP_EXT = '.canvas';

/** `.fr5a/`-relative path of a map file. */
export const mapPath = (name: string): string => `${MAPS_DIR}/${name}${MAP_EXT}`;

/** Map name of a `listMeta('maps')` entry, or null for anything else. */
export function mapNameOf(entry: string): string | null {
	if (entry.endsWith('/') || !entry.toLowerCase().endsWith(MAP_EXT)) return null;
	const name = entry.slice(0, -MAP_EXT.length);
	return name ? name : null;
}

/** A map name that is a safe file name (no folders, no leading dot). */
export function cleanMapName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|]+/g, ' ')
		.replace(/\p{Cc}+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.slice(0, 120)
		.trim();
}

// --- the file format --------------------------------------------------------

/** fr5a's namespaced extras on a node. */
export interface NodeExtra {
	/** A tag node: the tag (no `#`) whose notes it gathers. */
	tag?: string;
	/** A tag node: notes taken off the map, never added back. */
	exclude?: string[];
	/** A note node / edge a tag node added: that tag node's id. */
	from?: string;
	[key: string]: unknown;
}

export interface CanvasNode {
	id: string;
	type: 'text' | 'file' | 'link' | 'group' | (string & {});
	x: number;
	y: number;
	width: number;
	height: number;
	/** Preset `'1'`–`'6'` or `#rrggbb`. */
	color?: string;
	text?: string;
	/** Workspace-relative path of a note (type `file`). */
	file?: string;
	url?: string;
	label?: string;
	fr5a?: NodeExtra;
	[key: string]: unknown;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface CanvasEdge {
	id: string;
	fromNode: string;
	toNode: string;
	fromSide?: Side;
	toSide?: Side;
	fromEnd?: 'none' | 'arrow';
	toEnd?: 'none' | 'arrow';
	color?: string;
	label?: string;
	fr5a?: { from?: string; [key: string]: unknown };
	[key: string]: unknown;
}

export interface CanvasDoc {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	[key: string]: unknown;
}

/**
 * A parsed file. Entries that can't be drawn (no id, no position, an edge to
 * a node that isn't there) are kept aside and written back as they were.
 */
export interface ParsedCanvas {
	doc: CanvasDoc;
	skipped: { nodes: unknown[]; edges: unknown[] };
}

export class CanvasError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CanvasError';
	}
}

const SIDES = new Set(['top', 'right', 'bottom', 'left']);
const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const emptyCanvas = (): CanvasDoc => ({ nodes: [], edges: [] });

/** Parse a `.canvas` file. An empty file is an empty map; anything not JSON Canvas throws. */
export function parseCanvas(text: string): ParsedCanvas {
	const skipped = { nodes: [] as unknown[], edges: [] as unknown[] };
	if (!text.trim()) return { doc: emptyCanvas(), skipped };
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new CanvasError('This map file isn’t valid JSON.');
	}
	if (!isObj(raw)) throw new CanvasError('This map file isn’t a JSON Canvas.');
	if (raw.nodes !== undefined && !Array.isArray(raw.nodes))
		throw new CanvasError('The map’s “nodes” isn’t a list.');
	if (raw.edges !== undefined && !Array.isArray(raw.edges))
		throw new CanvasError('The map’s “edges” isn’t a list.');
	const nodes: CanvasNode[] = [];
	const ids = new Set<string>();
	for (const n of (raw.nodes as unknown[] | undefined) ?? []) {
		if (
			!isObj(n) ||
			typeof n.id !== 'string' ||
			!n.id ||
			ids.has(n.id) ||
			typeof n.type !== 'string' ||
			!num(n.x) ||
			!num(n.y)
		) {
			skipped.nodes.push(n);
			continue;
		}
		ids.add(n.id);
		const node = { ...n } as CanvasNode;
		if (!num(node.width) || node.width <= 0) node.width = 200;
		if (!num(node.height) || node.height <= 0) node.height = 60;
		if (node.fr5a !== undefined && !isObj(node.fr5a)) delete node.fr5a;
		if (node.fr5a?.exclude !== undefined && !Array.isArray(node.fr5a.exclude))
			node.fr5a = { ...node.fr5a, exclude: [] };
		nodes.push(node);
	}
	const edges: CanvasEdge[] = [];
	const edgeIds = new Set<string>();
	for (const e of (raw.edges as unknown[] | undefined) ?? []) {
		if (
			!isObj(e) ||
			typeof e.id !== 'string' ||
			!e.id ||
			edgeIds.has(e.id) ||
			typeof e.fromNode !== 'string' ||
			typeof e.toNode !== 'string' ||
			!ids.has(e.fromNode) ||
			!ids.has(e.toNode)
		) {
			skipped.edges.push(e);
			continue;
		}
		edgeIds.add(e.id);
		const edge = { ...e } as CanvasEdge;
		if (edge.fromSide !== undefined && !SIDES.has(edge.fromSide)) delete edge.fromSide;
		if (edge.toSide !== undefined && !SIDES.has(edge.toSide)) delete edge.toSide;
		edges.push(edge);
	}
	return { doc: { ...raw, nodes, edges }, skipped };
}

/** File text of a map (tab-indented, like Obsidian writes it). */
export function serializeCanvas(doc: CanvasDoc, skipped?: ParsedCanvas['skipped']): string {
	const out = {
		...doc,
		nodes: skipped?.nodes.length ? [...doc.nodes, ...skipped.nodes] : doc.nodes,
		edges: skipped?.edges.length ? [...doc.edges, ...skipped.edges] : doc.edges
	};
	return `${JSON.stringify(out, null, '\t')}\n`;
}

/** A new random id (16 hex digits, as other canvas apps write them). */
export function newId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Svelte Flow --------------------------------------------------------------

export type MapNodeKind = 'concept' | 'note' | 'tag' | 'other';

export function kindOf(node: CanvasNode): MapNodeKind {
	if (node.type === 'file') return 'note';
	if (node.type === 'text') return typeof node.fr5a?.tag === 'string' ? 'tag' : 'concept';
	return 'other';
}

/** The parts of a Svelte Flow node this module reads and writes. */
export interface FlowNode {
	id: string;
	type: MapNodeKind;
	position: { x: number; y: number };
	data: { raw: CanvasNode };
	width?: number;
	height?: number;
	measured?: { width?: number; height?: number };
	selected?: boolean;
	zIndex?: number;
}

export interface FlowEdge {
	id: string;
	type: 'map';
	source: string;
	target: string;
	sourceHandle?: string | null;
	targetHandle?: string | null;
	label?: string;
	data: { raw: CanvasEdge };
	selected?: boolean;
}

/** Map nodes size to their content; only groups keep the stored box. */
export function toFlowNode(raw: CanvasNode): FlowNode {
	const type = kindOf(raw);
	const node: FlowNode = { id: raw.id, type, position: { x: raw.x, y: raw.y }, data: { raw } };
	if (raw.type === 'group') {
		node.width = raw.width;
		node.height = raw.height;
		node.zIndex = -1;
	}
	return node;
}

export function toFlowEdge(raw: CanvasEdge): FlowEdge {
	return {
		id: raw.id,
		type: 'map',
		source: raw.fromNode,
		target: raw.toNode,
		sourceHandle: raw.fromSide ?? null,
		targetHandle: raw.toSide ?? null,
		label: raw.label,
		data: { raw }
	};
}

export function toFlow(doc: CanvasDoc): { nodes: FlowNode[]; edges: FlowEdge[] } {
	return { nodes: doc.nodes.map(toFlowNode), edges: doc.edges.map(toFlowEdge) };
}

/** The canvas the flow shows now: positions, measured sizes and edge ends written back. */
export function fromFlow(
	base: CanvasDoc,
	nodes: readonly FlowNode[],
	edges: readonly FlowEdge[]
): CanvasDoc {
	return {
		...base,
		nodes: nodes.map((n) => {
			const raw: CanvasNode = {
				...n.data.raw,
				x: Math.round(n.position.x),
				y: Math.round(n.position.y)
			};
			const w = n.measured?.width ?? n.width;
			const h = n.measured?.height ?? n.height;
			if (num(w) && w > 0) raw.width = Math.round(w);
			if (num(h) && h > 0) raw.height = Math.round(h);
			return raw;
		}),
		edges: edges.map((e) => {
			const raw: CanvasEdge = { ...e.data.raw, fromNode: e.source, toNode: e.target };
			if (e.sourceHandle && SIDES.has(e.sourceHandle)) raw.fromSide = e.sourceHandle as Side;
			else delete raw.fromSide;
			if (e.targetHandle && SIDES.has(e.targetHandle)) raw.toSide = e.targetHandle as Side;
			else delete raw.toSide;
			if (e.label?.trim()) raw.label = e.label.trim();
			else delete raw.label;
			return raw;
		})
	};
}

// --- tag nodes ----------------------------------------------------------------

export interface TaggedNote {
	id: string;
	tags: readonly string[];
}

/** `#Work/a` → `Work/a` (tags stay case-sensitive, as in the sidebar). */
export const cleanTag = (tag: string): string => tag.trim().replace(/^#+/, '').replace(/\/+$/, '');

/** The note carries `tag` or one below it (`#work` gathers `#work/atlas`). */
export const carriesTag = (tags: readonly string[], tag: string): boolean =>
	tags.some((t) => t === tag || t.startsWith(`${tag}/`));

/** Notes in the index that carry the tag. */
export function tagMembers(notes: readonly TaggedNote[], tag: string): string[] {
	return notes.filter((n) => carriesTag(n.tags, tag)).map((n) => n.id);
}

const tagNodeOf = (doc: CanvasDoc, id: string): CanvasNode | undefined => {
	const node = doc.nodes.find((n) => n.id === id);
	return node && kindOf(node) === 'tag' ? node : undefined;
};

/**
 * Notes a tag node already holds: note nodes it added, and note nodes joined
 * to it by an edge (a note that was on the map before the tag).
 */
export function presentFor(doc: CanvasDoc, tagId: string): Set<string> {
	const byId = new Map(doc.nodes.map((n) => [n.id, n]));
	const out = new Set<string>();
	for (const n of doc.nodes) if (n.file && n.fr5a?.from === tagId) out.add(n.file);
	for (const e of doc.edges) {
		const other = e.fromNode === tagId ? e.toNode : e.toNode === tagId ? e.fromNode : null;
		const file = other !== null ? byId.get(other)?.file : undefined;
		if (file) out.add(file);
	}
	return out;
}

/** Tagged notes the tag node doesn't hold yet and that weren't taken off it. */
export function newForTag(doc: CanvasDoc, tagId: string, notes: readonly TaggedNote[]): string[] {
	const tag = tagNodeOf(doc, tagId);
	if (!tag?.fr5a?.tag) return [];
	const present = presentFor(doc, tagId);
	const exclude = new Set(tag.fr5a.exclude ?? []);
	return tagMembers(notes, tag.fr5a.tag).filter((id) => !present.has(id) && !exclude.has(id));
}

export const NOTE_W = 240;
export const NOTE_H = 72;
/** Room per note on a ring (a card plus a gap). */
const SLOT = NOTE_W + 40;
const RING0 = 280;
const RING_STEP = 150;

/**
 * Centre of slot `i` on rings around (0, 0): the first ring holds as many
 * cards as fit at its radius, then the next, wider ring takes over.
 */
export function ringSlot(i: number): { x: number; y: number } {
	let r = RING0;
	let first = 0;
	for (;;) {
		const fit = Math.max(6, Math.floor((2 * Math.PI * r) / SLOT));
		if (i < first + fit) {
			const a = -Math.PI / 2 + ((i - first) / fit) * 2 * Math.PI;
			return { x: Math.cos(a) * r * 1.35, y: Math.sin(a) * r };
		}
		first += fit;
		r += RING_STEP;
	}
}

/**
 * Add note nodes (and tag → note edges) for `ids`, default every new one, on
 * rings around the tag. A note already on the map elsewhere only gets the
 * edge. Map-only: the notes and their tags are never touched.
 */
export function populateTag(
	doc: CanvasDoc,
	tagId: string,
	notes: readonly TaggedNote[],
	ids: readonly string[] = newForTag(doc, tagId, notes),
	makeId: () => string = newId
): CanvasDoc {
	const tag = tagNodeOf(doc, tagId);
	if (!tag || !ids.length) return doc;
	const cx = tag.x + tag.width / 2;
	const cy = tag.y + tag.height / 2;
	let slot = presentFor(doc, tagId).size;
	const nodes = [...doc.nodes];
	const edges = [...doc.edges];
	for (const file of ids) {
		const existing = nodes.find((n) => n.file === file);
		let target = existing?.id;
		if (!target) {
			const at = ringSlot(slot++);
			target = makeId();
			nodes.push({
				id: target,
				type: 'file',
				file,
				x: Math.round(cx + at.x - NOTE_W / 2),
				y: Math.round(cy + at.y - NOTE_H / 2),
				width: NOTE_W,
				height: NOTE_H,
				fr5a: { from: tagId }
			});
		}
		edges.push({
			id: makeId(),
			fromNode: tagId,
			toNode: target,
			toEnd: 'none',
			fr5a: { from: tagId }
		});
	}
	return { ...doc, nodes, edges };
}

/**
 * Tag nodes' exclude lists after `deleted` note nodes leave the map: a note a
 * tag gathered (or that was joined to it) is taken off that tag for good.
 * `before` is the canvas before the deletion; `after` gets the lists.
 */
export function excludeDeleted(
	before: CanvasDoc,
	after: CanvasDoc,
	deleted: readonly string[]
): CanvasDoc {
	const gone = new Set(deleted);
	const add = new Map<string, Set<string>>();
	const mark = (tagId: string, file: string) => {
		if (gone.has(tagId) || !tagNodeOf(before, tagId)) return;
		(add.get(tagId) ?? add.set(tagId, new Set()).get(tagId)!).add(file);
	};
	for (const n of before.nodes) {
		if (!gone.has(n.id) || !n.file) continue;
		if (n.fr5a?.from) mark(n.fr5a.from, n.file);
		for (const e of before.edges) {
			if (e.fromNode === n.id) mark(e.toNode, n.file);
			if (e.toNode === n.id) mark(e.fromNode, n.file);
		}
	}
	if (!add.size) return after;
	return {
		...after,
		nodes: after.nodes.map((n) => {
			const files = add.get(n.id);
			if (!files) return n;
			const exclude = [...new Set([...(n.fr5a?.exclude ?? []), ...files])];
			return { ...n, fr5a: { ...n.fr5a, exclude } };
		})
	};
}

/** A note node its tag added whose note no longer carries the tag. */
export function untaggedTag(
	doc: CanvasDoc,
	node: CanvasNode,
	tagsOf: (id: string) => readonly string[] | undefined
): CanvasNode | null {
	if (!node.file || !node.fr5a?.from) return null;
	const tag = tagNodeOf(doc, node.fr5a.from);
	const tags = tagsOf(node.file);
	if (!tag?.fr5a?.tag || !tags) return null;
	return carriesTag(tags, tag.fr5a.tag) ? null : tag;
}

// --- moves --------------------------------------------------------------------

/**
 * Point note references at a moved note / folder. Null when nothing named
 * it, so the caller writes only maps that changed.
 */
export function rewritePaths(doc: CanvasDoc, from: string, to: string): CanvasDoc | null {
	let changed = false;
	const nodes = doc.nodes.map((n) => {
		let next = n;
		const file = n.file ? remapPath(n.file, from, to) : null;
		if (file !== null) next = { ...next, file };
		const ex = n.fr5a?.exclude;
		if (ex?.some((id) => remapPath(id, from, to) !== null))
			next = {
				...next,
				fr5a: { ...next.fr5a, exclude: ex.map((id) => remapPath(id, from, to) ?? id) }
			};
		if (next !== n) changed = true;
		return next;
	});
	return changed ? { ...doc, nodes } : null;
}

// --- colors -------------------------------------------------------------------

/** JSON Canvas presets → the app's accent hues (5, "cyan" in the spec, is the accent blue). */
const PRESET_ACCENT: Record<string, string> = {
	'1': 'red',
	'2': 'orange',
	'3': 'yellow',
	'4': 'green',
	'5': 'blue',
	'6': 'purple'
};
export const PRESETS = Object.keys(PRESET_ACCENT);

/** The preset's hex in this theme, or the color itself when it's `#rrggbb`. */
export function colorHex(color: string | undefined, theme: 'light' | 'dark'): string | null {
	if (!color) return null;
	const accent = ACCENTS.find((a) => a.id === PRESET_ACCENT[color]);
	if (accent) return accent[theme];
	return /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

/** Border + tinted fill for a colored node (mixed here: no `color-mix()` on Chromium 92). */
export function nodeColors(
	color: string | undefined,
	theme: 'light' | 'dark'
): { border: string; fill: string } | null {
	const hex = colorHex(color, theme);
	if (!hex) return null;
	const n = parseInt(hex.slice(1), 16);
	const a = theme === 'dark' ? 0.2 : 0.14;
	return { border: hex, fill: `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})` };
}
