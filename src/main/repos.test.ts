import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findNestedRepos, listRepos, workspaceSync } from './repos';

/**
 * Root repo → "public" remote, nested `private/` repo → "server" remote. The
 * root must never commit the nested repo's files.
 */

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 't',
			GIT_AUTHOR_EMAIL: 't@t',
			GIT_COMMITTER_NAME: 't',
			GIT_COMMITTER_EMAIL: 't@t'
		}
	});

let tmp: string;
let work: string;

function setupRepo(dir: string, bare: string): void {
	git(tmp, 'init', '--quiet', '--bare', '-b', 'main', bare);
	mkdirSync(dir, { recursive: true });
	git(dir, 'init', '--quiet', '-b', 'main');
	git(dir, 'remote', 'add', 'origin', bare);
}

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), 'fr5a-repos-'));
	// Isolate from the developer's global git config (signing, hooks, aliases…).
	writeFileSync(path.join(tmp, 'gitconfig'), '[init]\n\tdefaultBranch = main\n');
	process.env.GIT_CONFIG_GLOBAL = path.join(tmp, 'gitconfig');
	process.env.GIT_CONFIG_NOSYSTEM = '1';
	work = path.join(tmp, 'work');
	setupRepo(work, path.join(tmp, 'public.git'));
	setupRepo(path.join(work, 'private'), path.join(tmp, 'server.git'));
	writeFileSync(path.join(work, 'blog.md'), '# Blog\n');
	writeFileSync(path.join(work, 'private', 'diary.md'), '# Diary\n');
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const files = (bare: string) =>
	git(tmp, '--git-dir', path.join(tmp, bare), 'ls-tree', '-r', '--name-only', 'main')
		.split('\n')
		.filter(Boolean)
		.sort();

describe('workspace multi-repo sync', () => {
	it('pushes each repo to its own remote and keeps nested files out of the root', async () => {
		expect(await findNestedRepos(work)).toEqual(['private']);
		const sync = await workspaceSync(work);
		expect(await sync.push()).toEqual({ status: 'ok' });

		expect(files('public.git')).toEqual(['.gitignore', 'blog.md']);
		expect(files('server.git')).toEqual(['diary.md']);
		expect(readFileSync(path.join(work, '.gitignore'), 'utf8')).toContain('/private/\n');

		const repos = await listRepos(work);
		expect(repos.map((r) => [r.path, path.basename(r.remote ?? '')])).toEqual([
			['', 'public.git'],
			['private', 'server.git']
		]);
	});

	it('reports conflicts in a nested repo as workspace paths', async () => {
		const sync = await workspaceSync(work);
		await sync.push();
		// Another device edits the private note.
		const other = path.join(tmp, 'other');
		git(tmp, 'clone', '--quiet', path.join(tmp, 'server.git'), other);
		writeFileSync(path.join(other, 'diary.md'), '# Diary\ntheirs\n');
		git(other, 'commit', '--quiet', '-am', 'theirs');
		git(other, 'push', '--quiet', 'origin', 'main');

		writeFileSync(path.join(work, 'private', 'diary.md'), '# Diary\nmine\n');
		const res = await (await workspaceSync(work)).pull();
		expect(res.status).toBe('conflict');
		expect(res.status === 'conflict' && res.files.map((f) => f.path)).toEqual(['private/diary.md']);

		const done = await (
			await workspaceSync(work)
		).resolve([{ path: 'private/diary.md', pick: 'mine' }]);
		expect(done).toEqual({ status: 'ok' });
		expect(readFileSync(path.join(work, 'private', 'diary.md'), 'utf8')).toBe('# Diary\nmine\n');
	});
});
