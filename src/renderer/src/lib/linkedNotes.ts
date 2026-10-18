import type { NoteMeta } from '../../../shared/types';
import { noteStem, parentOf } from '../../../shared/paths';
import { codeLines } from './editor/blocks';

export interface WikiLink {
	target: string;
	label: string;
}

export interface GraphNode {
	id: string;
	title: string;
	x: number;
	y: number;
	degree: number;
	missing: boolean;
}

export interface GraphEdge {
	from: string;
	to: string;
}

export interface NoteGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

/**
 * Parse plain-text wiki links without touching URLs, tags, or Markdown links.
 * Links inside fenced code or inline `code` are examples, not links.
 */
export function parseWikiLinks(markdown: string): WikiLink[] {
	const links: WikiLink[] = [];
	const lines = markdown.split('\n');
	const code = codeLines(lines);
	const re = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g;
	for (let i = 0; i < lines.length; i++) {
		if (code[i]) continue;
		const text = lines[i].replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
		let match: RegExpExecArray | null;
		re.lastIndex = 0;
		while ((match = re.exec(text))) {
			const target = match[1].trim();
			if (!target) continue;
			links.push({ target, label: match[2]?.trim() || target });
		}
	}
	return links;
}

const withoutExt = (value: string) => value.replace(/\.(?:md|markdown|txt)$/i, '');

/** Resolve a wiki target like a wiki: nearby exact paths first, then title/stem. */
export function resolveWikiLink(
	notes: readonly NoteMeta[],
	target: string,
	fromId: string
): NoteMeta | null {
	const clean = target.trim().replace(/\\/g, '/').replace(/^\.\//, '');
	const stem = withoutExt(clean);
	const dir = parentOf(fromId);
	const candidates = [dir && `${dir}/${stem}`, stem].filter(Boolean).map((x) => x.toLowerCase());
	for (const candidate of candidates) {
		const exact = notes.find((note) => withoutExt(note.id).toLowerCase() === candidate);
		if (exact) return exact;
	}
	const key = stem.toLowerCase();
	const named = notes.filter(
		(note) => note.title.toLowerCase() === key || noteStem(note.id).toLowerCase() === key
	);
	if (named.length === 1) return named[0];
	return named.find((note) => parentOf(note.id) === dir) ?? named[0] ?? null;
}

/**
 * Build and position the graph once. This deliberately is not a force simulation:
 * opening the map pays one O(notes + links) pass, then consumes no idle CPU.
 */
export function buildNoteGraph(
	notes: readonly NoteMeta[],
	contents: ReadonlyMap<string, string>
): NoteGraph {
	const byId = new Map<string, GraphNode>();
	for (const note of notes)
		byId.set(note.id, {
			id: note.id,
			title: note.title,
			x: 500,
			y: 350,
			degree: 0,
			missing: false
		});

	const edges: GraphEdge[] = [];
	const seen = new Set<string>();
	for (const note of notes) {
		const markdown = contents.get(note.id);
		if (markdown === undefined) continue;
		for (const link of parseWikiLinks(markdown)) {
			const resolved = resolveWikiLink(notes, link.target, note.id);
			const to = resolved?.id ?? `?${link.target.toLowerCase()}`;
			if (!resolved && !byId.has(to)) {
				byId.set(to, {
					id: to,
					title: link.target,
					x: 500,
					y: 350,
					degree: 0,
					missing: true
				});
			}
			if (to === note.id) continue;
			const edgeKey = `${note.id}\0${to}`;
			if (seen.has(edgeKey)) continue;
			seen.add(edgeKey);
			edges.push({ from: note.id, to });
			byId.get(note.id)!.degree++;
			byId.get(to)!.degree++;
		}
	}

	// High-degree notes occupy the calm center; quieter and missing notes move out.
	const nodes = [...byId.values()].sort(
		(a, b) =>
			b.degree - a.degree || Number(a.missing) - Number(b.missing) || a.title.localeCompare(b.title)
	);
	const golden = Math.PI * (3 - Math.sqrt(5));
	const count = Math.max(nodes.length, 1);
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (i === 0) continue;
		const radius = 34 + Math.sqrt(i / count) * (node.missing ? 330 : 285);
		const angle = i * golden;
		node.x = 500 + Math.cos(angle) * radius * 1.45;
		node.y = 350 + Math.sin(angle) * radius;
	}
	return { nodes, edges };
}

export function connectedIds(graph: NoteGraph, id: string): Set<string> {
	const ids = new Set([id]);
	for (const edge of graph.edges) {
		if (edge.from === id) ids.add(edge.to);
		if (edge.to === id) ids.add(edge.from);
	}
	return ids;
}
