import { describe, expect, it } from 'vitest';
import {
	CanvasError,
	cleanMapName,
	excludeDeleted,
	fromFlow,
	kindOf,
	mapNameOf,
	newForTag,
	nodeColors,
	parseCanvas,
	populateTag,
	presentFor,
	rewritePaths,
	ringSlot,
	serializeCanvas,
	toFlow,
	untaggedTag,
	type CanvasDoc
} from './canvas';

const sample = {
	nodes: [
		{ id: 'a', type: 'text', text: 'Launch plan', x: 0, y: 0, width: 200, height: 60, color: '5' },
		{
			id: 'b',
			type: 'file',
			file: 'Projects/Atlas.md',
			x: 300,
			y: 0,
			width: 240,
			height: 90,
			obsidianOnly: { keep: true }
		},
		{
			id: 't',
			type: 'text',
			text: '#work/atlas',
			x: 0,
			y: 200,
			width: 160,
			height: 44,
			fr5a: { tag: 'work/atlas', exclude: ['Old.md'], future: 1 }
		},
		{
			id: 'n1',
			type: 'file',
			file: 'Projects/Spec.md',
			x: 260,
			y: 220,
			width: 240,
			height: 90,
			fr5a: { from: 't' }
		},
		{ id: 'g', type: 'group', label: 'Box', x: -50, y: -50, width: 700, height: 400 }
	],
	edges: [
		{ id: 'e1', fromNode: 'a', toNode: 'b', label: 'informs', fromSide: 'right', toSide: 'left' },
		{ id: 'e2', fromNode: 't', toNode: 'n1', fr5a: { from: 't' } }
	],
	topLevelExtra: 'kept'
};

let counter = 0;
const ids = () => `id${++counter}`;

