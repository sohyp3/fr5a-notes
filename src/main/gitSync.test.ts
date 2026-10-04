import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGitSync, GitSyncError } from './gitSync';

// Integration tests: a temp bare repo acting as the remote, and two clones (A, B)
// acting as two machines syncing the same notes folder.

let tmp: string;
let bare: string;
let a: string;
let b: string;
let n = 0;

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const write = (dir: string, file: string, body: string) =>
	fs.writeFileSync(path.join(dir, file), body, 'utf8');
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
const head = (dir: string) => git(dir, 'rev-parse', 'HEAD').trim();
const status = (dir: string) => git(dir, 'status', '--porcelain');
const mergeHead = (dir: string) => fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'));
const OLD = Date.UTC(2020, 0, 1);
const mtime = (dir: string, file: string) => fs.statSync(path.join(dir, file)).mtimeMs;
/** Backdate a file, as if last edited long ago. */
const age = (dir: string, file: string, ms = OLD) =>
	fs.utimesSync(path.join(dir, file), ms / 1000, ms / 1000);
/** Commit everything with a fixed author date (epoch seconds) and push it. */
function pushAt(dir: string, seconds: number): void {
	const env = { ...process.env, GIT_AUTHOR_DATE: `@${seconds} +0000` };
	execFileSync('git', ['add', '-A'], { cwd: dir });
	execFileSync('git', ['commit', '--quiet', '-m', 'dated'], { cwd: dir, env });
	git(dir, 'push', '--quiet');
}

function clone(name: string): string {
	const dir = path.join(tmp, name);
	git(tmp, 'clone', '--quiet', bare, dir);
	git(dir, 'config', 'user.name', name);
	git(dir, 'config', 'user.email', `${name}@test`);
	return dir;
}

beforeAll(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fr5a-sync-'));
	// Isolate from the developer's global git config (signing, hooks, aliases…).
	const gitconfig = path.join(tmp, 'gitconfig');
	fs.writeFileSync(gitconfig, '[init]\n\tdefaultBranch = main\n');
	process.env.GIT_CONFIG_GLOBAL = gitconfig;
	process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
	// Fresh remote + two clones per test, seeded with one shared note.
	n++;
	bare = path.join(tmp, `remote${n}.git`);
	git(tmp, 'init', '--quiet', '--bare', bare);
	const seed = clone(`seed${n}`);
	write(seed, 'note.md', '# Note\n\nline one\nline two\nline three\n');
	git(seed, 'add', '-A');
	git(seed, 'commit', '--quiet', '-m', 'seed');
	git(seed, 'push', '--quiet', '-u', 'origin', 'main');
	a = clone(`a${n}`);
	b = clone(`b${n}`);
});

/** Make A and B both change the same line of note.md; A pushes first. */
async function makeConflict(): Promise<void> {
	write(a, 'note.md', '# Note\n\nline one\nline two FROM A\nline three\n');
	await createGitSync(a).push();
	write(b, 'note.md', '# Note\n\nline one\nline two FROM B\nline three\n');
}

