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

const { listMaps, readMap, renameMap, removeMap, trackSave, writeMap } = await import('./files');

beforeEach(() => disk.clear());

describe('map files', () => {
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
