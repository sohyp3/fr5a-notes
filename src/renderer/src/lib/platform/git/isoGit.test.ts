import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import git, { type HttpClient, type GitHttpRequest } from 'isomorphic-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIsoGitSync, type IsoGitSync } from './isoGit';

/**
 * isomorphic-git in Node against a real bare repo. Transport is `git
 * http-backend` run as a CGI per request (no server, no port), which also
 * enforces a bearer token so the auth path is exercised.
 */

const TOKEN = 'ghp_test_token';

async function collect(body?: AsyncIterableIterator<Uint8Array> | Uint8Array[]): Promise<Buffer> {
	const parts: Buffer[] = [];
	if (body) for await (const chunk of body) parts.push(Buffer.from(chunk));
	return Buffer.concat(parts);
}

function cgiHttp(projectRoot: string, log: GitHttpRequest[] = []): HttpClient {
	return {
		async request(req) {
			log.push(req);
			const url = new URL(req.url);
			const auth = req.headers?.['Authorization'] ?? req.headers?.['authorization'];
			const expected = `Basic ${Buffer.from(`${TOKEN}:x-oauth-basic`).toString('base64')}`;
			if (auth !== expected) {
				return {
					url: req.url,
					method: req.method,
					statusCode: 401,
					statusMessage: 'Unauthorized',
					headers: { 'www-authenticate': 'Basic realm="test"' },
					body: [] as Uint8Array[]
				} as never;
			}
			const input = await collect(req.body as AsyncIterableIterator<Uint8Array>);
			const child = spawn('git', ['http-backend'], {
				env: {
					...process.env,
					GIT_PROJECT_ROOT: projectRoot,
					GIT_HTTP_EXPORT_ALL: '1',
					REMOTE_USER: 'test',
					REQUEST_METHOD: req.method ?? 'GET',
					PATH_INFO: decodeURIComponent(url.pathname),
					QUERY_STRING: url.search.slice(1),
					CONTENT_TYPE: req.headers?.['content-type'] ?? '',
					CONTENT_LENGTH: String(input.length)
				}
			});
			child.stdin.end(input);
			const out = await collect(child.stdout as unknown as AsyncIterableIterator<Uint8Array>);
			await new Promise((r) => child.on('close', r));
			const split = out.indexOf('\r\n\r\n');
			const head = out.subarray(0, split).toString();
			const headers: Record<string, string> = {};
			let statusCode = 200;
			for (const line of head.split('\r\n')) {
				const i = line.indexOf(':');
				const k = line.slice(0, i).toLowerCase();
				const v = line.slice(i + 1).trim();
				if (k === 'status') statusCode = parseInt(v, 10);
				else headers[k] = v;
			}
			return {
				url: req.url,
				method: req.method,
				statusCode,
				statusMessage: statusCode === 200 ? 'OK' : 'Error',
				headers,
				body: [new Uint8Array(out.subarray(split + 4))]
			} as never;
		}
	};
}

let tmp: string;
let remoteUrl: string;
let requests: GitHttpRequest[];
let token: string | null;

function client(name: string): { sync: IsoGitSync; dir: string } {
	const dir = path.join(tmp, name);
	fs.mkdirSync(dir, { recursive: true });
	const sync = createIsoGitSync({
		fs,
		http: cgiHttp(tmp, requests),
		dir,
		getToken: async () => token
	});
	return { sync, dir };
}

const write = (dir: string, file: string, text: string) => {
	fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
	fs.writeFileSync(path.join(dir, file), text);
};
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
const has = (dir: string, file: string) => fs.existsSync(path.join(dir, file));
/** Branch tip in the bare remote, via the real git CLI. */
const remoteLog = () =>
	execFileSync('git', ['--git-dir', path.join(tmp, 'remote.git'), 'log', '--format=%s', 'main'], {
		encoding: 'utf8'
	})
		.trim()
		.split('\n');

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fr5a-isogit-'));
	execFileSync('git', ['init', '--bare', '--initial-branch=main', path.join(tmp, 'remote.git')]);
	remoteUrl = 'https://github.test/remote.git';
	requests = [];
	token = TOKEN;
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

/** A: first to publish notes to the empty remote. B: clones afterwards. */
async function twoClones() {
	const a = client('a');
	await a.sync.connect(remoteUrl);
	write(a.dir, 'shared.md', '# Shared\n\none\ntwo\nthree\n');
	write(a.dir, 'a-only.md', '# A\n');
	expect(await a.sync.push()).toEqual({ status: 'ok' });
	const b = client('b');
	await b.sync.connect(remoteUrl);
	expect(read(b.dir, 'shared.md')).toBe('# Shared\n\none\ntwo\nthree\n');
	return { a, b };
}

