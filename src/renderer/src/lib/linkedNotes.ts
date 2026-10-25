import type { NoteMeta } from '../../../shared/types';
import { baseOf, noteStem, parentOf } from '../../../shared/paths';
import { codeLines } from './editor/blocks';
import { markdownBody } from '../../../shared/frontmatter';

/**
 * A link from one note to another: `[text](path/to/note.md)`, relative to the
 * linking note's folder (`/…` from the workspace root).
 */
export interface NoteLink {
	/** The link's destination, as written. */
	target: string;
	label: string;
}

export type NodeKind = 'note' | 'tag' | 'missing';
/** `link`: note → note. `tag`: note → its tag. `nest`: tag → its parent tag. */
export type EdgeKind = 'link' | 'tag' | 'nest';

export interface GraphNode {
	/** A note's id, `#path` for a tag, `?target` for a link to no note. */
	id: string;
	kind: NodeKind;
	title: string;
	/** Every edge touching the node. */
	degree: number;
	/** Note links only (in or out). */
	links: number;
	x: number;
	y: number;
}

export interface GraphEdge {
	from: string;
	to: string;
	kind: EdgeKind;
}

export interface NoteGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

const NOTE_PATH = /\.(?:md|markdown|mdown|txt)$/i;
// Not an image (`![…](…)`); the destination may be `<…>` and carry a "title".
const MD_LINK_RE =
	/(?<!!)\[([^\]\n]+)\]\(\s*(<[^>\n]+>|(?:[^()\s]|\([^()\n]*\))+)(?:\s+"[^"\n]*")?\s*\)/g;

/** A Markdown link destination that points at a note: no scheme, a note extension. */
export function isNoteHref(href: string): boolean {
	const raw = href.trim().replace(/^<|>$/g, '');
	if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
	return NOTE_PATH.test(raw.replace(/[?#].*$/, ''));
}

/**
 * Note links in a note's text, in order. Links inside fenced code or inline
 * `code` are examples, not links; web links and images are left out.
 */
export function parseNoteLinks(markdown: string): NoteLink[] {
	const links: NoteLink[] = [];
	const lines = markdownBody(markdown).split('\n');
	const code = codeLines(lines);
	for (let i = 0; i < lines.length; i++) {
		if (code[i]) continue;
		const text = lines[i].replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
		for (const m of text.matchAll(MD_LINK_RE)) {
			const href = m[2].replace(/^<|>$/g, '');
			if (isNoteHref(href)) links.push({ target: href, label: m[1] });
		}
	}
	return links;
}

/** A link destination as a workspace-style path: no `<>`, query or anchor; `%20` decoded. */
function hrefPath(href: string): string {
	const path = href
		.trim()
		.replace(/^<|>$/g, '')
		.replace(/[?#].*$/, '')
		.replace(/\\/g, '/');
	try {
		return decodeURIComponent(path);
	} catch {
		return path; // a stray % — take it as written
	}
}

/** `path` taken from folder `dir` (`/…` from the root); null when it climbs out of the workspace. */
function joinRelative(dir: string, path: string): string | null {
	const parts = path.startsWith('/') ? [] : dir.split('/').filter(Boolean);
	for (const seg of path.split('/')) {
		if (!seg || seg === '.') continue;
		if (seg !== '..') parts.push(seg);
		else if (!parts.pop()) return null;
	}
	return parts.join('/');
}

/**
 * The note a Markdown link destination points at: from the linking note's
 * folder (what every Markdown viewer does), then from the workspace root, then
 * — for a note that has since moved — a note with that file name.
 */
export function resolveNoteHref(
	notes: readonly NoteMeta[],
	href: string,
	fromId: string
): NoteMeta | null {
	const path = hrefPath(href);
	const tries = [joinRelative(parentOf(fromId), path), joinRelative('', path)];
	for (const at of tries) {
		if (at === null) continue;
		const key = at.toLowerCase();
		const hit =
			notes.find((note) => note.id === at) ?? notes.find((n) => n.id.toLowerCase() === key);
		if (hit) return hit;
	}
	const stem = noteStem(baseOf(path)).toLowerCase();
	const named = notes.filter((note) => noteStem(note.id).toLowerCase() === stem);
	return named.find((note) => parentOf(note.id) === parentOf(fromId)) ?? named[0] ?? null;
}

/**
 * Notes, their tags and the links between them. Tags are hubs: a note joins
 * each tag it carries, and a nested tag joins its parent (`#work/a` → `#work`),
 * so notes about one thing gather around it. Note links run between notes; a
 * link to no note keeps a placeholder node, so a broken link shows.
 */
export function buildNoteGraph(
	notes: readonly NoteMeta[],
	contents: ReadonlyMap<string, string>
): NoteGraph {
	const byId = new Map<string, GraphNode>();
	const add = (id: string, kind: NodeKind, title: string): GraphNode => {
		let node = byId.get(id);
		if (!node) byId.set(id, (node = { id, kind, title, degree: 0, links: 0, x: 0, y: 0 }));
		return node;
	};
	for (const note of notes) add(note.id, 'note', note.title);

	const edges: GraphEdge[] = [];
	const seen = new Set<string>();
	const connect = (from: string, to: string, kind: EdgeKind): void => {
		const key = `${from}\0${to}`;
		if (from === to || seen.has(key)) return;
		seen.add(key);
		edges.push({ from, to, kind });
		for (const id of [from, to]) {
			const node = byId.get(id)!;
			node.degree++;
			if (kind === 'link') node.links++;
		}
	};
	const tag = (path: string): string => {
		const id = `#${path}`;
		if (byId.has(id)) return id;
		add(id, 'tag', path.slice(path.lastIndexOf('/') + 1));
		const parent = parentOf(path);
		if (parent) connect(id, tag(parent), 'nest');
		return id;
	};

	for (const note of notes) {
		const markdown = contents.get(note.id);
		if (markdown !== undefined)
			for (const link of parseNoteLinks(markdown)) {
				const resolved = resolveNoteHref(notes, link.target, note.id);
				if (resolved) connect(note.id, resolved.id, 'link');
				else {
					const name = noteStem(baseOf(hrefPath(link.target)));
					const id = `?${name.toLowerCase()}`;
					add(id, 'missing', name);
					connect(note.id, id, 'link');
				}
			}
		for (const path of note.tags) connect(note.id, tag(path), 'tag');
	}
	// Tags first, then the busiest notes: the order the layout seeds its spiral in.
	const rank = { tag: 0, note: 1, missing: 2 };
	const nodes = [...byId.values()].sort(
		(a, b) => rank[a.kind] - rank[b.kind] || b.degree - a.degree || a.title.localeCompare(b.title)
	);
	return { nodes, edges };
}

/** How far a node keeps others off: its dot plus room for the label under it. */
export function nodeRadius(node: GraphNode): number {
	if (node.kind === 'tag') return 7 + Math.min(node.degree, 12) * 0.7;
	return 4.5 + Math.min(node.links, 8) * 0.6;
}

/** A tag's pill on the map, sized to `#name` (a rough per-character width is enough). */
export function tagPillWidth(node: GraphNode): number {
	return (node.title.length + 1) * 7 + 18;
}

/**
 * Place the nodes with a force layout (d3-force, loaded with the map), run to
 * rest before anything is drawn: linked nodes pull together, everything
 * repels, and a weak pull to the middle keeps separate clusters on screen.
 * Ticks run in slices that yield between frames, so a large workspace never
 * blocks input; `cancelled` stops it early. Nothing runs once it returns.
 */
export async function layoutGraph(graph: NoteGraph, cancelled = () => false): Promise<void> {
	const { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } =
		await import('d3-force');
	type SimNode = GraphNode & { index?: number; vx?: number; vy?: number };
	const nodes = graph.nodes as SimNode[];
	// Unplaced nodes start on d3's spiral, in graph order: the same map every time.
	for (const node of nodes) node.x = node.y = NaN;
	const edges = graph.edges.map((e) => ({ source: e.from, target: e.to, kind: e.kind }));
	const sim = forceSimulation<SimNode>(nodes)
		.force(
			'link',
			forceLink<SimNode, (typeof edges)[number]>(edges)
				.id((n) => n.id)
				.distance((e) => (e.kind === 'link' ? 90 : e.kind === 'nest' ? 70 : 55))
		)
		.force(
			'charge',
			forceManyBody<SimNode>()
				.strength((n) => (n.kind === 'tag' ? -320 : -110))
				.distanceMax(700)
		)
		.force(
			'collide',
			forceCollide<SimNode>((n) =>
				n.kind === 'tag' ? tagPillWidth(n) / 2 + 6 : nodeRadius(n) + 16
			)
		)
		.force('x', forceX<SimNode>(0).strength(0.045))
		.force('y', forceY<SimNode>(0).strength(0.06))
		.stop();
	while (sim.alpha() > sim.alphaMin()) {
		if (cancelled()) return;
		const until = performance.now() + 12;
		while (sim.alpha() > sim.alphaMin() && performance.now() < until) sim.tick();
		await new Promise((r) => setTimeout(r, 0));
	}
	for (const node of nodes) {
		delete node.index;
		delete node.vx;
		delete node.vy;
	}
}

export function connectedIds(graph: NoteGraph, id: string): Set<string> {
	const ids = new Set([id]);
	for (const edge of graph.edges) {
		if (edge.from === id) ids.add(edge.to);
		if (edge.to === id) ids.add(edge.from);
	}
	return ids;
}
