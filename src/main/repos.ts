import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createGitSync, GitSyncError } from './gitSync';
import {
	createMultiSync,
	isReadOnlyRepo,
	nestedIgnores,
	syncOrder,
	withNestedIgnored
} from '../shared/multiSync';

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

/**
 * Clone `url` into a new workspace folder (system git and its credentials —
 * SSH keys or a credential helper). Then the folder is a nested repo.
 */
export async function addRepo(root: string, folder: string, url: string): Promise<string> {
	const rel = safeRel(folder);
	if (!rel) throw new GitSyncError('git', 'Pick a folder inside your notes.');
	if (!/^(https?:\/\/|ssh:\/\/|git@)\S+$/i.test(url.trim()))
		throw new GitSyncError('no-remote', 'Use an https:// or SSH clone URL.');
	const dest = path.join(root, rel);
	const existing = await fs.readdir(dest).catch(() => null);
	if (existing && existing.length)
		throw new GitSyncError('git', `${rel} already has files; pick a new folder.`);
	await fs.mkdir(path.dirname(dest), { recursive: true });
	await new Promise<void>((resolve, reject) =>
		execFile(
			'git',
			['clone', '--quiet', url.trim(), dest],
			{
				env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }
			},
			(err, _out, stderr) =>
				err
					? reject(
							new GitSyncError(
								/denied|auth|403|401/i.test(stderr) ? 'auth' : 'git',
								stderr.trim() || err.message
							)
						)
					: resolve()
		)
	);
	await ignoreNested(root, await findNestedRepos(root));
	return rel;
}