describe('JSON Canvas files', () => {
	it('round-trips, unknown fields included', () => {
		const text = JSON.stringify(sample);
		const { doc, skipped } = parseCanvas(text);
		expect(JSON.parse(serializeCanvas(doc, skipped))).toEqual(sample);
	});

	it('round-trips through Svelte Flow nodes and edges', () => {
		const { doc } = parseCanvas(JSON.stringify(sample));
		const flow = toFlow(doc);
		expect(flow.nodes.map((n) => n.type)).toEqual(['concept', 'note', 'tag', 'note', 'other']);
		expect(flow.edges[0]).toMatchObject({ source: 'a', target: 'b', sourceHandle: 'right' });
		expect(fromFlow(doc, flow.nodes, flow.edges)).toEqual(doc);
	});

	it('writes back dragged positions, measured sizes and edge labels', () => {
		const { doc } = parseCanvas(JSON.stringify(sample));
		const flow = toFlow(doc);
		flow.nodes[0] = {
			...flow.nodes[0],
			position: { x: 10.4, y: -20.6 },
			measured: { width: 151.2, height: 41 }
		};
		flow.edges[0] = { ...flow.edges[0], label: '  ', sourceHandle: null };
		const out = fromFlow(doc, flow.nodes, flow.edges);
		expect(out.nodes[0]).toMatchObject({
			x: 10,
			y: -21,
			width: 151,
			height: 41,
			text: 'Launch plan'
		});
		expect(out.edges[0]).not.toHaveProperty('label');
		expect(out.edges[0]).not.toHaveProperty('fromSide');
		expect(out.edges[0].toSide).toBe('left');
	});

	it('reads an empty file as an empty map and refuses what is not a canvas', () => {
		expect(parseCanvas('').doc).toEqual({ nodes: [], edges: [] });
		expect(() => parseCanvas('{')).toThrow(CanvasError);
		expect(() => parseCanvas('[]')).toThrow(CanvasError);
		expect(() => parseCanvas('{"nodes": 3}')).toThrow(CanvasError);
	});

	it('sets aside broken entries and writes them back as they were', () => {
		const text = JSON.stringify({
			nodes: [
				{ id: 'ok', type: 'text', text: 'x', x: 1, y: 2 },
				{ id: 'ok', type: 'text', x: 0, y: 0 },
				{ type: 'text', x: 0, y: 0 },
				{ id: 'nopos', type: 'text' }
			],
			edges: [
				{ id: 'dangling', fromNode: 'ok', toNode: 'gone' },
				{ id: 'fine', fromNode: 'ok', toNode: 'ok', fromSide: 'middle' }
			]
		});
		const { doc, skipped } = parseCanvas(text);
		expect(doc.nodes.map((n) => n.id)).toEqual(['ok']);
		expect(doc.nodes[0]).toMatchObject({ width: 200, height: 60 });
		expect(doc.edges.map((e) => e.id)).toEqual(['fine']);
		expect(doc.edges[0]).not.toHaveProperty('fromSide');
		expect(skipped.nodes).toHaveLength(3);
		expect(skipped.edges).toHaveLength(1);
		const back = JSON.parse(serializeCanvas(doc, skipped));
		expect(back.nodes).toHaveLength(4);
		expect(back.edges.map((e: { id: string }) => e.id)).toEqual(['fine', 'dangling']);
	});

	it('does not pass non-string node and edge fields to the map renderer', () => {
		const raw = {
			nodes: [
				{ id: 'good', type: 'text', text: 'Good', x: 0, y: 0 },
				{ id: 'bad-file', type: 'file', file: { path: 'x.md' }, x: 1, y: 2 },
				{ id: 'bad-text', type: 'text', text: ['not text'], x: 2, y: 3 }
			],
			edges: [{ id: 'bad-label', fromNode: 'good', toNode: 'good', label: { text: 'bad' } }]
		};
		const parsed = parseCanvas(JSON.stringify(raw));
		expect(parsed.doc.nodes.map((n) => n.id)).toEqual(['good']);
		expect(parsed.doc.edges).toEqual([]);
		expect(parsed.skipped.nodes).toHaveLength(2);
		expect(parsed.skipped.edges).toHaveLength(1);
		const saved = JSON.parse(serializeCanvas(parsed.doc, parsed.skipped));
		expect(saved.nodes.slice(1)).toEqual(raw.nodes.slice(1));
		expect(saved.edges).toEqual(raw.edges);
	});

	it('names maps after their files', () => {
		expect(mapNameOf('Atlas plan.canvas')).toBe('Atlas plan');
		expect(mapNameOf('notes.md')).toBeNull();
		expect(mapNameOf('old/')).toBeNull();
		expect(cleanMapName('  ../a/b:c?  ')).toBe('a b c');
		expect(cleanMapName('.hidden')).toBe('hidden');
	});

	it('maps preset colors to the accent palette, mixed in JS', () => {
		expect(nodeColors('1', 'light')?.border).toBe('#ee5d50');
		expect(nodeColors('5', 'dark')?.border).toBe('#5b9dff');
		expect(nodeColors('#102030', 'light')).toEqual({
			border: '#102030',
			fill: 'rgba(16, 32, 48, 0.14)'
		});
		expect(nodeColors('9', 'light')).toBeNull();
		expect(nodeColors(undefined, 'light')).toBeNull();
	});

	it('tells node kinds apart', () => {
		const { doc } = parseCanvas(JSON.stringify(sample));
		expect(doc.nodes.map(kindOf)).toEqual(['concept', 'note', 'tag', 'note', 'other']);
	});
});

