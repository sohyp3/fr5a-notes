import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('migrates an existing SQLite index without losing notes or tags', async () => {
	const temporary = await mkdtemp(path.join(tmpdir(), 'fr5a-index-migration-'));
	try {
		const require = createRequire(import.meta.url);
		// The shipped native binding targets Electron's ABI, so execute the actual
		// index implementation in Electron's Node mode instead of mocking SQL.
		const script = `
			const { createRequire, Module } = require('node:module');
			const fs = require('node:fs');
			const path = require('node:path');
			const project = ${JSON.stringify(process.cwd())};
			const projectRequire = createRequire(path.join(project, 'package.json'));
			const Database = projectRequire('better-sqlite3');
			const file = ${JSON.stringify(path.join(temporary, 'notes.sqlite'))};
			const old = new Database(file);
			old.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, absPath TEXT NOT NULL, title TEXT NOT NULL, snippet TEXT NOT NULL, mtime INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0); CREATE TABLE tags (note_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(note_id, tag)); INSERT INTO notes VALUES ('old.md', '/notes/old.md', 'Old', 'Kept', 1, 1); INSERT INTO tags VALUES ('old.md', 'work');");
			old.close();
			const ts = projectRequire('typescript');
			const sourcePath = path.join(project, 'src/main/db.ts');
			const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
			const runtime = new Module(sourcePath);
			runtime.paths = Module._nodeModulePaths(path.dirname(sourcePath));
			runtime._compile(compiled, sourcePath);
			const index = new runtime.exports.NoteIndex(file);
			const before = index.all();
			index.upsert({ ...before[0], id: 'map.md', title: 'Map', mindMapVersion: 1 });
			const after = index.all();
			index.close();
			console.log(JSON.stringify({ before, after }));
		`;
		const result = spawnSync(require('electron') as string, ['-e', script], {
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
			encoding: 'utf8',
			timeout: 15000
		});
		expect(result.error, result.stderr).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		const { before, after } = JSON.parse(result.stdout);
		expect(before).toEqual([
			expect.objectContaining({
				id: 'old.md',
				title: 'Old',
				tags: ['work'],
				pinned: true,
				mindMapVersion: null
			})
		]);
		expect(after).toHaveLength(2);
		expect(after.find((note: { id: string }) => note.id === 'map.md')).toMatchObject({
			mindMapVersion: 1,
			tags: ['work']
		});
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 20000);
