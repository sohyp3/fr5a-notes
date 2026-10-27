import { describe, expect, it } from 'vitest';
import { blankMap, mapPatch, mapSummary, validMapName } from './mapTools';
import { parseCanvas, serializeCanvas } from '../maps/canvas';
import type { NoteMeta } from '../../../../shared/types';

const notes = [{ id: 'ok.md', title: 'Allowed note' }] as NoteMeta[];
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
	it('rejects malformed changes, unknown keys, missing links and invalid names', () => {
		const doc = parseCanvas(initial).doc;
		expect(() =>
			mapPatch({ nodes: [{ id: 'bad', type: 'file', file: 'missing.md', x: 0, y: 0 }] }, doc, notes)
		).toThrow(/does not exist/);
		expect(() =>
			mapPatch({ edges: [{ id: 'bad', fromNode: 'n', toNode: 'gone' }] }, doc, notes)
		).toThrow(/Invalid canvas/);
		expect(() => mapPatch({ nodes: [{ id: 'x' }, { id: 'x' }] }, doc, notes)).toThrow(/Duplicate/);
		expect(() => mapPatch({ other: 1 }, doc, notes)).toThrow(/Patch/);
		expect(() => validMapName('../sessions/device')).toThrow();
		expect(() => validMapName('.hidden')).toThrow();
		expect(parseCanvas(blankMap()).doc.nodes).toEqual([]);
	});
});
