import { describe, expect, it } from 'vitest';
import { blankMap, mapChangeLines, mapPatch, mapSummary, validMapName } from './mapTools';
import { parseCanvas, serializeCanvas } from '../maps/canvas';
import type { NoteMeta } from '../../../../shared/types';

const notes = [{ id: 'ok.md', title: 'Allowed note' }] as NoteMeta[];
const meta = (id: string, overrides: Partial<NoteMeta> = {}): NoteMeta => ({
	id,
	absPath: `/w/${id}`,
	title: id,
	snippet: '',
	tags: [],
	mtime: 0,
	pinned: false,
	locked: false,
	aiLocal: false,
	encrypted: false,
	...overrides
});
const initial = JSON.stringify({
	custom: { preserved: true },
	nodes: [
		{ id: 'n', type: 'file', file: 'ok.md', x: 1, y: 2, width: 200, height: 60, custom: 'keep' },
		{ id: 't', type: 'text', text: 'Hello', x: 3, y: 4, width: 200, height: 60 }
	],
	edges: [{ id: 'e', fromNode: 'n', toNode: 't', extra: 42 }]
});

describe('AI canvas patches', () => {
	it('round trips extra fields, merges targeted updates and reports only linked metadata', () => {
		const before = parseCanvas(initial).doc;
		const next = mapPatch(
			{ nodes: [{ id: 'n', x: 10 }], edges: [{ id: 'e', label: 'linked' }] },
			before,
			notes
		);
		expect(parseCanvas(serializeCanvas(next)).doc).toEqual(next);
		expect(next.custom).toEqual({ preserved: true });
		expect(next.nodes[0]).toMatchObject({ x: 10, file: 'ok.md', custom: 'keep' });
		expect(next.edges[0]).toMatchObject({ extra: 42, label: 'linked' });
		expect(mapSummary('Map', serializeCanvas(next), notes)).toContain('Allowed note');
		expect(mapSummary('Map', initial, [])).toContain('"missing":true');
	});
	it('preserves fr5a and unknown fields even when the patch sends an invalid fr5a', () => {
		const before = parseCanvas(
			JSON.stringify({
				custom: { preserved: true },
				nodes: [
					{
						id: 'n',
						type: 'file',
						file: 'ok.md',
						x: 0,
						y: 0,
						width: 200,
						height: 60,
						fr5a: { tag: 'work', from: 'tag-1' },
						extra: 'kept'
					}
				],
				edges: []
			})
		).doc;
		const merged = mapPatch(
			{ nodes: [{ id: 'n', x: 10, fr5a: { exclude: ['done.md'] } }] },
			before,
			notes
		);
		expect(merged.nodes[0]).toMatchObject({
			x: 10,
			extra: 'kept',
			fr5a: { tag: 'work', from: 'tag-1', exclude: ['done.md'] }
		});
		const nulled = mapPatch({ nodes: [{ id: 'n', fr5a: null }] }, before, notes);
		expect(nulled.nodes[0].fr5a).toEqual({ tag: 'work', from: 'tag-1' });
		expect(parseCanvas(serializeCanvas(nulled)).doc).toEqual(nulled);
		expect(nulled.custom).toEqual({ preserved: true });
	});
	it('keeps prior tag exclusions when a patch sends an invalid exclude', () => {
		const before = parseCanvas(
			JSON.stringify({
				nodes: [
					{
						id: 't',
						type: 'text',
						text: 'Work',
						x: 0,
						y: 0,
						width: 200,
						height: 60,
						fr5a: { tag: 'work', exclude: ['done.md'] }
					}
				],
				edges: []
			})
		).doc;
		const replaced = mapPatch(
			{ nodes: [{ id: 't', fr5a: { exclude: ['other.md'] } }] },
			before,
			notes
		);
		expect(replaced.nodes[0].fr5a).toEqual({ tag: 'work', exclude: ['other.md'] });
		for (const bad of ['done.md', ['done.md', 3]]) {
			const merged = mapPatch({ nodes: [{ id: 't', fr5a: { exclude: bad } }] }, before, notes);
			expect(merged.nodes[0].fr5a).toEqual({ tag: 'work', exclude: ['done.md'] });
			expect(parseCanvas(serializeCanvas(merged)).doc).toEqual(merged);
		}
	});

	it('rejects malformed changes, unknown keys, missing links and invalid names', () => {
		const doc = parseCanvas(initial).doc;
		expect(() =>
			mapPatch({ nodes: [{ id: 'bad', type: 'file', file: 'missing.md', x: 0, y: 0 }] }, doc, notes)
		).toThrow(/does not exist/);
		expect(() =>
			mapPatch({ edges: [{ id: 'bad', fromNode: 'n', toNode: 'gone' }] }, doc, notes)
		).toThrow(/Invalid canvas edges: bad.*fromNode\/toNode/);
		expect(() => mapPatch({ nodes: [{ id: 'bad', type: 'text' }] }, doc, notes)).toThrow(
			/Invalid canvas nodes: bad.*numeric x\/y/
		);
		expect(() => mapPatch({ nodes: [{ id: 'x' }, { id: 'x' }] }, doc, notes)).toThrow(/Duplicate/);
		expect(() => mapPatch({ other: 1 }, doc, notes)).toThrow(/Patch/);
		expect(() => validMapName('../sessions/device')).toThrow();
		expect(() => validMapName('.hidden')).toThrow();
		expect(parseCanvas(blankMap()).doc.nodes).toEqual([]);
	});
});

