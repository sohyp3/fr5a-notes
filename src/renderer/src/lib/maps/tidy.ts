/**
 * Tidy: a left-to-right layered layout (dagre). Loaded only when Tidy is
 * pressed, so dagre stays out of the map chunk until then.
 */
export interface TidyItem {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * New top-left positions for `items`, linked by `links` (other links are
 * ignored). The result keeps the items' old top-left corner, so tidying a
 * selection doesn't throw it across the map.
 */
export async function tidyLayout(
	items: readonly TidyItem[],
	links: readonly { source: string; target: string }[]
): Promise<Map<string, { x: number; y: number }>> {
	if (items.length === 0) return new Map();
	const { Graph, layout } = await import('@dagrejs/dagre');
	const g = new Graph({ multigraph: false });
	g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 100, marginx: 0, marginy: 0 });
	g.setDefaultEdgeLabel(() => ({}));
	const ids = new Set(items.map((i) => i.id));
	for (const i of items) g.setNode(i.id, { width: i.width, height: i.height });
	for (const l of links)
		if (ids.has(l.source) && ids.has(l.target) && l.source !== l.target)
			g.setEdge(l.source, l.target);
	layout(g);
	const out = new Map<string, { x: number; y: number }>();
	let minX = Infinity;
	let minY = Infinity;
	for (const i of items) {
		const n = g.node(i.id) as { x: number; y: number };
		const p = { x: n.x - i.width / 2, y: n.y - i.height / 2 };
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		out.set(i.id, p);
	}
	const ox = Math.min(...items.map((i) => i.x)) - minX;
	const oy = Math.min(...items.map((i) => i.y)) - minY;
	for (const [id, p] of out) out.set(id, { x: Math.round(p.x + ox), y: Math.round(p.y + oy) });
	return out;
}
