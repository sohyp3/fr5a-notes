import { describe, expect, it } from 'vitest';
import { diffMap } from './diff';
const node = (id: string, text = id) => ({
	id,
	type: 'text',
	text,
	x: 0,
	y: 0,
	width: 200,
	height: 60
});
const source = (nodes: unknown[], edges: unknown[] = [], extra = {}) =>
	JSON.stringify({ nodes, edges, ...extra });
describe('semantic map differences', () => {
	it('shows added/deleted nodes and labels connections by their visible text', () => {
		const result = diffMap(
			source([node('a', 'Before'), node('b', 'Removed')]),
			source(
				[node('a', 'Before'), node('c', 'Added')],
				[{ id: 'edge', fromNode: 'a', toNode: 'c' }]
			)
		);
		expect(result.nodes.map((n) => [n.kind, n.label])).toEqual([
			['removed', 'Removed'],
			['added', 'Added']
		]);
		expect(result.edges[0].label).toBe('Before → Added');
		expect(result.other).toBe(false);
		expect(result.edges[0].fields.find((f) => f.name === 'To')?.after).toBe('Added');
	});
	it('describes content, movement, size, color, metadata and unknown fields', () => {
		const result = diffMap(
			source([node('a')]),
			source(
				[
					{
						...node('a', 'Changed text'),
						x: 100,
						y: 80,
						width: 300,
						height: 90,
						color: '2',
						custom: 'preserved'
					}
				],
				[],
				{ customRoot: true }
			)
		);
		expect(result.nodes[0].fields.map((f) => f.name)).toEqual(
			expect.arrayContaining([
				'Text',
				'Horizontal position',
				'Vertical position',
				'Width',
				'Height',
				'Color',
				'custom'
			])
		);
		expect(result.other).toBe(true);
	});
	it('shows edge reconnections, labels and arrows', () => {
		const nodes = [node('a', 'Alpha'), node('b', 'Beta'), node('c', 'Gamma')];
		const result = diffMap(
			source(nodes, [{ id: 'e', fromNode: 'a', toNode: 'b' }]),
			source(nodes, [{ id: 'e', fromNode: 'a', toNode: 'c', label: 'supports', toEnd: 'arrow' }])
		);
		expect(result.edges[0].fields).toContainEqual({ name: 'To', before: 'Beta', after: 'Gamma' });
	});
	it('treats absent sides as empty maps and preserves multiline text', () => {
		const added = diffMap(null, source([node('a', 'Long\nmultiline text')]));
		expect(added.nodes[0].label).toBe('Long');
		expect(added.nodes[0].fields.find((field) => field.name === 'Text')?.after).toBe(
			'Long\nmultiline text'
		);
		expect(diffMap(source([node('a')]), null).nodes[0].kind).toBe('removed');
	});
	it.each(['broken', '{"nodes":[{}]}', '{"nodes":[{"id":"a"},{"id":"a"}]}'])(
		'falls back for malformed canvas %s',
		(text) => {
			expect(diffMap(null, text).error).toBeTruthy();
		}
	);
	it('ignores JSON key ordering but identifies drawing order changes', () => {
		expect(diffMap('{"nodes":[],"edges":[]}', '{"edges":[],"nodes":[]}')).toEqual({
			nodes: [],
			edges: [],
			other: false,
			error: null
		});
		expect(diffMap(source([node('a'), node('b')]), source([node('b'), node('a')])).other).toBe(
			true
		);
	});
});