describe('read_map metadata scope', () => {
	const canvas = JSON.stringify({
		nodes: [
			{ id: 'allowed', type: 'file', file: 'ideas/launch.md', x: 0, y: 0 },
			{ id: 'hidden', type: 'file', file: 'private/secret.md', x: 0, y: 0 },
			{ id: 'sealed', type: 'file', file: 'sealed.md', x: 0, y: 0 },
			{ id: 'unmentioned', type: 'file', file: 'other.md', x: 0, y: 0 },
			{ id: 'gone', type: 'file', file: 'gone.md', x: 0, y: 0 },
			{ id: 'gone-hidden', type: 'file', file: 'private/gone.md', x: 0, y: 0 }
		],
		edges: []
	});
	const vault = [
		meta('ideas/launch.md', { title: 'Launch plan' }),
		meta('private/secret.md', { title: 'Secret plans' }),
		meta('sealed.md', { title: 'Sealed note', encrypted: true }),
		meta('other.md', { title: 'Other note' })
	];

	it('gates titles by chat access and hides local-only paths', () => {
		const summary = JSON.parse(
			mapSummary('Project', canvas, vault, {
				allowedIds: new Set(['ideas/launch.md', 'sealed.md', 'private/secret.md']),
				hidden: (file) => file.startsWith('private/'),
				encryptedReadable: false
			})
		) as { nodes: Record<string, unknown>[] };
		const node = (id: string) => summary.nodes.find((n) => n.id === id)!;
		expect(node('allowed')).toMatchObject({
			noteId: 'ideas/launch.md',
			noteTitle: 'Launch plan'
		});
		// A path in a local-only folder is itself cloud metadata: omit it.
		expect(node('hidden')).not.toHaveProperty('noteId');
		expect(node('hidden')).toMatchObject({ noteTitle: null, accessible: false });
		// An intact encrypted link is not missing; its title stays hidden while AI may not read it.
		expect(node('sealed')).toMatchObject({
			noteId: 'sealed.md',
			noteTitle: null,
			encrypted: true,
			accessible: false
		});
		expect(node('sealed').missing).toBeUndefined();
		// Unmentioned notes keep only an opaque link token, never their title.
		expect(node('unmentioned')).toMatchObject({
			noteId: 'other.md',
			noteTitle: null,
			accessible: false
		});
		expect(node('gone')).toMatchObject({ noteId: 'gone.md', missing: true });
		// Even a missing link inside a local-only folder must not disclose its path.
		expect(node('gone-hidden')).not.toHaveProperty('noteId');
		expect(node('gone-hidden')).toMatchObject({ noteTitle: null, missing: true });
	});

	it('describes map changes in readable lines for the approval card', () => {
		const before = parseCanvas(initial).doc;
		const after = mapPatch(
			{
				nodes: [
					{ id: 't', text: 'Renamed' },
					{ id: 'new', type: 'text', text: 'Added', x: 8, y: 9 }
				],
				removeEdges: ['e']
			},
			before,
			notes
		);
		expect(mapChangeLines('edit_map', before, after)).toEqual(
			expect.arrayContaining([
				'Updated node “Renamed”',
				'Added node “Added”',
				'Removed link “ok.md → Renamed”'
			])
		);
		expect(mapChangeLines('create_map', null, parseCanvas(blankMap()).doc)).toEqual([
			'New empty map; add nodes and links in the editor.'
		]);
		expect(mapChangeLines('delete_map', before, after)).toContain(
			'The map file is permanently deleted.'
		);
	});
});
