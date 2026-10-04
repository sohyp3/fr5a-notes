import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { classify, createGitSync, GitSyncError } from './gitSync';
import {
	createMultiSync,
	isReadOnlyRepo,
	nestedIgnores,
	repoOf,
	syncOrder,
	withNestedIgnored
} from '../shared/multiSync';
import type { SyncResult } from '../shared/types';

/**
 * Workspace repos for desktop sync: the root (if it is a repo) plus nested
 * repos found a few levels down — e.g. `private/` cloned from your own server,
 * `.fr5a/` for AI sessions, `.fr5a/skills/<pack>` for skill packs. Each repo's
 * `.gitignore` lists the repos directly inside it, so nothing leaks upward.
 */

const MAX_DEPTH = 4;
const SKIP = new Set(['node_modules', '.git', '.fr5a_trash']);

async function isRepoDir(dir: string): Promise<boolean> {
	try {
		await fs.stat(path.join(dir, '.git'));
		return true;
	} catch {
		return false;
	}
}

/** Workspace-relative folders holding a nested `.git` (not the root itself). */
export async function findNestedRepos(root: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > MAX_DEPTH) return;
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (!e.isDirectory() || SKIP.has(e.name)) continue;
			const abs = path.join(dir, e.name);
			if (await isRepoDir(abs)) out.push(path.relative(root, abs).split(path.sep).join('/'));
			await walk(abs, depth + 1);
		}
	}
	await walk(root, 1);
	return out.sort();
}

/** Write each repo's `.gitignore` so it never commits the repos inside it. */
export async function ignoreNested(root: string, nested: string[]): Promise<void> {
	for (const { repo, entries } of nestedIgnores(nested)) {
		const dir = repo ? path.join(root, repo) : root;
		if (!(await isRepoDir(dir))) continue;
		const file = path.join(dir, '.gitignore');
		const current = await fs.readFile(file, 'utf8').catch(() => '');
		const next = withNestedIgnored(current, entries);
		if (next !== null) await fs.writeFile(file, next, 'utf8');
	}
}

export async function workspaceSync(root: string) {
	const nested = await findNestedRepos(root);
	await ignoreNested(root, nested);
	const repos = syncOrder(['', ...nested]).map((rel) => ({
		rel,
		sync: createGitSync(rel ? path.join(root, rel) : root),
		readOnly: isReadOnlyRepo(rel)
	}));
	return createMultiSync(repos, (code, message) => new GitSyncError(code, message));
}

/** For Settings: each repo and the remote it syncs to. */
export async function listRepos(root: string): Promise<{ path: string; remote: string | null }[]> {
	const rels = ['', ...(await findNestedRepos(root))];
	return Promise.all(
		rels.map(async (rel) => ({
			path: rel,
			remote: await createGitSync(rel ? path.join(root, rel) : root).remoteUrl()
		}))
	);
}

/** Normalise a folder inside the workspace; null if it escapes or is reserved. */
function safeRel(folder: string): string | null {
	const parts: string[] = [];
	for (const seg of folder.replace(/\\/g, '/').split('/')) {
		if (!seg || seg === '.') continue;
		if (seg === '..' || seg === '.git') return null;
		parts.push(seg);
	}
	const rel = parts.join('/');
	return rel && rel !== '.fr5a_trash' && !rel.startsWith('.fr5a_trash/') ? rel : null;
}

/** Run git for repo setup; failures throw a classified GitSyncError. */
function setupGit(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) =>
		execFile(
			'git',
			args,
			{
				cwd,
				env: {
					...process.env,
					GIT_TERMINAL_PROMPT: '0',
					GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
					LC_ALL: 'C'
				}
			},
			(err, stdout, stderr) => {
				if (!err) return resolve(stdout);
				if ((err as NodeJS.ErrnoException).code === 'ENOENT')
					return reject(new GitSyncError('no-git', 'git was not found on PATH.'));
				const msg = (stderr || err.message).trim();
				reject(new GitSyncError(classify(msg), msg));
			}
		)
	);
}

