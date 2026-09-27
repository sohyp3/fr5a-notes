import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { registerSyncHandlers } from './syncIpc';
import { Channels } from '../shared/types';
import type { ConflictFile, ResolveChoice, SyncResponse } from '../shared/types';
import { applyConflicts, cancelConflicts, initialDrafts } from '../renderer/src/lib/sync';

// Drives the real IPC handlers (as registered on ipcMain) against temp repos:
// a bare remote plus two clones. `invoke` stands in for ipcRenderer.invoke.

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
const status = (dir: string) => git(dir, 'status', '--porcelain');
const head = (dir: string) => git(dir, 'rev-parse', 'HEAD').trim();

function clone(name: string): string {
	const dir = path.join(tmp, name);
	git(tmp, 'clone', '--quiet', bare, dir);
	git(dir, 'config', 'user.name', name);
	git(dir, 'config', 'user.email', `${name}@test`);
	return dir;
}

/** Register the handlers for `root` on a fake ipcMain and record what main would do. */
function setup(root: string | null) {
	const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>();
	const events: { channel: string; args: unknown[] }[] = [];
	const windows = { opened: [] as ConflictFile[][], closed: 0 };
	const controller = registerSyncHandlers(
		{ handle: (ch, fn) => handlers.set(ch, fn as (e: unknown, ...args: unknown[]) => unknown) },
		{
			getRoot: () => root,
			emit: (channel, ...args) => events.push({ channel, args }),
			openConflicts: (files) => windows.opened.push(files),
			closeConflicts: () => windows.closed++
		}
	);
	const invoke = <T = SyncResponse>(channel: string, ...args: unknown[]) =>
		Promise.resolve(handlers.get(channel)!({}, ...args)) as Promise<T>;
	// What the preload exposes to the conflict window.
	const api = {
		syncResolve: (choices: ResolveChoice[]) => invoke(Channels.syncResolve, choices),
		syncAbort: () => invoke(Channels.syncAbort)
	};
	return { invoke, events, windows, controller, api, handlers };
}

beforeAll(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fr5a-ipc-'));
	const gitconfig = path.join(tmp, 'gitconfig');
	fs.writeFileSync(gitconfig, '[init]\n\tdefaultBranch = main\n');
	process.env.GIT_CONFIG_GLOBAL = gitconfig;
	process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
	n++;
	bare = path.join(tmp, `remote${n}.git`);
	git(tmp, 'init', '--quiet', '--bare', bare);
	const seed = clone(`seed${n}`);
	write(seed, 'note.md', '# Note\n\nline one\nline two\nline three\n');
	write(seed, 'other.md', '# Other\n\nalpha\nbeta\n');
	git(seed, 'add', '-A');
	git(seed, 'commit', '--quiet', '-m', 'seed');
	git(seed, 'push', '--quiet', '-u', 'origin', 'main');
	a = clone(`a${n}`);
	b = clone(`b${n}`);
});

/** A and B edit the same lines of both notes; A pushes first. B then pulls through IPC. */
async function conflictOnB() {
	write(a, 'note.md', '# Note\n\nline one\nline two FROM A\nline three\n');
	write(a, 'other.md', '# Other\n\nalpha A\nbeta\n');
	expect((await setup(a).invoke(Channels.syncPush)).ok).toBe(true);
	write(b, 'note.md', '# Note\n\nline one\nline two FROM B\nline three\n');
	write(b, 'other.md', '# Other\n\nalpha B\nbeta\n');
	const ipc = setup(b);
	const res = await ipc.invoke(Channels.syncPull);
	expect(res).toMatchObject({ ok: true, result: { status: 'conflict' } });
	return ipc;
}

