import type {
	CompiledMindMapEdge,
	CompiledMindMapNode,
	MindMapConfig,
	NoteMeta
} from '../../../shared/types';
import { parseNoteLinks, resolveNoteHref } from './linkedNotes';

export interface WorkspaceLinkIndex {
	outgoing: Map<string, string[]>;
	incoming: Map<string, string[]>;
	notes: readonly NoteMeta[];
}

export interface CompiledMindMap {
	nodes: CompiledMindMapNode[];
	edges: CompiledMindMapEdge[];
	overflow: Map<string, number>;
}

// Expansion limits apply per authored node; also bound the whole rendered graph.
export const MAX_COMPILED_MIND_MAP_NODES = 2000;

export function buildWorkspaceLinkIndex(
	notes: readonly NoteMeta[],
	contents: ReadonlyMap<string, string>
): WorkspaceLinkIndex {
	const outgoing = new Map<string, string[]>();
	const incoming = new Map<string, string[]>();
	for (const note of notes) {
		const targets: string[] = [];
		for (const link of parseNoteLinks(contents.get(note.id) ?? '')) {
			const hit = resolveNoteHref(notes, link.target, note.id);
			if (hit && !targets.includes(hit.id)) targets.push(hit.id);
		}
		outgoing.set(note.id, targets);
		for (const target of targets) incoming.set(target, [...(incoming.get(target) ?? []), note.id]);
	}
	return { outgoing, incoming, notes };
}

const compareNotes = (a: NoteMeta, b: NoteMeta) =>
	a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

export function layoutMindMap(config: MindMapConfig, nodes: CompiledMindMapNode[]): void {
	const specs = new Map(config.nodes.map((node) => [node.id, node]));
	const compiled = new Map(nodes.map((node) => [node.id, node]));
	const parentIds = new Map<string, string>();
	for (const node of config.nodes)
		for (const child of node.children ?? []) parentIds.set(child, node.id);
	const placed = new Set<string>();
	const root = compiled.get(config.root);
	const span = (id: string): number => {
		const children = specs.get(id)?.children ?? [];
		return Math.max(
			1,
			children.reduce((total, child) => total + span(child), 0)
		);
	};
	if (root) {
		root.x = specs.get(config.root)?.position?.x ?? 0;
		root.y = specs.get(config.root)?.position?.y ?? 0;
		placed.add(root.id);
	}
	const placeBranch = (id: string, side: -1 | 1, depth: number, y: number): void => {
		const spec = specs.get(id);
		const node = compiled.get(id);
		if (!spec || !node) return;
		if (spec.position) {
			node.x = spec.position.x;
			node.y = spec.position.y;
			node.fixed = true;
		} else {
			node.x = (compiled.get(parentIds.get(id) ?? config.root)?.x ?? 0) + side * 250;
			node.y = y;
		}
		placed.add(id);
		const children = spec.children ?? [];
		let cursor = node.y - children.reduce((total, child) => total + span(child), 0) * 56;
		for (const child of children) {
			const size = span(child) * 112;
			placeBranch(child, side, depth + 1, cursor + size / 2);
			cursor += size;
		}
	};
	const roots = specs.get(config.root)?.children ?? [];
	const sideSizes = [0, 0];
	roots.forEach((id, index) => (sideSizes[index % 2] += span(id) * 112 + 38));
	const cursors = sideSizes.map((size) => (root?.y ?? 0) - size / 2);
	roots.forEach((id, index) => {
		const side: -1 | 1 = index % 2 === 0 ? 1 : -1;
		const slot = index % 2;
		const size = span(id) * 112 + 38;
		placeBranch(id, side, 1, cursors[slot] + size / 2);
		cursors[slot] += size;
	});
	for (const spec of config.nodes) {
		if (placed.has(spec.id)) continue;
		placeBranch(
			spec.id,
			(spec.position?.x ?? 1) < 0 ? -1 : 1,
			1,
			spec.position?.y ?? (placed.size + 1) * 90
		);
	}
	const byOrigin = new Map<string, CompiledMindMapNode[]>();
	for (const node of nodes)
		if (node.provenance === 'derived' && node.originId)
			byOrigin.set(node.originId, [...(byOrigin.get(node.originId) ?? []), node]);
	for (const [originId, derived] of byOrigin) {
		const origin = compiled.get(originId);
		if (!origin) continue;
		const side = origin.x < 0 ? -1 : 1;
		derived.forEach((node, index) => {
			// A bounded local grid stays readable even at the maximum expansion.
			const rows = Math.min(7, derived.length);
			node.x = origin.x + side * (230 + Math.floor(index / rows) * 210);
			node.y = origin.y + ((index % rows) - (rows - 1) / 2) * 86;
		});
	}
}

