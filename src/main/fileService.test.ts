import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileService } from './fileService';
import type { NoteIndex } from './db';
import type { NoteMeta } from '../shared/types';

/** In-memory stand-in for the SQLite index (better-sqlite3 is built for Electron's ABI). */
function memIndex() {
	const notes = new Map<string, NoteMeta>();
	const index = {
		upsert: (m: NoteMeta) => notes.set(m.id, m),
		remove: (id: string) => notes.delete(id),
		removeUnder: (dir: string) => {
			for (const id of [...notes.keys()]) if (id.startsWith(`${dir}/`)) notes.delete(id);
		},
		clear: () => notes.clear()
	};
	return { notes, index: index as unknown as NoteIndex };
}

const exists = (p: string) =>
	access(p).then(
		() => true,
		() => false
	);

describe('FileService move / rename', () => {
	let root: string;
	let svc: FileService;
	let notes: Map<string, NoteMeta>;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'fr5a-fs-'));
		await mkdir(path.join(root, 'work/deep'), { recursive: true });
		await writeFile(path.join(root, 'work/a.md'), '# A\n\n<!-- ai: local -->\n');
		await writeFile(path.join(root, 'work/deep/b.md'), '# B\n');
		await writeFile(path.join(root, 'c.md'), '# C\n');
		const mem = memIndex();
		notes = mem.notes;
		svc = new FileService(root, mem.index, () => {});
		await svc.start();
	});

	afterEach(async () => {
		await svc.stop();
		await rm(root, { recursive: true, force: true });
	});

	it('indexes the ai: local marker', () => {
		expect(notes.get('work/a.md')?.aiLocal).toBe(true);
		expect(notes.get('c.md')?.aiLocal).toBe(false);
	});

	it('indexes an encrypted note by its file name only', async () => {
		await svc.write(
			'secret.md',
			'<!-- pinned: true -->\n-----BEGIN PGP MESSAGE-----\n\nwV4D #tag\n-----END PGP MESSAGE-----\n'
		);
		expect(notes.get('secret.md')).toMatchObject({
			title: 'secret',
			snippet: '',
			tags: [],
			pinned: true,
			encrypted: true
		});
		expect(notes.get('c.md')?.encrypted).toBe(false);
	});

	it('renames and moves notes, keeping the extension and deduping names', async () => {
		expect(await svc.move('c.md', 'Renamed')).toBe('Renamed.md');
		expect(await readFile(path.join(root, 'Renamed.md'), 'utf8')).toBe('# C\n');
		expect(notes.has('c.md')).toBe(false);
		expect(notes.has('Renamed.md')).toBe(true);

		expect(await svc.move('Renamed.md', 'new/folder/a.md')).toBe('new/folder/a.md');
		// work/a.md is taken in work/: the moved note gets a suffix.
		expect(await svc.move('new/folder/a.md', 'work/a.md')).toBe('work/a 2.md');
		await expect(svc.move('work/a.md', '.fr5a/x.md')).rejects.toThrow('hidden');
	});

	it('moves folders with their notes and refuses bad targets', async () => {
		expect(await svc.moveFolder('work', 'archive/work')).toBe('archive/work');
		expect(await exists(path.join(root, 'archive/work/deep/b.md'))).toBe(true);
		expect([...notes.keys()].sort()).toEqual([
			'archive/work/a.md',
			'archive/work/deep/b.md',
			'c.md'
		]);
		await expect(svc.moveFolder('archive', 'archive/x')).rejects.toThrow('into itself');
		await mkdir(path.join(root, 'taken'));
		await expect(svc.moveFolder('archive', 'taken')).rejects.toThrow('already exists');
		await mkdir(path.join(root, 'archive/work/.git'));
		await expect(svc.moveFolder('archive', 'old')).rejects.toThrow('own git repo');
	});

	it('deletes a folder into the trash, refusing locked notes, repos and the root', async () => {
		await writeFile(path.join(root, 'work/deep/img.png'), 'png');
		await svc.deleteFolder('work');
		expect(await exists(path.join(root, 'work'))).toBe(false);
		expect(await exists(path.join(root, '.fr5a_trash/work/deep/b.md'))).toBe(true);
		expect(await exists(path.join(root, '.fr5a_trash/work/deep/img.png'))).toBe(true);
		expect([...notes.keys()]).toEqual(['c.md']);
		expect((await svc.listTrash()).map((n) => n.id).sort()).toEqual([
			'.fr5a_trash/work/a.md',
			'.fr5a_trash/work/deep/b.md'
		]);

		await mkdir(path.join(root, 'keep'));
		await writeFile(path.join(root, 'keep/l.md'), '<!-- locked: true -->\n# L');
		await expect(svc.deleteFolder('keep')).rejects.toThrow('locked');
		expect(await exists(path.join(root, 'keep/l.md'))).toBe(true);
		await mkdir(path.join(root, 'repo/.git'), { recursive: true });
		await expect(svc.deleteFolder('repo')).rejects.toThrow('own git repo');
		await expect(svc.deleteFolder('')).rejects.toThrow('root');
	});
});
