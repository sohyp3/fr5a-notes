import type { NoteMeta } from '../../../../shared/types';
import { mapPath, parseCanvas, serializeCanvas, emptyCanvas, type CanvasDoc } from '../maps/canvas';

export interface MapChange {
	name: string;
	/** Upsert nodes and edges by id. Unspecified fields of existing entries survive. */
	nodes?: unknown[];
	edges?: unknown[];
	removeNodes?: string[];
	removeEdges?: string[];
}

/** Never treat a map name as a meta-file path. */
export function validMapName(name: string): string {
	mapPath(name);
	return name;
}

function objects(value: unknown, label: string): Record<string, unknown>[] {
	if (
		!Array.isArray(value) ||
		value.some(
			(v) => !v || typeof v !== 'object' || Array.isArray(v) || typeof v.id !== 'string' || !v.id
		)
	)
		throw new Error(`${label} must be a list of objects with nonempty ids.`);
	const ids = value.map((v) => v.id);
	if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} ids.`);
	return value;
}

function ids(value: unknown, label: string): string[] {
	if (
		!Array.isArray(value) ||
		value.some((v) => typeof v !== 'string' || !v) ||
		new Set(value).size !== value.length
	)
		throw new Error(`${label} must be a list of unique ids.`);
	return value;
}

export function mapPatch(raw: unknown, before: CanvasDoc, notes: readonly NoteMeta[]): CanvasDoc {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		throw new Error('Pass a patch object.');
	const patch = raw as Record<string, unknown>;
	const keys = ['nodes', 'edges', 'removeNodes', 'removeEdges'];
	if (Object.keys(patch).some((k) => !keys.includes(k)) || !keys.some((k) => k in patch))
		throw new Error('Patch must contain only nodes, edges, removeNodes or removeEdges.');
	const addedNodes = 'nodes' in patch ? objects(patch.nodes, 'nodes') : [];
	const addedEdges = 'edges' in patch ? objects(patch.edges, 'edges') : [];
	const removedNodes = 'removeNodes' in patch ? ids(patch.removeNodes, 'removeNodes') : [];
	const removedEdges = 'removeEdges' in patch ? ids(patch.removeEdges, 'removeEdges') : [];
	if (
		addedNodes.some((n) => removedNodes.includes(n.id as string)) ||
		addedEdges.some((e) => removedEdges.includes(e.id as string))
	)
		throw new Error('An id cannot be updated and removed together.');
	if (
		removedNodes.some((id) => !before.nodes.some((n) => n.id === id)) ||
		removedEdges.some((id) => !before.edges.some((e) => e.id === id))
	)
		throw new Error('Cannot remove an id that is not on this map.');
	const update = (
		old: Record<string, unknown>[],
		incoming: Record<string, unknown>[],
		removed: string[]
	) => {
		const byId = new Map(old.map((entry) => [entry.id, entry]));
		for (const entry of incoming) {
			const prior = byId.get(entry.id);
			byId.set(entry.id, {
				...prior,
				...entry,
				...(entry.fr5a &&
				typeof entry.fr5a === 'object' &&
				!Array.isArray(entry.fr5a) &&
				prior?.fr5a &&
				typeof prior.fr5a === 'object' &&
				!Array.isArray(prior.fr5a)
					? { fr5a: { ...prior.fr5a, ...entry.fr5a } }
					: {})
			});
		}
		for (const id of removed) byId.delete(id);
		return [...byId.values()];
	};
	const proposed = {
		...before,
		nodes: update(before.nodes, addedNodes, removedNodes),
		edges: update(before.edges, addedEdges, removedEdges)
	};
	// The parser keeps malformed entries aside for round-tripping in the editor;
	// AI must not silently drop or normalize malformed proposed changes.
	const parsed = parseCanvas(JSON.stringify(proposed));
	if (parsed.skipped.nodes.length || parsed.skipped.edges.length)
		throw new Error(
			'Invalid canvas nodes or edges (check positions, ids and connection endpoints).'
		);
	const known = new Set(notes.map((n) => n.id));
	for (const node of addedNodes) {
		const next = parsed.doc.nodes.find((n) => n.id === node.id);
		if (next?.type === 'file' && (typeof next.file !== 'string' || !known.has(next.file)))
			throw new Error(
				`Linked note ${String(next.file ?? '')} does not exist. Use an existing note id.`
			);
	}
	return parsed.doc;
}

export function mapSummary(
	name: string,
	text: string,
	notes: readonly NoteMeta[],
	metadataIds?: ReadonlySet<string>
): string {
	const { doc, skipped } = parseCanvas(text);
	const byId = new Map(notes.map((n) => [n.id, n]));
	return JSON.stringify({
		name,
		nodes: doc.nodes.map((n) => ({
			id: n.id,
			type: n.type,
			label: n.label ?? n.text?.slice(0, 120) ?? '',
			...(n.type === 'file'
				? {
						noteId: n.file ?? null,
						noteTitle:
							metadataIds && !metadataIds.has(n.file ?? '')
								? null
								: (byId.get(n.file ?? '')?.title ?? null),
						missing: !byId.has(n.file ?? '')
					}
				: {}),
			x: n.x,
			y: n.y
		})),
		edges: doc.edges.map((e) => ({
			id: e.id,
			fromNode: e.fromNode,
			toNode: e.toNode,
			label: e.label ?? ''
		})),
		...(skipped.nodes.length || skipped.edges.length
			? { malformed: { nodes: skipped.nodes.length, edges: skipped.edges.length } }
			: {})
	});
}

export const blankMap = () => serializeCanvas(emptyCanvas());
