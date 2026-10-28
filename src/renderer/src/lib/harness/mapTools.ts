import type { NoteMeta } from '../../../../shared/types';
import {
	mapPath,
	parseCanvas,
	serializeCanvas,
	emptyCanvas,
	type CanvasDoc,
	type CanvasEdge,
	type CanvasNode
} from '../maps/canvas';

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

const isStringList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((v) => typeof v === 'string');

/** The canvas parser tolerates foreign data, but AI writes must not introduce
 * values that Svelte Flow or our node components will treat as strings/numbers. */
function checkCanvasFields(entries: Record<string, unknown>[], kind: 'node' | 'edge'): void {
	for (const entry of entries) {
		const id = entry.id as string;
		const strings =
			kind === 'node'
				? ['type', 'text', 'file', 'url', 'label', 'color']
				: ['fromNode', 'toNode', 'fromSide', 'toSide', 'fromEnd', 'toEnd', 'label', 'color'];
		for (const key of strings)
			if (key in entry && typeof entry[key] !== 'string')
				throw new Error(`Canvas ${kind} “${id}”: ${key} must be a string.`);
		if (kind === 'node') {
			for (const key of ['x', 'y', 'width', 'height'])
				if (
					key in entry &&
					(typeof entry[key] !== 'number' ||
						!Number.isFinite(entry[key]) ||
						((key === 'width' || key === 'height') && (entry[key] as number) <= 0))
				)
					throw new Error(
						`Canvas node “${id}”: ${key} must be a finite positive number for sizes, or a finite number for positions.`
					);
		}
	}
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
	checkCanvasFields(addedNodes, 'node');
	checkCanvasFields(addedEdges, 'edge');
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
			const next: Record<string, unknown> = { ...prior, ...entry };
			const incomingExtra = entry.fr5a;
			const priorExtra = prior?.fr5a;
			const validIncoming =
				!!incomingExtra && typeof incomingExtra === 'object' && !Array.isArray(incomingExtra);
			const validPrior =
				!!priorExtra && typeof priorExtra === 'object' && !Array.isArray(priorExtra);
			const mergeExtra = (): Record<string, unknown> | undefined => {
				// An invalid fr5a (null, a string) must not erase the entry's real extras.
				if (!validIncoming) return validPrior ? (priorExtra as Record<string, unknown>) : undefined;
				const merged: Record<string, unknown> = {
					...(validPrior ? (priorExtra as Record<string, unknown>) : {}),
					...(incomingExtra as Record<string, unknown>)
				};
				if ('exclude' in merged && !isStringList(merged.exclude)) {
					// The parser repairs a non-list exclude to []: keep the reviewed
					// exclusions instead of silently making old notes eligible again.
					const priorExclude = validPrior
						? (priorExtra as Record<string, unknown>).exclude
						: undefined;
					if (isStringList(priorExclude)) merged.exclude = priorExclude;
					else delete merged.exclude;
				}
				return merged;
			};
			const extra = mergeExtra();
			if (extra) next.fr5a = extra;
			else delete next.fr5a;
			byId.set(entry.id, next);
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
	if (parsed.skipped.nodes.length || parsed.skipped.edges.length) {
		const names = (entries: unknown[]) =>
			entries
				.map((entry) =>
					entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string'
						? entry.id
						: '(missing id)'
				)
				.join(', ');
		throw new Error(
			`Invalid canvas ${[
				parsed.skipped.nodes.length ? `nodes: ${names(parsed.skipped.nodes)}` : '',
				parsed.skipped.edges.length ? `edges: ${names(parsed.skipped.edges)}` : ''
			]
				.filter(Boolean)
				.join(
					'; '
				)}. Nodes need type and numeric x/y; edges need fromNode/toNode ids present on the map.`
		);
	}
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

export interface MapNoteAccess {
	/** Note ids whose title/metadata this chat may see; null/undefined = no chat gate. */
	allowedIds?: ReadonlySet<string> | null;
	/** A linked note hidden from this provider (local-only for cloud): omit its path too. */
	hidden?(file: string, note?: NoteMeta): boolean;
	/** Encrypted note metadata may be shown (vault unlocked and AI reads encrypted notes). */
	encryptedReadable?: boolean;
}

/**
 * `notes` is the full vault index (so an encrypted link is not "missing"), while
 * `access` decides which linked ids/titles this chat/provider may see.
 */
export function mapSummary(
	name: string,
	text: string,
	notes: readonly NoteMeta[],
	access?: MapNoteAccess
): string {
	const { doc, skipped } = parseCanvas(text);
	const byId = new Map(notes.map((n) => [n.id, n]));
	const fileInfo = (file: string | undefined) => {
		const note = file ? byId.get(file) : undefined;
		const hidden = !!file && !!access?.hidden?.(file, note);
		const allowed =
			access?.allowedIds === undefined ||
			access.allowedIds === null ||
			(!!file && access.allowedIds.has(file));
		const encryptedBlocked = !!note?.encrypted && access?.encryptedReadable === false;
		const restricted = !!note && (hidden || !allowed || !!note.locked || encryptedBlocked);
		return {
			// A local-only path is itself cloud metadata: don't send it at all.
			...(hidden ? {} : { noteId: file || null }),
			noteTitle: note && !restricted ? note.title : null,
			...(note ? {} : { missing: true }),
			...(restricted ? { accessible: false } : {}),
			...(note?.encrypted ? { encrypted: true } : {})
		};
	};
	return JSON.stringify({
		name,
		nodes: doc.nodes.map((n) => ({
			id: n.id,
			type: n.type,
			label: n.label ?? n.text?.slice(0, 120) ?? '',
			...(n.type === 'file' ? fileInfo(n.file) : {}),
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

const short = (text: string | undefined, fallback: string): string => {
	const value = (text ?? '').replace(/\s+/g, ' ').trim();
	return value ? value.slice(0, 60) : fallback;
};

const nodeLabel = (node: CanvasNode): string =>
	short(node.label ?? node.text, node.type === 'file' ? short(node.file, node.id) : node.id);

const nodeLabelById = (id: string, nodes: ReadonlyMap<string, CanvasNode>): string => {
	const node = nodes.get(id);
	return node ? nodeLabel(node) : id;
};

const edgeLabel = (edge: CanvasEdge, nodes: ReadonlyMap<string, CanvasNode>): string =>
	short(
		edge.label,
		`${nodeLabelById(edge.fromNode, nodes)} → ${nodeLabelById(edge.toNode, nodes)}`
	);

/** Readable, non-JSON lines for the approval card. */
export function mapChangeLines(
	tool: 'create_map' | 'edit_map' | 'delete_map',
	before: CanvasDoc | null,
	after: CanvasDoc
): string[] {
	if (tool === 'delete_map')
		return ['The map file is permanently deleted.', 'Linked notes remain in the workspace.'];
	if (tool === 'create_map' && !after.nodes.length && !after.edges.length)
		return ['New empty map; add nodes and links in the editor.'];
	const lines: string[] = [];
	const beforeNodes = new Map((before?.nodes ?? []).map((n) => [n.id, n]));
	const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
	const nodes = new Map([...beforeNodes, ...afterNodes]);
	for (const [id, node] of afterNodes) {
		const previous = beforeNodes.get(id);
		if (!previous) lines.push(`Added node “${nodeLabel(node)}”`);
		else if (JSON.stringify(previous) !== JSON.stringify(node))
			lines.push(`Updated node “${nodeLabel(node)}”`);
	}
	for (const [id, node] of beforeNodes)
		if (!afterNodes.has(id)) lines.push(`Removed node “${nodeLabel(node)}”`);
	const beforeEdges = new Map((before?.edges ?? []).map((e) => [e.id, e]));
	const afterEdges = new Map(after.edges.map((e) => [e.id, e]));
	for (const [id, edge] of afterEdges) {
		const previous = beforeEdges.get(id);
		if (!previous) lines.push(`Added link “${edgeLabel(edge, nodes)}”`);
		else if (JSON.stringify(previous) !== JSON.stringify(edge))
			lines.push(`Updated link “${edgeLabel(edge, nodes)}”`);
	}
	for (const [id, edge] of beforeEdges)
		if (!afterEdges.has(id)) lines.push(`Removed link “${edgeLabel(edge, nodes)}”`);
	if (lines.length > 12) return [...lines.slice(0, 12), `…and ${lines.length - 12} more changes.`];
	return lines.length ? lines : ['No visible change.'];
}

export const blankMap = () => serializeCanvas(emptyCanvas());