/**
 * The notes repo's own `credential.*` / `user.*` settings (e.g. `credential.helper
 * store`). A new repo doesn't see another repo's local config, so it gets a copy
 * — otherwise a private remote would fail with "terminal prompts disabled".
 */
async function localConfig(root: string): Promise<[string, string][]> {
	if (!(await isRepoDir(root))) return [];
	const out = await setupGit(root, [
		'config',
		'--local',
		'--get-regexp',
		'^(credential|user)\\.'
	]).catch(() => '');
	return out
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const i = line.indexOf(' ');
			return (i === -1 ? [line, ''] : [line.slice(0, i), line.slice(i + 1)]) as [string, string];
		});
}

/** Remote URLs the app can sync with (system git: https, SSH, or a local file:// repo). */
const URL_RE = /^(https?:\/\/|ssh:\/\/|git@|file:\/\/)\S+$/i;

/**
 * Give a workspace folder its own repo syncing to `url` — e.g. `private/` →
 * your own server. Uses system git and its credentials (SSH keys, or whatever
 * credential helper the notes repo uses). A new or empty folder is cloned
 * into; a folder that already holds notes becomes a repo in place, and its
 * first sync merges in whatever the remote already has. The parent repo
 * ignores the folder and stops tracking it from its next commit (its history
 * keeps what was already pushed).
 */
export async function addRepo(root: string, folder: string, url: string): Promise<SyncResult> {
	const rel = safeRel(folder);
	if (!rel) throw new GitSyncError('git', 'Pick a folder inside your notes.');
	const remote = url.trim();
	if (!URL_RE.test(remote))
		throw new GitSyncError('no-remote', 'Use an https:// or SSH clone URL.');
	const dest = path.join(root, rel);
	const nestedBefore = await findNestedRepos(root);
	const config = await localConfig(root);
	const withConfig = config.flatMap(([k, v]) => ['-c', `${k}=${v}`]);

	// Check the URL and credentials before touching disk; learn the default branch.
	const head = await setupGit(root, [...withConfig, 'ls-remote', '--symref', remote, 'HEAD']);
	const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(head)?.[1] ?? 'main';

	const entries = ((await fs.readdir(dest).catch(() => [])) as string[]).filter(
		(n) => n !== '.DS_Store'
	);
	if (await isRepoDir(dest)) {
		// Already its own repo: point it at the new remote.
		const remotes = (await setupGit(dest, ['remote'])).split('\n');
		await setupGit(dest, [
			'remote',
			remotes.includes('origin') ? 'set-url' : 'add',
			'origin',
			remote
		]);
	} else {
		if (entries.length === 0) {
			await fs.mkdir(dest, { recursive: true });
			await setupGit(root, [...withConfig, 'clone', '--quiet', remote, dest]);
			await createGitSync(dest).commitTimesAfterClone();
		} else {
			await setupGit(dest, ['init', '--quiet']);
			await setupGit(dest, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
			await setupGit(dest, ['remote', 'add', 'origin', remote]);
		}
		for (const [k, v] of config) await setupGit(dest, ['config', '--add', k, v]);
	}

	// The parent repo ignores the folder, and stops tracking what it already had.
	await ignoreNested(root, await findNestedRepos(root));
	const parent = repoOf(rel, nestedBefore);
	const parentDir = parent.repo ? path.join(root, parent.repo) : root;
	if (await isRepoDir(parentDir))
		await setupGit(parentDir, [
			'--literal-pathspecs',
			'rm',
			'-r',
			'--quiet',
			'--cached',
			'--ignore-unmatch',
			'--',
			parent.rel
		]);

	const res = await createGitSync(dest).pull({ allowUnrelated: true });
	return res.status === 'conflict'
		? { status: 'conflict', files: res.files.map((f) => ({ ...f, path: `${rel}/${f.path}` })) }
		: res;
}