describe('sync IPC handlers', () => {
	it('push commits and pushes, then emits sync:done', async () => {
		write(a, 'new.md', '# New\n');
		const ipc = setup(a);
		expect(await ipc.invoke(Channels.syncPush)).toEqual({ ok: true, result: { status: 'ok' } });
		expect(git(bare, 'show', 'main:new.md')).toBe('# New\n');
		expect(ipc.events.map((e) => e.channel)).toEqual([Channels.syncDone]);
	});

	it('clean pull updates files on disk and emits sync:done (renderer reloads notes)', async () => {
		write(a, 'note.md', '# Note\n\nchanged by A\n');
		await setup(a).invoke(Channels.syncPush);
		const ipc = setup(b);
		expect(await ipc.invoke(Channels.syncPull)).toEqual({ ok: true, result: { status: 'ok' } });
		expect(read(b, 'note.md')).toBe('# Note\n\nchanged by A\n');
		expect(ipc.events.map((e) => e.channel)).toEqual([Channels.syncDone]);
		expect(ipc.windows.opened).toHaveLength(0);
	});

	it('a conflict emits sync:conflict with the file list and opens the conflict window', async () => {
		const ipc = await conflictOnB();
		const conflict = ipc.events.find((e) => e.channel === Channels.syncConflict);
		const files = conflict!.args[0] as ConflictFile[];
		expect(files.map((f) => f.path).sort()).toEqual(['note.md', 'other.md']);
		expect(ipc.windows.opened).toHaveLength(1);
		expect(ipc.events.some((e) => e.channel === Channels.syncDone)).toBe(false);
		// The conflict window fetches the same list.
		expect(await ipc.invoke<ConflictFile[]>(Channels.syncConflicts)).toEqual(files);
	});

	it('reports nothing-to-push as an error', async () => {
		const res = await setup(a).invoke(Channels.syncPush);
		expect(res).toMatchObject({ ok: false, error: { code: 'nothing-to-push' } });
	});

	it('reports a missing remote', async () => {
		const solo = path.join(tmp, `solo${n}`);
		git(tmp, 'init', '--quiet', solo);
		write(solo, 'x.md', 'x\n');
		const res = await setup(solo).invoke(Channels.syncPush);
		expect(res).toMatchObject({ ok: false, error: { code: 'no-remote' } });
		expect(fs.existsSync(path.join(solo, 'x.md'))).toBe(true);
	});

	it('reports git missing from PATH', async () => {
		const saved = process.env.PATH;
		process.env.PATH = path.join(tmp, 'empty-bin');
		try {
			const res = await setup(a).invoke(Channels.syncPull);
			expect(res).toMatchObject({ ok: false, error: { code: 'no-git' } });
		} finally {
			process.env.PATH = saved;
		}
	});

	it('reports an authentication failure without prompting', async () => {
		// An HTTP remote that demands credentials; git must fail fast, not prompt.
		const server = http.createServer((_req, res) => {
			res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' });
			res.end();
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		try {
			const port = (server.address() as AddressInfo).port;
			git(a, 'remote', 'set-url', 'origin', `http://127.0.0.1:${port}/notes.git`);
			const res = await setup(a).invoke(Channels.syncPull);
			expect(res).toMatchObject({ ok: false, error: { code: 'auth' } });
		} finally {
			server.close();
		}
	});

	it('reports no-workspace when no folder is open, and rejects concurrent syncs', async () => {
		expect(await setup(null).invoke(Channels.syncPull)).toMatchObject({
			ok: false,
			error: { code: 'no-workspace' }
		});
		const ipc = setup(a);
		const [first, second] = await Promise.all([
			ipc.invoke(Channels.syncPull),
			ipc.invoke(Channels.syncPull)
		]);
		expect(first.ok).toBe(true);
		expect(second).toMatchObject({ ok: false, error: { code: 'busy' } });
	});
});

describe('conflict window handlers', () => {
	it('Apply resolves each file with its choice (mine / manual), closes the window, reloads notes', async () => {
		const ipc = await conflictOnB();
		const files = await ipc.invoke<ConflictFile[]>(Channels.syncConflicts);
		const drafts = initialDrafts(files);
		// Manual edit is prefilled with both versions.
		expect(drafts['other.md'].manual).toContain('alpha B');
		expect(drafts['other.md'].manual).toContain('alpha A');
		drafts['note.md'].pick = 'mine';
		drafts['other.md'].pick = 'manual';
		drafts['other.md'].manual = '# Other\n\nalpha A+B\nbeta\n';

		const res = await applyConflicts(ipc.api, files, drafts);
		expect(res).toEqual({ ok: true, result: { status: 'ok' } });
		expect(read(b, 'note.md')).toBe('# Note\n\nline one\nline two FROM B\nline three\n');
		expect(read(b, 'other.md')).toBe('# Other\n\nalpha A+B\nbeta\n');
		expect(status(b)).toBe('');
		expect(fs.existsSync(path.join(b, '.git', 'MERGE_HEAD'))).toBe(false);
		expect(ipc.windows.closed).toBe(1);
		expect(ipc.events.at(-1)?.channel).toBe(Channels.syncDone);
		// Closing the (already closed) window later must not abort anything.
		const merged = head(b);
		await ipc.controller.abortPending();
		expect(head(b)).toBe(merged);
	});

	it('Apply with "theirs" takes the remote side', async () => {
		const ipc = await conflictOnB();
		const files = await ipc.invoke<ConflictFile[]>(Channels.syncConflicts);
		const drafts = initialDrafts(files);
		for (const f of files) drafts[f.path].pick = 'theirs';

		expect(await applyConflicts(ipc.api, files, drafts)).toMatchObject({ ok: true });
		expect(read(b, 'note.md')).toBe('# Note\n\nline one\nline two FROM A\nline three\n');
		expect(read(b, 'other.md')).toBe('# Other\n\nalpha A\nbeta\n');
		expect(status(b)).toBe('');
	});

	it('Cancel aborts the merge, restoring local content, and closes the window', async () => {
		const ipc = await conflictOnB();
		expect(read(b, 'note.md')).toContain('<<<<<<<');

		expect(await cancelConflicts(ipc.api)).toEqual({ ok: true, result: { status: 'ok' } });
		expect(read(b, 'note.md')).toBe('# Note\n\nline one\nline two FROM B\nline three\n');
		expect(read(b, 'other.md')).toBe('# Other\n\nalpha B\nbeta\n');
		expect(status(b)).toBe('');
		expect(fs.existsSync(path.join(b, '.git', 'MERGE_HEAD'))).toBe(false);
		expect(ipc.windows.closed).toBe(1);
		expect(ipc.events.at(-1)?.channel).toBe(Channels.syncDone);
	});

	it('closing the conflict window from its frame aborts the pending merge', async () => {
		const ipc = await conflictOnB();
		await ipc.controller.abortPending();
		expect(read(b, 'note.md')).toBe('# Note\n\nline one\nline two FROM B\nline three\n');
		expect(status(b)).toBe('');
	});
});
