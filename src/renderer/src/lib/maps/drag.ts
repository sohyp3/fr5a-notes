/** Follow outgoing parent → child connections, visiting shared children and cycles once. */
export function descendants(
	roots: ReadonlySet<string>,
	edges: readonly { source: string; target: string }[]
): Set<string> {
	const children = new Map<string, string[]>();
	for (const edge of edges) {
		const list = children.get(edge.source) ?? [];
		list.push(edge.target);
		children.set(edge.source, list);
	}
	const visited = new Set(roots);
	const pending = [...roots];
	for (let i = 0; i < pending.length; i++) {
		for (const id of children.get(pending[i]) ?? []) {
			if (visited.has(id)) continue;
			visited.add(id);
			pending.push(id);
		}
	}
	return visited;
}
