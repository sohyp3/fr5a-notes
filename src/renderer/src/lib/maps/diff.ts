/** Read-only semantic JSON Canvas comparison; raw source remains available in the UI. */
export interface MapEdit {
	id: string;
	kind: 'added' | 'removed' | 'changed';
	label: string;
	fields: { name: string; before: string; after: string }[];
}
export interface MapDiff {
	nodes: MapEdit[];
	edges: MapEdit[];
	error: string | null;
	other: boolean;
}

type Item = Record<string, unknown> & { id: string };
type Canvas = { nodes: Item[]; edges: Item[]; [key: string]: unknown };
const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
function parse(source: string | null): Canvas {
	if (source === null) return { nodes: [], edges: [] };
	const raw: unknown = JSON.parse(source);
	if (!object(raw)) throw new Error('The map is not a JSON Canvas object.');
	for (const key of ['nodes', 'edges']) {
		const values = raw[key] ?? [];
		if (
			!Array.isArray(values) ||
			values.some((v) => !object(v) || typeof v.id !== 'string' || !v.id)
		)
			throw new Error('Some map entries cannot be compared.');
		if (new Set(values.map((v) => v.id)).size !== values.length)
			throw new Error('The map contains duplicate identifiers.');
		raw[key] = values;
	}
	const canvas = raw as Canvas;
	if (
		canvas.nodes.some(
			(node) =>
				typeof node.type !== 'string' ||
				!['x', 'y', 'width', 'height'].every(
					(key) => typeof node[key] === 'number' && Number.isFinite(node[key])
				)
		)
	)
		throw new Error('Some nodes have invalid type, position, or size.');
	const ids = new Set(canvas.nodes.map((node) => node.id));
	if (
		canvas.edges.some(
			(edge) =>
				typeof edge.fromNode !== 'string' ||
				typeof edge.toNode !== 'string' ||
				!ids.has(edge.fromNode) ||
				!ids.has(edge.toNode)
		)
	)
		throw new Error('Some connections refer to missing nodes.');
	return canvas;
}
function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	if (object(value))
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
			.join(',')}}`;
	return JSON.stringify(value) ?? '';
}
function show(value: unknown): string {
	if (value === undefined) return 'Not set';
	return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
function nodeName(node: Item): string {
	for (const field of ['label', 'text', 'file', 'url']) {
		if (typeof node[field] === 'string' && node[field].trim()) {
			const first = node[field].trim().split('\n')[0];
			return first.length > 100 ? `${first.slice(0, 100)}…` : first;
		}
	}
	if (object(node.fr5a) && typeof node.fr5a.tag === 'string') return `#${node.fr5a.tag}`;
	return `${typeof node.type === 'string' ? node.type : 'Untitled'} node`;
}
const FIELD_NAMES: Record<string, string> = {
	text: 'Text',
	file: 'Note',
	url: 'Link',
	label: 'Label',
	type: 'Type',
	x: 'Horizontal position',
	y: 'Vertical position',
	width: 'Width',
	height: 'Height',
	color: 'Color',
	fromNode: 'From',
	toNode: 'To',
	fromSide: 'From side',
	toSide: 'To side',
	fromEnd: 'Start arrow',
	toEnd: 'End arrow',
	fr5a: 'Map settings'
};
export function diffMap(before: string | null, after: string | null): MapDiff {
	try {
		const old = parse(before),
			next = parse(after);
		const names = new Map([...old.nodes, ...next.nodes].map((n) => [n.id, nodeName(n)]));
		const name = (item: Item, edge: boolean) =>
			edge
				? `${names.get(String(item.fromNode)) ?? 'Missing node'} → ${names.get(String(item.toNode)) ?? 'Missing node'}${item.label ? ` · ${item.label}` : ''}`
				: nodeName(item);
		const compare = (a: Item[], b: Item[], edge: boolean): MapEdit[] => {
			const previous = new Map(a.map((n) => [n.id, n]));
			const current = new Map(b.map((n) => [n.id, n]));
			const edits: MapEdit[] = [];
			for (const id of new Set([...previous.keys(), ...current.keys()])) {
				const from = previous.get(id),
					to = current.get(id);
				const fields: MapEdit['fields'] = [];
				for (const key of new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})])) {
					if (key === 'id' || stable(from?.[key]) === stable(to?.[key])) continue;
					const format = (value: unknown) =>
						key === 'fromNode' || key === 'toNode'
							? (names.get(String(value)) ?? (value === undefined ? 'Not set' : 'Missing node'))
							: show(value);
					fields.push({
						name: FIELD_NAMES[key] ?? key,
						before: format(from?.[key]),
						after: format(to?.[key])
					});
				}
				if (fields.length || !from || !to)
					edits.push({
						id,
						kind: !from ? 'added' : !to ? 'removed' : 'changed',
						label: name(to ?? from!, edge),
						fields
					});
			}
			return edits;
		};
		const reordered = (from: Item[], to: Item[]) => {
			const oldIds = new Set(from.map((n) => n.id));
			const newIds = new Set(to.map((n) => n.id));
			return (
				stable(from.filter((n) => newIds.has(n.id)).map((n) => n.id)) !==
				stable(to.filter((n) => oldIds.has(n.id)).map((n) => n.id))
			);
		};
		const extras = (doc: Canvas) =>
			Object.fromEntries(Object.entries(doc).filter(([key]) => key !== 'nodes' && key !== 'edges'));
		return {
			nodes: compare(old.nodes, next.nodes, false),
			edges: compare(old.edges, next.edges, true),
			error: null,
			other:
				stable(extras(old)) !== stable(extras(next)) ||
				reordered(old.nodes, next.nodes) ||
				reordered(old.edges, next.edges)
		};
	} catch (err) {
		return {
			nodes: [],
			edges: [],
			other: false,
			error: err instanceof Error ? err.message : 'The map cannot be compared.'
		};
	}
}
