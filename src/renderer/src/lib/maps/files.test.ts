import { beforeEach, describe, expect, it, vi } from 'vitest';

/** `.fr5a/` files on a case-insensitive disk (exFAT, a Mac): keys compare without case. */
const disk = new Map<string, { path: string; text: string }>();
const key = (p: string) => p.toLowerCase();

vi.mock('../platform', () => ({
	platform: {
		readMeta: async (p: string) => disk.get(key(p))?.text ?? null,
		writeMeta: async (p: string, text: string) => {
			// Like a real disk: an existing file keeps the case it was created with.
			disk.set(key(p), { path: disk.get(key(p))?.path ?? p, text });
		},
		deleteMeta: async (p: string) => void disk.delete(key(p)),
		listMeta: async (dir: string) =>
			[...disk.values()]
				.filter((f) => f.path.startsWith(`${dir}/`))
				.map((f) => f.path.slice(dir.length + 1))
	}
}));

const {
	clearMapSaveFailure,
	guardMapRead,
	guardMapWrite,
	listMaps,
	readMap,
	recordMapSaveFailure,
	registerMapEditor,
	renameMap,
	removeMap,
	savedAll,
	trackSave,
	writeMap
} = await import('./files');

beforeEach(() => disk.clear());

describe('map files', () => {
	it('guards AI writes against active editor changes and pending saves', async () => {
		let land!: () => void;
		const save = new Promise<void>((done) => (land = done)).then(() => writeMap('Atlas', 'saved'));
		trackSave('Atlas', save);
		let available = false;
		const unregister = registerMapEditor('Atlas', async () => available);
		await expect(guardMapWrite('Atlas')).rejects.toThrow(/unsaved/);
		available = true;
		let finished = false;
		const waiting = guardMapWrite('Atlas').then(() => {
			finished = true;
		});
		await Promise.resolve();
		expect(finished).toBe(false);
		land();
		await waiting;
		expect(await readMap('Atlas')).toBe('saved');
		unregister();
	});
	it('rejects bad map names before calling the platform', async () => {
		for (const name of [null, '', 'all', '../escape', 'dir/name', '.hidden', 'bad\\name']) {
			expect(() => readMap(name as string)).toThrow('Invalid map name');
			expect(() => writeMap(name as string, 'x')).toThrow('Invalid map name');
		}
		expect(disk.size).toBe(0);
	});

	it('waits for an in-flight save after a canvas has closed', async () => {
		let land!: () => void;
		const save = new Promise<void>((resolve) => (land = resolve)).then(() =>
			writeMap('Atlas', 'latest')
		);
		trackSave('Atlas', save);
		let complete = false;
		const waiting = savedAll().then(() => (complete = true));
		await Promise.resolve();
		expect(complete).toBe(false);
		land();
		await waiting;
		expect(await readMap('Atlas')).toBe('latest');
	});

	it('does not report a successful sync after a failed map save', async () => {
		recordMapSaveFailure('Atlas', new Error('disk full'));
		await expect(savedAll()).rejects.toThrow('disk full');
		// A read is not a write: a past save failure must not block read_map.
		await expect(guardMapRead('Atlas')).resolves.toBeUndefined();
		await expect(guardMapWrite('Atlas')).rejects.toThrow(/could not be saved/);
		clearMapSaveFailure('Atlas');
		await expect(savedAll()).resolves.toBeUndefined();
	});
	it('lists newly synced maps and stops listing removed ones on the next read', async () => {
		expect(await listMaps()).toEqual([]);
		await writeMap('Local', '{"nodes":[]}');
		disk.set(key('maps/Remote.canvas'), { path: 'maps/Remote.canvas', text: '{"nodes":[1]}' });
		expect(await listMaps()).toEqual(['Local', 'Remote']);
		expect(await readMap('Remote')).toContain('[1]');
		disk.delete(key('maps/Local.canvas'));
		expect(await listMaps()).toEqual(['Remote']);
	});
	it('renames a map whose name only changes case without losing it', async () => {
		await writeMap('atlas', '{"nodes":[{"id":"a"}]}');
		await renameMap('atlas', 'Atlas');
		expect(await listMaps()).toEqual(['Atlas']);
		expect(await readMap('Atlas')).toBe('{"nodes":[{"id":"a"}]}');
	});

	it('renames and deletes only after a save of the closed map has landed', async () => {
		await writeMap('Atlas', 'old');
		let land!: () => void;
		const save = new Promise<void>((done) => (land = done)).then(() => writeMap('Atlas', 'new'));
		trackSave('Atlas', save);
		const renaming = renameMap('Atlas', 'Plan');
		await Promise.resolve();
		land();
		await renaming;
		expect(await listMaps()).toEqual(['Plan']);
		expect(await readMap('Plan')).toBe('new');

		let land2!: () => void;
		trackSave(
			'Plan',
			new Promise<void>((done) => (land2 = done)).then(() => writeMap('Plan', 'newer'))
		);
		const removing = removeMap('Plan');
		land2();
		await removing;
		expect(await listMaps()).toEqual([]);
	});
});
