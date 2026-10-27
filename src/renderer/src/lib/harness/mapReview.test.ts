import { describe, expect, it, vi } from 'vitest';
import type { NoteMeta } from '../../../../shared/types';
import { findMapName, prepareMapReview, type MapReviewDeps } from './mapReview';
import { blankMap } from './mapTools';
import { AbortError } from './openai';

const notes = [{ id: 'ok.md', title: 'Allowed note' }] as NoteMeta[];
const initial = JSON.stringify({
	nodes: [{ id: 'n', type: 'text', text: 'Node', x: 0, y: 0, width: 200, height: 60 }],
	edges: []
});

function setup(files: Record<string, string> = { Atlas: initial }) {
	const disk = new Map(Object.entries(files));
	const writes: string[] = [];
	const deps: MapReviewDeps = {
		enabled: () => true,
		notes: () => notes,
		list: async () => [...disk.keys()],
		read: async (name) => disk.get(name) ?? null,
		write: async (name, text) => {
			writes.push(name);
			disk.set(name, text);
		},
		remove: async (name) => {
			writes.push(name);
			disk.delete(name);
		},
		guard: async () => {},
		confirmDelete: async () => true,
		forgot: () => {},
		changed: () => {}
	};
	return { disk, writes, deps };
}

describe('map approvals', () => {
	it('prepares a readable change without writing', async () => {
		const { disk, writes, deps } = setup();
		const prepared = await prepareMapReview(
			'edit_map',
			'Atlas',
			{ nodes: [{ id: 'n', text: 'Renamed' }] },
			deps
		);
		expect(prepared.label).toBe('mind map “Atlas”');
		expect(prepared.summary).toEqual(['Updated node “Renamed”']);
		expect(prepared.before).toBe(initial);
		expect(prepared.after).toContain('Renamed');
		expect(writes).toEqual([]);
		expect(disk.get('Atlas')).toBe(initial);
	});

	it('refuses every map operation while the feature is disabled', async () => {
		const { writes, deps } = setup();
		deps.enabled = () => false;
		await expect(prepareMapReview('create_map', 'Atlas', undefined, deps)).rejects.toThrow(
			/Mind maps are disabled/
		);
		await expect(prepareMapReview('edit_map', 'Atlas', {}, deps)).rejects.toThrow(
			/Mind maps are disabled/
		);
		expect(writes).toEqual([]);
	});

	it('refuses to apply after the feature is turned off', async () => {
		const { disk, writes, deps } = setup();
		const prepared = await prepareMapReview(
			'edit_map',
			'Atlas',
			{ nodes: [{ id: 'n', text: 'Renamed' }] },
			deps
		);
		deps.enabled = () => false;
		await expect(prepared.apply()).rejects.toThrow(/disabled; nothing changed/);
		expect(writes).toEqual([]);
		expect(disk.get('Atlas')).toBe(initial);
	});

	it('rejects a map changed on disk between review and apply', async () => {
		const { disk, writes, deps } = setup();
		const prepared = await prepareMapReview(
			'edit_map',
			'Atlas',
			{ nodes: [{ id: 'n', text: 'Renamed' }] },
			deps
		);
		const synced = JSON.stringify({
			nodes: [{ id: 'n', type: 'text', text: 'Edited elsewhere', x: 0, y: 0 }],
			edges: []
		});
		disk.set('Atlas', synced);
		await expect(prepared.apply()).rejects.toThrow(/changed since review/);
		expect(writes).toEqual([]);
		expect(disk.get('Atlas')).toBe(synced);
	});

	it('resolves case-only names to the map on disk', async () => {
		const { disk, deps } = setup({ Atlas: initial });
		await expect(prepareMapReview('create_map', 'atlas', undefined, deps)).rejects.toThrow(
			/already exists/
		);
		const prepared = await prepareMapReview(
			'edit_map',
			'atlas',
			{ nodes: [{ id: 'n', text: 'Renamed' }] },
			deps
		);
		expect(prepared.label).toBe('mind map “Atlas”');
		await prepared.apply();
		expect(disk.get('Atlas')).toContain('Renamed');
	});

	it('requires a second destructive confirmation before deleting', async () => {
		const { disk, writes, deps } = setup();
		deps.confirmDelete = async () => false;
		const prepared = await prepareMapReview('delete_map', 'Atlas', undefined, deps);
		expect(prepared.summary).toEqual([
			'The map file is permanently deleted.',
			'Linked notes remain in the workspace.'
		]);
		expect(await prepared.apply()).toMatch(/rejected deletion/);
		expect(disk.has('Atlas')).toBe(true);
		expect(writes).toEqual([]);
	});

	it('deletes only after confirmation and a final unchanged recheck', async () => {
		const { disk, deps } = setup();
		let confirmed = 0;
		deps.confirmDelete = async () => {
			confirmed++;
			return true;
		};
		const prepared = await prepareMapReview('delete_map', 'Atlas', undefined, deps);
		expect(await prepared.apply()).toBe('Deleted map “Atlas”.');
		expect(confirmed).toBe(1);
		expect(disk.has('Atlas')).toBe(false);
	});

	it('does not delete when Stop lands while the final guard is waiting', async () => {
		const { disk, writes, deps } = setup();
		let confirmed = false;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		deps.confirmDelete = async () => {
			confirmed = true;
			return true;
		};
		deps.guard = async () => {
			if (confirmed) await gate;
		};
		const prepared = await prepareMapReview('delete_map', 'Atlas', undefined, deps);
		const controller = new AbortController();
		const pending = prepared.apply(controller.signal);
		await vi.waitFor(() => expect(confirmed).toBe(true));
		controller.abort();
		release();
		await expect(pending).rejects.toBeInstanceOf(AbortError);
		expect(disk.has('Atlas')).toBe(true);
		expect(writes).toEqual([]);
	});

	it('does not delete when Stop lands while the final read is in flight', async () => {
		const { disk, writes, deps } = setup();
		let confirmed = false;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		deps.confirmDelete = async () => {
			confirmed = true;
			return true;
		};
		const read = deps.read;
		deps.read = async (name) => {
			if (confirmed) await gate;
			return read(name);
		};
		const prepared = await prepareMapReview('delete_map', 'Atlas', undefined, deps);
		const controller = new AbortController();
		const pending = prepared.apply(controller.signal);
		await vi.waitFor(() => expect(confirmed).toBe(true));
		controller.abort();
		release();
		await expect(pending).rejects.toBeInstanceOf(AbortError);
		expect(disk.has('Atlas')).toBe(true);
		expect(writes).toEqual([]);
	});

	it('resolves a requested map name to its on-disk case', () => {
		expect(findMapName(['Atlas', 'Planning'], 'atlas')).toBe('Atlas');
		expect(findMapName(['Atlas'], 'Missing')).toBeUndefined();
	});

	it('creates a blank map once no name clash exists', async () => {
		const { disk, deps } = setup({});
		const prepared = await prepareMapReview('create_map', 'Fresh', undefined, deps);
		expect(prepared.after).toBe(blankMap());
		expect(prepared.summary).toEqual(['New empty map; add nodes and links in the editor.']);
		expect(await prepared.apply()).toBe('Created map “Fresh”.');
		expect(disk.get('Fresh')).toBe(blankMap());
	});
});