describe('gitSync', () => {
	it('push commits all changes as "sync: <timestamp>" and pushes them', async () => {
		write(a, 'new.md', '# New\n');
		write(a, 'note.md', read(a, 'note.md') + 'more\n');
		expect(await createGitSync(a).push()).toEqual({ status: 'ok' });

		const subject = git(bare, 'log', '-1', '--format=%s', 'main').trim();
		expect(subject).toMatch(/^sync: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(git(bare, 'rev-parse', 'main').trim()).toBe(head(a));
		expect(git(bare, 'show', 'main:new.md')).toBe('# New\n');
		expect(status(a)).toBe('');
	});

	it('push sends the notes as they are now: earlier pulled states never leave', async () => {
		const sync = createGitSync(a);
		write(a, 'secret.md', 'my password is hunter2\n');
		await sync.pull(); // commits the plain text locally
		write(b, 'other.md', '# From B\n');
		await createGitSync(b).push(); // the remote moves meanwhile
		write(a, 'secret.md', '-----BEGIN PGP MESSAGE-----\nciphertext\n-----END PGP MESSAGE-----\n');
		await sync.pull(); // merges B's commit
		expect(await sync.push()).toEqual({ status: 'ok' });

		// One new commit on top of B's, holding the encrypted state only.
		expect(git(bare, 'log', '--format=%s', 'main').trim().split('\n')).toHaveLength(3);
		expect(git(bare, 'rev-list', '--parents', '-n', '1', 'main').trim().split(' ')).toHaveLength(2);
		expect(git(bare, 'show', 'main:secret.md')).toContain('ciphertext');
		expect(git(bare, 'show', 'main:other.md')).toBe('# From B\n');
		expect(git(bare, 'log', '-p', 'main')).not.toContain('hunter2');
		expect(head(a)).toBe(git(bare, 'rev-parse', 'main').trim());
	});

	it('keeps commits made by hand as they are', async () => {
		write(a, 'x.md', 'x\n');
		git(a, 'add', '-A');
		git(a, 'commit', '--quiet', '-m', 'my own commit');
		write(a, 'y.md', 'y\n');
		await createGitSync(a).push();
		expect(git(bare, 'log', '--format=%s', 'main')).toContain('my own commit');
	});

	it('push with nothing new reports nothing-to-push', async () => {
		await expect(createGitSync(a).push()).rejects.toMatchObject({ code: 'nothing-to-push' });
	});

	it('pull fast-forwards when only the remote moved', async () => {
		write(a, 'from-a.md', 'hello from A\n');
		await createGitSync(a).push();

		expect(await createGitSync(b).pull()).toEqual({ status: 'ok' });
		expect(head(b)).toBe(head(a)); // fast-forward: no merge commit
		expect(read(b, 'from-a.md')).toBe('hello from A\n');
		expect(status(b)).toBe('');
	});

	it('pull auto-merges edits to different files', async () => {
		write(a, 'a.md', 'A side\n');
		await createGitSync(a).push();
		write(b, 'b.md', 'B side\n');
		git(b, 'add', '-A');
		git(b, 'commit', '--quiet', '-m', 'b local');

		expect(await createGitSync(b).pull()).toEqual({ status: 'ok' });
		expect(read(b, 'a.md')).toBe('A side\n');
		expect(read(b, 'b.md')).toBe('B side\n');
		expect(git(b, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(3);
		expect(git(b, 'log', '--format=%s').split('\n')).not.toContain(expect.stringMatching(/rebase/));
		expect(mergeHead(b)).toBe(false);
		expect(status(b)).toBe('');

		// And B can push the merge back; A then sees both files.
		expect(await createGitSync(b).push()).toEqual({ status: 'ok' });
		expect(await createGitSync(a).pull()).toEqual({ status: 'ok' });
		expect(read(a, 'b.md')).toBe('B side\n');
	});

	it('a same-line edit returns a conflict list with mine and theirs', async () => {
		await makeConflict();
		const result = await createGitSync(b).pull();

		expect(result).toEqual({
			status: 'conflict',
			files: [
				{
					path: 'note.md',
					mine: '# Note\n\nline one\nline two FROM B\nline three\n',
					theirs: '# Note\n\nline one\nline two FROM A\nline three\n'
				}
			]
		});
		expect(mergeHead(b)).toBe(true);
	});

	it('push stops at a conflict without pushing', async () => {
		await makeConflict();
		const remoteBefore = git(bare, 'rev-parse', 'main').trim();
		const result = await createGitSync(b).push();
		expect(result.status).toBe('conflict');
		expect(git(bare, 'rev-parse', 'main').trim()).toBe(remoteBefore);
	});

	it('resolve with "mine" keeps the local version and completes the merge', async () => {
		await makeConflict();
		const sync = createGitSync(b);
		await sync.pull();

		expect(await sync.resolve([{ path: 'note.md', pick: 'mine' }])).toEqual({ status: 'ok' });
		expect(read(b, 'note.md')).toBe('# Note\n\nline one\nline two FROM B\nline three\n');
		expect(mergeHead(b)).toBe(false);
		expect(status(b)).toBe('');
		expect(git(b, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(3);

		expect(await sync.push()).toEqual({ status: 'ok' });
		expect(await createGitSync(a).pull()).toEqual({ status: 'ok' });
		expect(read(a, 'note.md')).toBe('# Note\n\nline one\nline two FROM B\nline three\n');
	});

	it('resolve with "theirs" takes the remote version', async () => {
		await makeConflict();
		const sync = createGitSync(b);
		await sync.pull();

		expect(await sync.resolve([{ path: 'note.md', pick: 'theirs' }])).toEqual({ status: 'ok' });
		expect(read(b, 'note.md')).toBe('# Note\n\nline one\nline two FROM A\nline three\n');
		expect(mergeHead(b)).toBe(false);
		expect(status(b)).toBe('');
	});

	it('resolve with a manual edit writes exactly that content', async () => {
		await makeConflict();
		const sync = createGitSync(b);
		const result = await sync.pull();
		expect(result.status).toBe('conflict');

		const manual = '# Note\n\nline one\nline two FROM A and B\nline three\n';
		expect(await sync.resolve([{ path: 'note.md', content: manual }])).toEqual({ status: 'ok' });
		expect(read(b, 'note.md')).toBe(manual);
		expect(git(b, 'show', 'HEAD:note.md')).toBe(manual);
		expect(mergeHead(b)).toBe(false);
		expect(status(b)).toBe('');
	});

	it('resolve rejects paths that are not conflicted', async () => {
		await makeConflict();
		const sync = createGitSync(b);
		await sync.pull();
		await expect(sync.resolve([{ path: '../escape.md', content: 'x' }])).rejects.toBeInstanceOf(
			GitSyncError
		);
		expect(mergeHead(b)).toBe(true);
	});

	it('abort restores the pre-pull state', async () => {
		await makeConflict();
		git(b, 'add', '-A');
		git(b, 'commit', '--quiet', '-m', 'b local');
		const before = head(b);
		const contentBefore = read(b, 'note.md');

		const sync = createGitSync(b);
		expect((await sync.pull()).status).toBe('conflict');
		expect(read(b, 'note.md')).toContain('<<<<<<<');

		await sync.abort();
		expect(head(b)).toBe(before);
		expect(read(b, 'note.md')).toBe(contentBefore);
		expect(mergeHead(b)).toBe(false);
		expect(status(b)).toBe('');
	});

	it('keeps note times across a pull; notes new here get their commit time', async () => {
		age(b, 'note.md');
		write(a, 'note.md', read(a, 'note.md') + 'from A\n');
		write(a, 'from-a.md', '# From A\n');
		pushAt(a, 1600000000);
		write(b, 'b-only.md', '# B\n'); // a local commit too: a real merge
		expect(await createGitSync(b).pull()).toEqual({ status: 'ok' });

		expect(read(b, 'note.md')).toContain('from A');
		expect(mtime(b, 'note.md')).toBe(OLD);
		expect(mtime(b, 'from-a.md')).toBe(1600000000 * 1000);
		expect(status(b)).toBe('');
	});

	it('keeps note times through a conflicted pull and its resolve', async () => {
		write(a, 'from-a.md', '# From A\n');
		await makeConflict();
		age(b, 'note.md');
		const sync = createGitSync(b);
		expect((await sync.pull()).status).toBe('conflict');
		expect(mtime(b, 'from-a.md')).toBe(
			Number(git(b, 'log', '-1', '--format=%at', 'origin/main')) * 1000
		);
		expect(await sync.resolve([{ path: 'note.md', pick: 'theirs' }])).toEqual({ status: 'ok' });
		expect(read(b, 'note.md')).toContain('FROM A');
		expect(mtime(b, 'note.md')).toBe(OLD);
	});

	it('keeps note times through an abort', async () => {
		await makeConflict();
		age(b, 'note.md');
		const sync = createGitSync(b);
		expect((await sync.pull()).status).toBe('conflict');
		await sync.abort();
		expect(read(b, 'note.md')).toContain('FROM B');
		expect(mtime(b, 'note.md')).toBe(OLD);
	});

	it("dates a fresh clone by each file's last commit", async () => {
		write(a, 'later.md', '# Later\n');
		pushAt(a, 1600000000);
		const c = clone(`c${n}`);
		await createGitSync(c).commitTimesAfterClone();
		expect(mtime(c, 'later.md')).toBe(1600000000 * 1000);
		expect(mtime(c, 'note.md')).toBe(
			Number(git(c, 'log', '-1', '--format=%at', '--', 'note.md')) * 1000
		);
	});

	it('pull with uncommitted edits loses nothing', async () => {
		write(a, 'note.md', '# Note\n\nline one\nline two\nline three\nappended by A\n');
		write(a, 'a-only.md', 'A\n');
		await createGitSync(a).push();

		// B: an uncommitted edit to a tracked file, plus a brand new untracked file.
		write(b, 'note.md', '# Note edited by B\n\nline one\nline two\nline three\n');
		write(b, 'draft.md', 'unsaved B draft\n');

		expect(await createGitSync(b).pull()).toEqual({ status: 'ok' });
		expect(read(b, 'note.md')).toBe(
			'# Note edited by B\n\nline one\nline two\nline three\nappended by A\n'
		);
		expect(read(b, 'draft.md')).toBe('unsaved B draft\n');
		expect(read(b, 'a-only.md')).toBe('A\n');
		expect(git(b, 'log', '--format=%s')).toMatch(/^sync: /m);
		expect(status(b)).toBe('');
	});

	it('uncommitted edits that conflict are still preserved as "mine" and survive abort', async () => {
		await makeConflict(); // B's edit is uncommitted here
		const sync = createGitSync(b);
		const result = await sync.pull();
		expect(result).toMatchObject({
			status: 'conflict',
			files: [{ path: 'note.md', mine: '# Note\n\nline one\nline two FROM B\nline three\n' }]
		});
		await sync.abort();
		expect(read(b, 'note.md')).toBe('# Note\n\nline one\nline two FROM B\nline three\n');
		expect(status(b)).toBe('');
	});

	it('reports no-remote when the repo has no remote', async () => {
		const solo = path.join(tmp, `solo${n}`);
		git(tmp, 'init', '--quiet', solo);
		await expect(createGitSync(solo).pull()).rejects.toMatchObject({ code: 'no-remote' });
	});
});
