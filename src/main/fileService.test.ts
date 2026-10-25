import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile, access } from 'node:fs/promises';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

	it('indexes mind maps without treating YAML labels or tags as note content', async () => {
		await svc.write(
			'atlas-map.md',
			'---\nmindmap:\n  version: 1\n  root: root\n  nodes:\n    - id: root\n      label: YAML title\n      expand:\n        tags: [secret/config]\n---\n# Atlas map\n\nVisible body #work\n'
		);
		expect(notes.get('atlas-map.md')).toMatchObject({
			title: 'Atlas map',
			tags: ['work'],
			mindMapVersion: 1
		});
		expect(notes.get('atlas-map.md')?.snippet).toContain('Visible body');
	});

	it('keeps malformed declared maps discoverable in the index', async () => {
		await svc.write(
			'broken-map.md',
			'---\nmindmap:\n  version: broken\n  nodes: [\n---\n# Broken map\n'
		);
		expect(notes.get('broken-map.md')?.mindMapVersion).toBe(-1);
	});

	it('creates note filenames with underscores instead of spaces', async () => {
		const first = await svc.create('Project meeting notes');
		const second = await svc.create('Project meeting notes');

		expect(first.id).toBe('Project_meeting_notes.md');
		expect(second.id).toBe('Project_meeting_notes_2.md');
		expect(await readFile(path.join(root, first.id), 'utf8')).toBe('# Project meeting notes\n\n');
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

describe('FileService app files under .fr5a/', () => {
	let root: string;
	let svc: FileService;
	let notes: Map<string, NoteMeta>;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'fr5a-fs-'));
		await mkdir(path.join(root, '.fr5a/chats'), { recursive: true });
		await mkdir(path.join(root, '.fr5a/sessions/device'), { recursive: true });
		await mkdir(path.join(root, 'Work'), { recursive: true });
		await writeFile(path.join(root, '.fr5a/chats/talk.md'), '# Talk\n\n*AI chat*\n');
		await writeFile(path.join(root, '.fr5a/sessions/device/s.md'), '# Session\n');
		await writeFile(path.join(root, '.fr5a/top.md'), '# Not a note\n');
		await writeFile(path.join(root, 'Work/plan.md'), '# Plan\n\n![](../assets/cat.png)\n');
		const mem = memIndex();
		notes = mem.notes;
		svc = new FileService(root, mem.index, () => {});
		await svc.start();
	});

	afterEach(async () => {
		await svc.stop();
		await rm(root, { recursive: true, force: true });
	});

	it('indexes saved chats in .fr5a/chats and nothing else in .fr5a', async () => {
		expect([...notes.keys()].sort()).toEqual(['.fr5a/chats/talk.md', 'Work/plan.md']);
		expect(await svc.listFolders()).toEqual(['Work']);
		const chat = await svc.create('Second', '.fr5a/chats', '# Second\n');
		expect(chat.id).toBe('.fr5a/chats/Second.md');
		expect(notes.has('.fr5a/chats/Second.md')).toBe(true);
		// Saved chats move out like notes.
		expect(await svc.move('.fr5a/chats/talk.md', 'Work/talk.md')).toBe('Work/talk.md');
	});

	it('saves and serves images under .fr5a/assets, refusing other dot-folders', async () => {
		const saved = await svc.saveAsset('.fr5a/assets/cat.png', new Uint8Array([1, 2]));
		expect(saved).toBe('.fr5a/assets/cat.png');
		expect(await svc.saveAsset('.fr5a/assets/cat.png', new Uint8Array([3]))).toBe(
			'.fr5a/assets/cat 2.png'
		);
		expect(svc.assetPath('.fr5a/assets/cat.png')).toBe(path.join(root, '.fr5a/assets/cat.png'));
		expect(svc.assetPath('/.fr5a/assets/cat.png')).toBe(path.join(root, '.fr5a/assets/cat.png'));
		expect(svc.assetPath('.git/x.png')).toBeNull();
		await expect(svc.saveAsset('.fr5a/skills/x.png', new Uint8Array([1]))).rejects.toThrow();
		await expect(svc.saveAsset('.git/x.png', new Uint8Array([1]))).rejects.toThrow();
		expect(await svc.listImages('.fr5a/assets')).toEqual([
			'.fr5a/assets/cat 2.png',
			'.fr5a/assets/cat.png'
		]);
		expect(await svc.listImages('.fr5a/sessions')).toEqual([]);
	});

	it('migrates assets and chats, rewriting links and keeping mtimes', async () => {
		await mkdir(path.join(root, 'assets'));
		await mkdir(path.join(root, 'AI chats'));
		await writeFile(path.join(root, 'assets/cat.png'), 'png');
		await writeFile(path.join(root, 'AI chats/old.md'), '# Old\n\n*AI chat*\n');
		const old = new Date('2024-01-02T03:04:05Z');
		for (const f of ['Work/plan.md', 'assets/cat.png', 'AI chats/old.md'])
			await utimes(path.join(root, f), old, old);
		expect(await svc.listImages('assets')).toEqual(['assets/cat.png']);

		const res = await svc.migrateStorage({
			moves: [
				{ from: 'assets/cat.png', to: '.fr5a/assets/cat.png' },
				{ from: 'AI chats/old.md', to: '.fr5a/chats/old.md' }
			],
			rewrites: [{ id: 'Work/plan.md', text: '# Plan\n\n![](../.fr5a/assets/cat.png)\n' }],
			skipped: []
		});
		expect(res).toEqual({ moved: 2, rewritten: 1, skipped: [] });
		expect(await readFile(path.join(root, 'Work/plan.md'), 'utf8')).toContain('../.fr5a/assets');
		for (const f of ['Work/plan.md', '.fr5a/assets/cat.png', '.fr5a/chats/old.md'])
			expect((await stat(path.join(root, f))).mtimeMs).toBe(old.getTime());
		expect(notes.get('Work/plan.md')?.mtime).toBe(old.getTime());
		expect(notes.has('.fr5a/chats/old.md')).toBe(true);
		expect(notes.has('AI chats/old.md')).toBe(false);
		// The emptied folders go.
		expect(await exists(path.join(root, 'assets'))).toBe(false);
		expect(await exists(path.join(root, 'AI chats'))).toBe(false);

		// Outside its scope, or onto a taken file: nothing happens.
		await expect(
			svc.migrateStorage({
				moves: [{ from: 'Work/plan.md', to: '.fr5a/sessions/plan.md' }],
				rewrites: [],
				skipped: []
			})
		).rejects.toThrow();
		await writeFile(path.join(root, 'b.png'), 'png');
		await expect(
			svc.migrateStorage({
				moves: [{ from: 'b.png', to: '.fr5a/assets/cat.png' }],
				rewrites: [],
				skipped: []
			})
		).rejects.toThrow('Already there');
		expect(await exists(path.join(root, 'b.png'))).toBe(true);
	});

	it('puts everything back when a rewrite or a move fails', async () => {
		await mkdir(path.join(root, 'assets'));
		await mkdir(path.join(root, 'AI chats'));
		await writeFile(path.join(root, 'assets/cat.png'), 'png');
		await writeFile(path.join(root, 'AI chats/old.md'), '# Old\n\n*AI chat*\n');
		await writeFile(path.join(root, 'b.md'), '# B\n');
		const old = new Date('2024-01-02T03:04:05Z');
		for (const f of ['Work/plan.md', 'b.md', 'assets/cat.png', 'AI chats/old.md'])
			await utimes(path.join(root, f), old, old);
		const plan = {
			moves: [
				{ from: 'assets/cat.png', to: '.fr5a/assets/cat.png' },
				{ from: 'AI chats/old.md', to: '.fr5a/chats/old.md' }
			],
			rewrites: [
				{ id: 'Work/plan.md', text: '# Plan\n\n![](../.fr5a/assets/cat.png)\n' },
				{ id: 'b.md', text: '# B2\n' }
			],
			skipped: []
		};
		const untouched = async () => {
			expect(await readFile(path.join(root, 'Work/plan.md'), 'utf8')).toBe(
				'# Plan\n\n![](../assets/cat.png)\n'
			);
			expect(await readFile(path.join(root, 'b.md'), 'utf8')).toBe('# B\n');
			for (const f of ['Work/plan.md', 'b.md', 'assets/cat.png', 'AI chats/old.md'])
				expect((await stat(path.join(root, f))).mtimeMs).toBe(old.getTime());
			expect(await exists(path.join(root, '.fr5a/assets/cat.png'))).toBe(false);
			expect(await exists(path.join(root, '.fr5a/chats/old.md'))).toBe(false);
		};

		// The second note can't be written: the first is restored, nothing moves.
		const write = fsp.writeFile;
		const w = vi
			.spyOn(fsp, 'writeFile')
			.mockImplementation(((file, ...rest) =>
				String(file).endsWith('b.md') && rest[0] === '# B2\n'
					? Promise.reject(new Error('EIO'))
					: write(file, ...rest)) as typeof fsp.writeFile);
		await expect(svc.migrateStorage(plan)).rejects.toThrow(/update b\.md.*nothing was changed/);
		w.mockRestore();
		await untouched();

		// The second rename fails: the first is undone and both notes go back.
		const rename = fsp.rename;
		const r = vi
			.spyOn(fsp, 'rename')
			.mockImplementation((from, to) =>
				String(to).endsWith('old.md') && String(from).includes('AI chats')
					? Promise.reject(new Error('EXDEV'))
					: rename(from, to)
			);
		await expect(svc.migrateStorage(plan)).rejects.toThrow(/move AI chats\/old\.md.*EXDEV/);
		r.mockRestore();
		await untouched();
	});
});