export function compileMindMap(
	config: MindMapConfig,
	index: WorkspaceLinkIndex,
	mapId: string
): CompiledMindMap {
	const nodes: CompiledMindMapNode[] = [];
	const addNode = (node: CompiledMindMapNode): void => {
		if (nodes.length >= MAX_COMPILED_MIND_MAP_NODES)
			throw new Error(
				`This mind map exceeds the ${MAX_COMPILED_MIND_MAP_NODES.toLocaleString('en-US')}-node display limit. Reduce automatic expansion or split it into smaller maps in the source note.`
			);
		nodes.push(node);
	};
	const edges: CompiledMindMapEdge[] = [];
	const overflow = new Map<string, number>();
	const specs = new Map(config.nodes.map((node) => [node.id, node]));
	const explicitByNote = new Map<string, string>();
	const noteById = new Map(index.notes.map((note) => [note.id, note]));
	const resolved = new Map<string, NoteMeta | null>();
	for (const spec of config.nodes) {
		const note = spec.note ? resolveNoteHref(index.notes, spec.note, mapId) : null;
		resolved.set(spec.id, note);
		if (note) explicitByNote.set(note.id, spec.id);
		addNode({
			id: spec.id,
			kind:
				spec.note && !note
					? 'missing'
					: spec.id === config.root
						? 'root'
						: spec.note
							? 'note'
							: 'concept',
			provenance: 'explicit',
			title: spec.label?.trim() || note?.title || spec.note || spec.id,
			...(note ? { noteId: note.id } : {}),
			x: spec.position?.x ?? 0,
			y: spec.position?.y ?? 0,
			fixed: !!spec.position
		});
		for (const child of spec.children ?? [])
			if (specs.has(child)) edges.push({ from: spec.id, to: child, kind: 'branch' });
	}
	for (const edge of config.edges ?? [])
		if (specs.has(edge.from) && specs.has(edge.to))
			edges.push({ from: edge.from, to: edge.to, kind: 'cross', label: edge.label });

	const hidden = new Set(config.hidden ?? []);
	const derivedByNote = new Map<string, string>();
	const addNote = (noteId: string, originId: string): string | null => {
		const authored = explicitByNote.get(noteId);
		if (authored) return authored;
		if (hidden.has(`note:${noteId}`)) return null;
		let id = derivedByNote.get(noteId);
		if (!id) {
			id = `note:${noteId}`;
			derivedByNote.set(noteId, id);
			const note = noteById.get(noteId)!;
			addNode({
				id,
				kind: 'note',
				provenance: 'derived',
				title: note.title,
				noteId,
				originId,
				x: 0,
				y: 0
			});
		}
		return id;
	};
	for (const spec of config.nodes) {
		const source = resolved.get(spec.id);
		const expand = spec.expand;
		if (!expand) continue;
		const limit = Math.min(100, Math.max(0, expand.limit ?? 24));
		const depth = Math.min(2, Math.max(0, expand.depth ?? 1));
		const order = (a: string, b: string) => compareNotes(noteById.get(a)!, noteById.get(b)!);
		const outgoing: { from: string; id: string; level: number }[] = [];
		const incoming: { to: string; id: string; level: number }[] = [];
		if (source && (expand.links === 'outgoing' || expand.links === 'both')) {
			let frontier = [source.id];
			const seen = new Set(frontier);
			for (let level = 0; level < depth; level++) {
				const next: string[] = [];
				for (const from of frontier)
					for (const id of [...(index.outgoing.get(from) ?? [])].sort(order))
						if (!seen.has(id)) {
							seen.add(id);
							outgoing.push({ from, id, level });
							next.push(id);
						}
				frontier = next;
			}
		}
		if (source && (expand.links === 'incoming' || expand.links === 'both')) {
			let frontier = [source.id];
			const seen = new Set(frontier);
			for (let level = 0; level < depth; level++) {
				const next: string[] = [];
				for (const to of frontier)
					for (const id of [...(index.incoming.get(to) ?? [])].sort(order))
						if (!seen.has(id)) {
							seen.add(id);
							incoming.push({ to, id, level });
							next.push(id);
						}
				frontier = next;
			}
		}
		const tagNotes = index.notes
			.filter((note) =>
				(expand.tags ?? []).some((pattern) =>
					pattern.endsWith('/*')
						? note.tags.some(
								(tag) => tag === pattern.slice(0, -2) || tag.startsWith(`${pattern.slice(0, -2)}/`)
							)
						: note.tags.includes(pattern)
				)
			)
			.sort(compareNotes);
		const candidates = [
			...outgoing.map((entry) => ({ type: 'out' as const, ...entry })),
			...incoming.map((entry) => ({ type: 'in' as const, ...entry })),
			...tagNotes.map((note) => ({ type: 'tag' as const, id: note.id, level: 0 }))
		].filter((item) => item.id !== source?.id && !hidden.has(`note:${item.id}`));
		const priority = { out: 0, in: 1, tag: 2 };
		candidates.sort(
			(a, b) => a.level - b.level || priority[a.type] - priority[b.type] || order(a.id, b.id)
		);
		const allowed = new Set<string>();
		const omitted = new Set<string>();
		for (const item of candidates) {
			if (explicitByNote.has(item.id) || allowed.has(item.id)) continue;
			if (allowed.size < limit) allowed.add(item.id);
			else omitted.add(item.id);
		}
		const included = candidates.filter(
			(item) => explicitByNote.has(item.id) || allowed.has(item.id)
		);
		if (omitted.size) overflow.set(spec.id, omitted.size);
		for (const item of included) {
			const target = addNote(item.id, spec.id);
			if (!target) continue;
			if (item.type === 'out')
				edges.push({
					from: explicitByNote.get(item.from) ?? derivedByNote.get(item.from) ?? spec.id,
					to: target,
					kind: 'markdown-link'
				});
			else if (item.type === 'in')
				edges.push({
					from: target,
					to: explicitByNote.get(item.to) ?? derivedByNote.get(item.to) ?? spec.id,
					kind: 'backlink'
				});
		}
		for (const pattern of expand.tags ?? []) {
			const tag = pattern.replace(/\/\*$/, '');
			const derivedId = `tag:${tag}`;
			const pinned = config.nodes.find((node) => !node.note && node.label === `#${tag}`);
			const id = pinned?.id ?? derivedId;
			const suppressed = !pinned && hidden.has(derivedId);
			if (!nodes.some((node) => node.id === id) && !suppressed)
				addNode({
					id,
					kind: 'tag',
					provenance: 'derived',
					title: `#${tag}`,
					originId: spec.id,
					x: 0,
					y: 0
				});
			if (!suppressed && spec.id !== id) edges.push({ from: spec.id, to: id, kind: 'tag' });
			for (const note of included.filter(
				(item) =>
					item.type === 'tag' &&
					(noteById
						.get(item.id)
						?.tags.some((path) =>
							pattern.endsWith('/*') ? path === tag || path.startsWith(`${tag}/`) : path === tag
						) ??
						false)
			)) {
				const target = explicitByNote.get(note.id) ?? derivedByNote.get(note.id);
				if (target && !suppressed) edges.push({ from: id, to: target, kind: 'tag' });
			}
		}
	}
	// Deduplicate only identical relations. Different kinds and paths carry meaning.
	const uniqueEdges = [
		...new Map(edges.map((edge) => [`${edge.from}\0${edge.to}\0${edge.kind}`, edge])).values()
	];
	layoutMindMap(config, nodes);
	return { nodes, edges: uniqueEdges, overflow };
}

export function pinDerivedNode(config: MindMapConfig, node: CompiledMindMapNode): MindMapConfig {
	if (node.provenance !== 'derived') return config;
	const base =
		(
			node.noteId
				?.replace(/\.[^.]+$/, '')
				.split('/')
				.at(-1) ?? node.title
		)
			.toLocaleLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.replace(/^-|-$/g, '') || 'node';
	let id = base;
	let suffix = 2;
	while (config.nodes.some((item) => item.id === id)) id = `${base}-${suffix++}`;
	const hiddenKey = node.kind === 'tag' ? node.id : `note:${node.noteId}`;
	return {
		...config,
		nodes: [
			...config.nodes,
			{
				id,
				label: node.title,
				...(node.noteId ? { note: `/${node.noteId}` } : {}),
				position: { x: node.x, y: node.y }
			}
		],
		edges: node.originId
			? [...(config.edges ?? []), { from: node.originId, to: id }]
			: config.edges,
		hidden: [...new Set([...(config.hidden ?? []), hiddenKey])]
	};
}