describe('tag nodes', () => {
	const notes = [
		{ id: 'Projects/Spec.md', tags: ['work/atlas'] },
		{ id: 'Projects/Atlas.md', tags: ['work/atlas/design'] },
		{ id: 'Old.md', tags: ['work/atlas'] },
		{ id: 'New.md', tags: ['work/atlas'] },
		{ id: 'Other.md', tags: ['work/atlasy', 'home'] }
	];
	const base = (): CanvasDoc => parseCanvas(JSON.stringify(sample)).doc;

	it('finds what a tag holds and what is new (descendant tags count, excluded ones never)', () => {
		const doc = base();
		expect([...presentFor(doc, 't')]).toEqual(['Projects/Spec.md']);
		expect(newForTag(doc, 't', notes)).toEqual(['Projects/Atlas.md', 'New.md']);
		expect(newForTag(doc, 'a', notes)).toEqual([]);
	});

	it('populates on rings, joins a note already on the map, and stamps what it adds', () => {
		const doc = base();
		const next = populateTag(doc, 't', notes, undefined, ids);
		// Atlas.md was on the map already: an edge only.
		expect(next.nodes.filter((n) => n.file === 'Projects/Atlas.md')).toHaveLength(1);
		const added = next.nodes.filter((n) => n.file === 'New.md');
		expect(added).toHaveLength(1);
		expect(added[0].fr5a).toEqual({ from: 't' });
		const newEdges = next.edges.slice(doc.edges.length);
		expect(newEdges.map((e) => [e.fromNode, e.toNode])).toEqual([
			['t', 'b'],
			['t', added[0].id]
		]);
		expect(newEdges.every((e) => e.fr5a?.from === 't' && e.toEnd === 'none')).toBe(true);
		expect(newForTag(next, 't', notes)).toEqual([]);
		// The input is left as it was.
		expect(doc.nodes).toHaveLength(5);
	});

	it('spreads ring slots without overlaps', () => {
		const slots = Array.from({ length: 30 }, (_, i) => ringSlot(i));
		for (let i = 0; i < slots.length; i++)
			for (let j = i + 1; j < slots.length; j++) {
				const d = Math.hypot(slots[i].x - slots[j].x, slots[i].y - slots[j].y);
				expect(d).toBeGreaterThan(80);
			}
	});

	it('takes a deleted note off its tag for good; deleting an idea changes nothing', () => {
		const before = populateTag(base(), 't', notes, undefined, ids);
		const newNode = before.nodes.find((n) => n.file === 'New.md')!;
		const after = {
			...before,
			nodes: before.nodes.filter((n) => n.id !== newNode.id && n.id !== 'a'),
			edges: before.edges.filter((e) => e.toNode !== newNode.id && e.fromNode !== 'a')
		};
		const out = excludeDeleted(before, after, [newNode.id, 'a']);
		expect(out.nodes.find((n) => n.id === 't')?.fr5a).toEqual({
			tag: 'work/atlas',
			exclude: ['Old.md', 'New.md'],
			future: 1
		});
		expect(newForTag(out, 't', notes)).toEqual([]);
		// A note that was on the map before the tag and joined to it is excluded too.
		const noB = { ...out, nodes: out.nodes.filter((n) => n.id !== 'b') };
		expect(excludeDeleted(out, noB, ['b']).nodes.find((n) => n.id === 't')?.fr5a?.exclude).toEqual([
			'Old.md',
			'New.md',
			'Projects/Atlas.md'
		]);
		expect(excludeDeleted(before, after, ['a'])).toBe(after);
	});

	it('flags a gathered note whose note lost the tag', () => {
		const doc = base();
		const n1 = doc.nodes.find((n) => n.id === 'n1')!;
		const tagsOf = (tags: string[]) => () => tags;
		expect(untaggedTag(doc, n1, tagsOf(['work/atlas']))).toBeNull();
		expect(untaggedTag(doc, n1, tagsOf(['home']))?.id).toBe('t');
		expect(untaggedTag(doc, n1, () => undefined)).toBeNull();
		expect(untaggedTag(doc, doc.nodes[1], tagsOf([]))).toBeNull();
	});
});

describe('moves', () => {
	it('rewrites note refs and exclude lists for a moved note or folder', () => {
		const { doc } = parseCanvas(JSON.stringify(sample));
		const note = rewritePaths(doc, 'Projects/Spec.md', 'Done/Spec.md')!;
		expect(note.nodes.find((n) => n.id === 'n1')?.file).toBe('Done/Spec.md');
		const folder = rewritePaths(doc, 'Projects', 'Archive/Projects')!;
		expect(folder.nodes.filter((n) => n.file).map((n) => n.file)).toEqual([
			'Archive/Projects/Atlas.md',
			'Archive/Projects/Spec.md'
		]);
		const ex = rewritePaths(doc, 'Old.md', 'Older.md')!;
		expect(ex.nodes.find((n) => n.id === 't')?.fr5a?.exclude).toEqual(['Older.md']);
		expect(rewritePaths(doc, 'Elsewhere.md', 'X.md')).toBeNull();
		// `Projects2` isn't inside `Projects`.
		expect(rewritePaths(doc, 'Proj', 'X')).toBeNull();
	});
});
