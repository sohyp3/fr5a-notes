import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	repoStashes,
	workspaceRevert,
	workspaceStash,
	workspaceStashApply,
	workspaceStashDrop,
	workspaceStashes
} from './gitStash';

let tmp: string;
let n = 0;

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (dir: string, file: string, body: string) => {
	fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
	fs.writeFileSync(path.join(dir, file), body, 'utf8');
};
const read = (dir: string, file: string) => {
	try {
		return fs.readFileSync(path.join(dir, file), 'utf8');
	} catch {
		return null;
	}
};

/** A repo with `a.md`, `b.md` and `notes/[x] c.md` committed. */
function repo(dir = path.join(tmp, `r${++n}`)): string {
	fs.mkdirSync(dir, { recursive: true });
	git(dir, 'init', '--quiet');
	git(dir, 'config', 'user.name', 't');
	git(dir, 'config', 'user.email', 't@t');
	write(dir, 'a.md', 'a1\n');
	write(dir, 'b.md', 'b1\n');
	write(dir, 'notes/[x] c.md', 'c1\n');
	git(dir, 'add', '-A');
	git(dir, 'commit', '--quiet', '-m', 'init');
	return dir;
}

beforeAll(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fr5a-stash-'));
	const gitconfig = path.join(tmp, 'gitconfig');
	fs.writeFileSync(gitconfig, '[init]\n\tdefaultBranch = main\n');
	process.env.GIT_CONFIG_GLOBAL = gitconfig;
	process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('stash', () => {
	it('stashes only the given notes, new ones included, and lists them', async () => {
		const dir = repo();
		write(dir, 'a.md', 'a2\n');
		write(dir, 'b.md', 'b2\n');
		write(dir, 'new.md', 'fresh\n');
		fs.rmSync(path.join(dir, 'notes/[x] c.md'));
		await workspaceStash(dir, [], ['a.md', 'new.md', 'notes/[x] c.md'], 'wip: a');
		expect(read(dir, 'a.md')).toBe('a1\n');
		expect(read(dir, 'new.md')).toBeNull();
		expect(read(dir, 'notes/[x] c.md')).toBe('c1\n');
		expect(read(dir, 'b.md')).toBe('b2\n'); // not asked for: untouched

		const [s, ...rest] = await workspaceStashes(dir, []);
		expect(rest).toHaveLength(0);
		expect(s.message).toBe('wip: a');
		expect(s.repo).toBe('');
		expect(s.date).toBeGreaterThan(Date.now() - 60_000);
		expect(s.files.sort((x, y) => x.path.localeCompare(y.path))).toEqual([
			{ path: 'a.md', status: 'modified', before: 'a1\n', after: 'a2\n' },
			{ path: 'new.md', status: 'added', before: null, after: 'fresh\n' },
			{ path: 'notes/[x] c.md', status: 'deleted', before: 'c1\n', after: null }
		]);
		expect(git(dir, 'stash', 'list')).toMatch(/On main: wip: a/);

		const res = await workspaceStashApply(dir, [], '', s.id, true);
		expect(res).toEqual([]);
		expect(read(dir, 'a.md')).toBe('a2\n');
		expect(read(dir, 'new.md')).toBe('fresh\n');
		expect(read(dir, 'notes/[x] c.md')).toBeNull();
		expect(await workspaceStashes(dir, [])).toEqual([]);
	});

	it('refuses to apply over edits made since', async () => {
		const dir = repo();
		write(dir, 'a.md', 'stashed\n');
		await workspaceStash(dir, [], ['a.md'], 'one');
		write(dir, 'a.md', 'typed since\n');
		const [s] = await repoStashes(dir);
		await expect(workspaceStashApply(dir, [], '', s.id, true)).rejects.toThrow(
			/edits to a\.md would be overwritten/
		);
		expect(read(dir, 'a.md')).toBe('typed since\n');
		expect(await repoStashes(dir)).toHaveLength(1);
	});

	it('keeps the stash and reports conflicts when the note changed in a commit since', async () => {
		const dir = repo();
		write(dir, 'a.md', 'mine\n');
		await workspaceStash(dir, [], ['a.md'], 'one');
		write(dir, 'a.md', 'theirs\n');
		git(dir, 'commit', '--quiet', '-am', 'later');
		const [s] = await repoStashes(dir);
		expect(await workspaceStashApply(dir, [], '', s.id, true)).toEqual(['a.md']);
		expect(read(dir, 'a.md')).toMatch(/<<<<<<<[\s\S]*mine[\s\S]*theirs|theirs[\s\S]*mine/);
		expect(git(dir, 'diff', '--name-only', '--diff-filter=U')).toBe('');
		expect(await repoStashes(dir)).toHaveLength(1);
	});

	it('drops by id even after newer stashes shift the indexes', async () => {
		const dir = repo();
		write(dir, 'a.md', 'first\n');
		await workspaceStash(dir, [], ['a.md'], 'first');
		const [first] = await repoStashes(dir);
		write(dir, 'b.md', 'second\n');
		await workspaceStash(dir, [], ['b.md'], 'second');
		await workspaceStashDrop(dir, [], '', first.id);
		expect((await repoStashes(dir)).map((s) => s.message)).toEqual(['second']);
		await expect(workspaceStashDrop(dir, [], '', first.id)).rejects.toThrow(/no longer exists/);
	});

	it('routes notes to nested repos, each with its own stash list', async () => {
		const root = repo();
		const priv = repo(path.join(root, 'private'));
		write(root, '.gitignore', '/private/\n');
		git(root, 'add', '-A');
		git(root, 'commit', '--quiet', '-m', 'ignore');
		write(root, 'a.md', 'root edit\n');
		write(priv, 'a.md', 'private edit\n');
		await workspaceStash(root, ['private'], ['a.md', 'private/a.md'], 'both');
		expect(read(root, 'a.md')).toBe('a1\n');
		expect(read(priv, 'a.md')).toBe('a1\n');
		const all = await workspaceStashes(root, ['private']);
		expect(all.map((s) => [s.repo, s.files.map((f) => f.path)]).sort()).toEqual([
			['', ['a.md']],
			['private', ['private/a.md']]
		]);
		const p = all.find((s) => s.repo === 'private')!;
		await workspaceStashApply(root, ['private'], 'private', p.id, false);
		expect(read(priv, 'a.md')).toBe('private edit\n');
		expect(await repoStashes(priv)).toHaveLength(1); // apply without drop keeps it
		await expect(workspaceStashDrop(root, ['private'], 'nope', p.id)).rejects.toThrow(
			/No repository/
		);
	});

	it('rejects paths that are not notes inside the workspace', async () => {
		const dir = repo();
		await expect(workspaceStash(dir, [], ['../x.md'], 'x')).rejects.toThrow(/Not a note/);
		await expect(workspaceStash(dir, [], ['.git/config'], 'x')).rejects.toThrow(/Not a note/);
		await expect(workspaceRevert(dir, [], ['/etc/x.md'])).rejects.toThrow(/Not a note/);
	});
});

describe('revert', () => {
	it('restores edited and deleted notes, returns new ones to trash', async () => {
		const dir = repo();
		write(dir, 'a.md', 'edited\n');
		fs.rmSync(path.join(dir, 'notes/[x] c.md'));
		write(dir, 'new.md', 'fresh\n');
		git(dir, 'add', 'new.md'); // staged-new behaves like untracked-new
		write(dir, 'b.md', 'kept\n');
		const fresh = await workspaceRevert(dir, [], ['a.md', 'notes/[x] c.md', 'new.md']);
		expect(fresh).toEqual(['new.md']);
		expect(read(dir, 'a.md')).toBe('a1\n');
		expect(read(dir, 'notes/[x] c.md')).toBe('c1\n');
		expect(read(dir, 'new.md')).toBe('fresh\n'); // the caller trashes it
		expect(git(dir, 'status', '--porcelain')).toBe(' M b.md\n?? new.md\n');
	});
});