describe('isomorphic-git sync', () => {
	it('clones, pushes and fast-forward pulls', async () => {
		const { a, b } = await twoClones();
		expect(remoteLog()).toHaveLength(1);

		write(a.dir, 'new.md', '# New from A\n');
		expect(await a.sync.push()).toEqual({ status: 'ok' });
		expect(await b.sync.pull()).toEqual({ status: 'ok' });
		expect(read(b.dir, 'new.md')).toBe('# New from A\n');
		// Fast-forward: B's HEAD is exactly the remote tip, no merge commit.
		const [bHead] = await git.log({ fs, dir: b.dir, depth: 1 });
		expect(bHead.commit.parent).toHaveLength(1);
	});

	it('reports nothing-to-push when already up to date', async () => {
		const { b } = await twoClones();
		await expect(b.sync.push()).rejects.toMatchObject({ code: 'nothing-to-push' });
	});

	it('auto-merges non-overlapping edits from both sides', async () => {
		const { a, b } = await twoClones();
		write(a.dir, 'shared.md', '# Shared\n\nONE (a)\ntwo\nthree\n');
		await a.sync.push();
		write(b.dir, 'shared.md', '# Shared\n\none\ntwo\nTHREE (b)\n');
		write(b.dir, 'b-only.md', '# B\n');
		expect(await b.sync.push()).toEqual({ status: 'ok' });
		expect(read(b.dir, 'shared.md')).toBe('# Shared\n\nONE (a)\ntwo\nTHREE (b)\n');

		expect(await a.sync.pull()).toEqual({ status: 'ok' });
		expect(read(a.dir, 'shared.md')).toBe('# Shared\n\nONE (a)\ntwo\nTHREE (b)\n');
		expect(read(a.dir, 'b-only.md')).toBe('# B\n');
		const [merge] = await git.log({ fs, dir: a.dir, depth: 1 });
		expect(merge.commit.parent).toHaveLength(2);
	});

	it('keeps uncommitted local edits across a pull', async () => {
		const { a, b } = await twoClones();
		write(a.dir, 'from-a.md', '# From A\n');
		await a.sync.push();
		// Edits sitting in B's working tree, never committed by the user.
		write(b.dir, 'a-only.md', '# A\n\nedited on B, not committed\n');
		write(b.dir, 'draft.md', '# Draft on B\n');
		expect(await b.sync.pull()).toEqual({ status: 'ok' });
		expect(read(b.dir, 'from-a.md')).toBe('# From A\n');
		expect(read(b.dir, 'a-only.md')).toBe('# A\n\nedited on B, not committed\n');
		expect(read(b.dir, 'draft.md')).toBe('# Draft on B\n');
	});

	async function conflicted() {
		const { a, b } = await twoClones();
		write(a.dir, 'c1.md', 'base\n');
		write(a.dir, 'c2.md', 'base\n');
		write(a.dir, 'c3.md', 'base\n');
		write(a.dir, 'gone.md', 'base\n');
		await a.sync.push();
		await b.sync.pull();
		for (const f of ['c1.md', 'c2.md', 'c3.md']) write(a.dir, f, `theirs ${f}\n`);
		write(a.dir, 'gone.md', 'edited by A\n');
		write(a.dir, 'clean-a.md', '# clean from A\n');
		await a.sync.push();
		for (const f of ['c1.md', 'c2.md', 'c3.md']) write(b.dir, f, `mine ${f}\n`);
		fs.rmSync(path.join(b.dir, 'gone.md'));
		const res = await b.sync.pull();
		return { a, b, res };
	}

	it('lists conflicts in the desktop {status, files:[{path, mine, theirs}]} shape', async () => {
		const { b, res } = await conflicted();
		expect(res.status).toBe('conflict');
		const files = res.status === 'conflict' ? res.files : [];
		expect([...files].sort((x, y) => x.path.localeCompare(y.path))).toEqual([
			{ path: 'c1.md', mine: 'mine c1.md\n', theirs: 'theirs c1.md\n' },
			{ path: 'c2.md', mine: 'mine c2.md\n', theirs: 'theirs c2.md\n' },
			{ path: 'c3.md', mine: 'mine c3.md\n', theirs: 'theirs c3.md\n' },
			{ path: 'gone.md', mine: null, theirs: 'edited by A\n' }
		]);
		// Pending merge survives: asking again (pull or conflicts()) gives the same list.
		expect((await b.sync.conflicts()).length).toBe(4);
		expect((await b.sync.pull()).status).toBe('conflict');
		// A conflicted merge never reaches the remote.
		await expect(b.sync.push()).resolves.toMatchObject({ status: 'conflict' });
	});

	it('resolves with mine, theirs and a manual edit, then pushes', async () => {
		const { a, b } = await conflicted();
		const partial = await b.sync.resolve([{ path: 'c1.md', pick: 'mine' }]);
		expect(partial.status).toBe('conflict');
		expect(
			await b.sync.resolve([
				{ path: 'c2.md', pick: 'theirs' },
				{ path: 'c3.md', content: 'manual merge\n' },
				{ path: 'gone.md', pick: 'mine' }
			])
		).toEqual({ status: 'ok' });

		expect(read(b.dir, 'c1.md')).toBe('mine c1.md\n');
		expect(read(b.dir, 'c2.md')).toBe('theirs c2.md\n');
		expect(read(b.dir, 'c3.md')).toBe('manual merge\n');
		expect(has(b.dir, 'gone.md')).toBe(false);
		expect(read(b.dir, 'clean-a.md')).toBe('# clean from A\n');
		const [merge] = await git.log({ fs, dir: b.dir, depth: 1 });
		expect(merge.commit.parent).toHaveLength(2);
		expect(await b.sync.conflicts()).toEqual([]);

		expect(await b.sync.push()).toEqual({ status: 'ok' });
		expect(await a.sync.pull()).toEqual({ status: 'ok' });
		expect(read(a.dir, 'c1.md')).toBe('mine c1.md\n');
		expect(read(a.dir, 'c3.md')).toBe('manual merge\n');
		expect(has(a.dir, 'gone.md')).toBe(false);
	});

	it('rejects resolving a path that is not conflicted', async () => {
		const { b } = await conflicted();
		await expect(b.sync.resolve([{ path: 'clean-a.md', pick: 'mine' }])).rejects.toThrow(
			'not a conflicted file'
		);
	});

	it('aborts back to the pre-merge state', async () => {
		const { b } = await conflicted();
		await b.sync.abort();
		expect(read(b.dir, 'c1.md')).toBe('mine c1.md\n');
		expect(has(b.dir, 'gone.md')).toBe(false);
		expect(has(b.dir, 'clean-a.md')).toBe(false);
		expect(await b.sync.conflicts()).toEqual([]);
		const status = await git.statusMatrix({ fs, dir: b.dir });
		expect(status.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1))).toEqual([]);
		await expect(b.sync.abort()).rejects.toThrow('No merge is in progress');
		// The conflict is still there to settle on the next pull.
		expect((await b.sync.pull()).status).toBe('conflict');
	});

	it('never force-pushes', async () => {
		const { a, b } = await twoClones();
		write(a.dir, 'x.md', 'a\n');
		await a.sync.push();
		write(b.dir, 'x.md', 'b\n');
		const before = remoteLog();
		const sent = requests.length;
		expect((await b.sync.push()).status).toBe('conflict');
		expect(remoteLog()).toEqual(before);
		// Diverged + conflicted: push stops before contacting receive-pack at all.
		const pushes = requests.slice(sent).filter((r) => r.url.includes('git-receive-pack'));
		expect(pushes).toEqual([]);
	});

	it('maps a missing or wrong token to an auth error', async () => {
		token = null;
		const a = client('a');
		await expect(a.sync.connect(remoteUrl)).rejects.toMatchObject({ code: 'auth' });
		expect(has(a.dir, '.git')).toBe(false);
		token = 'wrong';
		await expect(a.sync.connect(remoteUrl)).rejects.toMatchObject({ code: 'auth' });
	});

	it('connects a folder that already has notes to an existing remote', async () => {
		const { a } = await twoClones();
		const c = client('c');
		write(c.dir, 'local.md', '# Written before sync was set up\n');
		await c.sync.connect(remoteUrl);
		expect(await c.sync.push()).toEqual({ status: 'ok' });
		expect(read(c.dir, 'shared.md')).toContain('# Shared');
		expect(await a.sync.pull()).toEqual({ status: 'ok' });
		expect(read(a.dir, 'local.md')).toBe('# Written before sync was set up\n');
	});

	it('reports changed notes since the last commit', async () => {
		expect(await client('none').sync.changes()).toBeNull();
		const { a } = await twoClones();
		expect(await a.sync.changes()).toEqual([]);
		// (A different size: within the same second as the checkout, git's stat
		// cache can't see a same-size rewrite — the "racy git" case.)
		write(a.dir, 'shared.md', '# Shared\n\nONE!\ntwo\nthree\n');
		write(a.dir, 'fresh.md', '# Fresh\n');
		write(a.dir, '.fr5a/sessions/s.md', 'hidden');
		fs.rmSync(path.join(a.dir, 'a-only.md'));
		expect(await a.sync.changes()).toEqual([
			{ path: 'a-only.md', status: 'deleted', before: '# A\n', after: null },
			{ path: 'fresh.md', status: 'added', before: null, after: '# Fresh\n' },
			{
				path: 'shared.md',
				status: 'modified',
				before: '# Shared\n\none\ntwo\nthree\n',
				after: '# Shared\n\nONE!\ntwo\nthree\n'
			}
		]);
		// Read-only: nothing got staged or committed.
		expect(await a.sync.changes()).toHaveLength(3);
		expect(remoteLog()).toHaveLength(1);
	});
});
