import { describe, expect, it } from 'vitest';
import type { MindMapConfig, NoteMeta } from '../../../shared/types';
import {
	buildWorkspaceLinkIndex,
	compileMindMap,
	layoutMindMap,
	MAX_COMPILED_MIND_MAP_NODES,
	pinDerivedNode
} from './mindMaps';

const note = (id: string, title: string, tags: string[] = []): NoteMeta => ({
	id,
	absPath: `/${id}`,
	title,
	snippet: '',
	mtime: 0,
	tags,
	pinned: false,
	locked: false,
	aiLocal: false,
	encrypted: false,
	mindMapVersion: null
});

const notes = [
	note('Maps/Atlas.md', 'Atlas map'),
	note('Projects/Atlas.md', 'Atlas', ['work/atlas']),
	note('Research/Interviews.md', 'Interviews', ['work/atlas/research']),
	note('Build.md', 'Build', ['work'])
];
const contents = new Map([
	['Projects/Atlas.md', '[Interviews](../Research/Interviews.md)'],
	['Research/Interviews.md', '[Build](../Build.md)'],
	['Build.md', '[Atlas](Projects/Atlas.md)']
]);

describe('curated mind map compiler', () => {
	it('deduplicates identical edges while preserving different relation kinds and tag paths', () => {
		const config: MindMapConfig = {
			version: 1,
			root: 'atlas',
			nodes: [
				{
					id: 'atlas',
					note: '/Projects/Atlas.md',
					children: ['interviews', 'interviews'],
					expand: { links: 'outgoing', tags: ['work/atlas/*', 'work/atlas/*'] }
				},
				{ id: 'interviews', note: '/Research/Interviews.md' }
			],
			edges: [
				{ from: 'atlas', to: 'interviews' },
				{ from: 'atlas', to: 'interviews' }
			]
		};
		const graph = compileMindMap(config, buildWorkspaceLinkIndex(notes, contents), 'Maps/Atlas.md');
		const keys = graph.edges.map((edge) => JSON.stringify([edge.kind, edge.from, edge.to]));
		expect(new Set(keys).size).toBe(graph.edges.length);
		for (const kind of ['branch', 'cross', 'markdown-link'])
			expect(graph.edges).toContainEqual({ from: 'atlas', to: 'interviews', kind });
		expect(graph.edges).toContainEqual({ from: 'atlas', to: 'tag:work/atlas', kind: 'tag' });
		expect(graph.edges).toContainEqual({ from: 'tag:work/atlas', to: 'interviews', kind: 'tag' });
	});

	it('bounds the total compiled graph across independently limited expansions', () => {
		const config: MindMapConfig = {
			version: 1,
			root: 'node-0',
			nodes: Array.from({ length: MAX_COMPILED_MIND_MAP_NODES / 2 }, (_, i) => ({
				id: `node-${i}`,
				expand: { tags: [`tag-${i}`] }
			}))
		};
		const index = buildWorkspaceLinkIndex([], new Map());
		expect(compileMindMap(config, index, 'Map.md').nodes).toHaveLength(MAX_COMPILED_MIND_MAP_NODES);
		config.nodes[0].expand!.tags!.push('one-more-tag');
		expect(() => compileMindMap(config, index, 'Map.md')).toThrow('2,000-node display limit');
	});

	it('combines authored hierarchy, cross-links, links, backlinks and selected tags', () => {
		const config: MindMapConfig = {
			version: 1,
			root: 'atlas',
			nodes: [
				{
					id: 'atlas',
					note: '../Projects/Atlas.md',
					children: ['idea'],
					expand: { links: 'both', tags: ['work/atlas/*'], depth: 2, limit: 10 }
				},
				{ id: 'idea', label: 'Idea' }
			],
			edges: [{ from: 'idea', to: 'atlas', label: 'shapes' }]
		};
		const graph = compileMindMap(config, buildWorkspaceLinkIndex(notes, contents), 'Maps/Atlas.md');
		expect(graph.nodes.find((node) => node.id === 'atlas')?.kind).toBe('root');
		expect(graph.edges).toContainEqual({ from: 'atlas', to: 'idea', kind: 'branch' });
		expect(graph.edges).toContainEqual({
			from: 'idea',
			to: 'atlas',
			kind: 'cross',
			label: 'shapes'
		});
		expect(
			graph.nodes.some(
				(node) => node.noteId === 'Research/Interviews.md' && node.provenance === 'derived'
			)
		).toBe(true);
		expect(graph.nodes.some((node) => node.kind === 'tag' && node.title === '#work/atlas')).toBe(
			true
		);
		expect(graph.nodes.some((node) => node.noteId === 'Build.md')).toBe(true);
	});

	it('keeps missing notes visible and lets explicit nodes win over derived duplicates', () => {
		const config: MindMapConfig = {
			version: 1,
			root: 'atlas',
			nodes: [
				{
					id: 'atlas',
					note: '../Projects/Atlas.md',
					children: ['interviews', 'lost'],
					expand: { links: 'outgoing' }
				},
				{ id: 'interviews', note: '../Research/Interviews.md' },
				{ id: 'lost', note: '../Gone.md' }
			]
		};
		const graph = compileMindMap(config, buildWorkspaceLinkIndex(notes, contents), 'Maps/Atlas.md');
		expect(graph.nodes.find((node) => node.id === 'lost')?.kind).toBe('missing');
		expect(graph.nodes.filter((node) => node.noteId === 'Research/Interviews.md')).toHaveLength(1);
		expect(
			graph.edges.some(
				(edge) => edge.from === 'atlas' && edge.to === 'interviews' && edge.kind === 'markdown-link'
			)
		).toBe(true);
	});

	it('applies limits deterministically and records overflow', () => {
		const config: MindMapConfig = {
			version: 1,
			root: 'atlas',
			nodes: [
				{
					id: 'atlas',
					note: '../Projects/Atlas.md',
					expand: { links: 'both', tags: ['work/*'], limit: 1 }
				}
			]
		};
		const graph = compileMindMap(config, buildWorkspaceLinkIndex(notes, contents), 'Maps/Atlas.md');
		expect(
			graph.nodes.filter((node) => node.provenance === 'derived' && node.kind === 'note')
		).toHaveLength(1);
		expect(graph.overflow.get('atlas')).toBeGreaterThan(0);
	});

	it('lays out branch order deterministically and honours saved positions', () => {
		const config: MindMapConfig = {
			version: 1,
			root: 'r',
			nodes: [
				{ id: 'r', label: 'Root', children: ['a', 'b', 'c'] },
				{ id: 'a', label: 'A' },
				{ id: 'b', label: 'B', position: { x: -999, y: 44 } },
				{ id: 'c', label: 'C' }
			]
		};
		const nodes = config.nodes.map((node) => ({
			id: node.id,
			kind: node.id === 'r' ? ('root' as const) : ('concept' as const),
			provenance: 'explicit' as const,
			title: node.label!,
			x: 0,
			y: 0
		}));
		layoutMindMap(config, nodes);
		expect(nodes.find((node) => node.id === 'a')!.x).toBeGreaterThan(0);
		expect(nodes.find((node) => node.id === 'b')).toMatchObject({ x: -999, y: 44 });
		expect(nodes.find((node) => node.id === 'c')!.x).toBeGreaterThan(0);
	});

	it('pins a derived tag as an attached explicit node and hides its automatic copy', () => {
		const config: MindMapConfig = {
			version: 1,
			root: 'atlas',
			nodes: [{ id: 'atlas', label: 'Atlas' }]
		};
		const next = pinDerivedNode(config, {
			id: 'tag:work/atlas',
			kind: 'tag',
			provenance: 'derived',
			title: '#work/atlas',
			originId: 'atlas',
			x: 40,
			y: 20
		});
		const pinned = next.nodes.at(-1)!;
		expect(pinned).toMatchObject({ label: '#work/atlas', position: { x: 40, y: 20 } });
		expect(next.edges).toContainEqual({ from: 'atlas', to: pinned.id });
		expect(next.hidden).toContain('tag:work/atlas');
		const expanded = compileMindMap(
			{
				...next,
				nodes: next.nodes.map((node) =>
					node.id === 'atlas' ? { ...node, expand: { tags: ['work/atlas'] } } : node
				)
			},
			buildWorkspaceLinkIndex(notes, contents),
			'Maps/Atlas.md'
		);
		expect(expanded.nodes.filter((node) => node.title === '#work/atlas')).toHaveLength(1);
		expect(expanded.edges).toContainEqual({
			from: pinned.id,
			to: 'note:Projects/Atlas.md',
			kind: 'tag'
		});
	});

	it('expands selected tags from concept nodes without including unrelated tags', () => {
		const config: MindMapConfig = {
			version: 1,
			root: 'r',
			nodes: [{ id: 'r', label: 'Research', expand: { tags: ['work/atlas'] } }]
		};
		const graph = compileMindMap(config, buildWorkspaceLinkIndex(notes, contents), 'Maps/Atlas.md');
		expect(graph.nodes.filter((node) => node.kind === 'tag').map((node) => node.title)).toEqual([
			'#work/atlas'
		]);
		expect(graph.nodes.filter((node) => node.noteId).map((node) => node.noteId)).toEqual([
			'Projects/Atlas.md'
		]);
		const wildcard = compileMindMap(
			{ ...config, nodes: [{ ...config.nodes[0], expand: { tags: ['work/atlas/*'] } }] },
			buildWorkspaceLinkIndex(notes, contents),
			'Maps/Atlas.md'
		);
		expect(wildcard.nodes.some((node) => node.noteId === 'Research/Interviews.md')).toBe(true);
	});

	it('connects depth-two links and backlinks to their actual intermediate nodes', () => {
		const config: MindMapConfig = {
			version: 1,
			root: 'r',
			nodes: [{ id: 'r', note: '/Projects/Atlas.md', expand: { links: 'both', depth: 2 } }]
		};
		const graph = compileMindMap(config, buildWorkspaceLinkIndex(notes, contents), 'Maps/Atlas.md');
		expect(graph.edges).toContainEqual({
			from: 'note:Research/Interviews.md',
			to: 'note:Build.md',
			kind: 'markdown-link'
		});
		expect(graph.edges).toContainEqual({
			from: 'note:Research/Interviews.md',
			to: 'note:Build.md',
			kind: 'backlink'
		});
	});

	it('ignores frontmatter links and chooses limited items independent of link order', () => {
		const rows = new Map(contents);
		rows.set(
			'Projects/Atlas.md',
			'---\nexample: "[No](../Maps/Atlas.md)"\n---\n[Interviews](../Research/Interviews.md) [Build](../Build.md)'
		);
		const index = buildWorkspaceLinkIndex(notes, rows);
		expect(index.outgoing.get('Projects/Atlas.md')).not.toContain('Maps/Atlas.md');
		const config: MindMapConfig = {
			version: 1,
			root: 'r',
			nodes: [{ id: 'r', note: '/Projects/Atlas.md', expand: { links: 'outgoing', limit: 1 } }]
		};
		const graph = compileMindMap(config, index, 'Maps/Atlas.md');
		expect(graph.nodes.find((node) => node.provenance === 'derived')?.title).toBe('Build');
		expect(graph.overflow.get('r')).toBe(1);
		const hidden = compileMindMap({ ...config, hidden: ['note:Build.md'] }, index, 'Maps/Atlas.md');
		expect(hidden.nodes.find((node) => node.provenance === 'derived')?.title).toBe('Interviews');
	});
});
