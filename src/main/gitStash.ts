import path from 'node:path';
import { git, MAX_BYTES, parsePorcelain } from './gitChanges';
import { byRepo } from '../shared/multiSync';
import { isTrackedNote, type ChangeStatus, type GitChange, type GitStash } from '../shared/types';

/**
 * Stash and revert for the Changes view, on the system git CLI. A stash holds
 * only the notes it is given (`git stash push -u -- <paths>`, so new notes come
 * along) and is an ordinary git stash: `git stash list` in a terminal shows the
 * same entries. Applying never overwrites edits made since — it refuses first.
 * Nested repos each keep their own stash list.
 */

export class GitOpError extends Error {}

/** Paths are note names, never globs. */
const LITERAL = '--literal-pathspecs';

function fail(r: { stdout: string; stderr: string }, fallback: string): never {
	const msg = (r.stderr || r.stdout).trim().replace(/^(error|fatal): /gm, '');
	throw new GitOpError(msg || fallback);
}

/** `-c user.*` fallbacks: a stash is a commit, and needs an identity. */
async function identity(dir: string): Promise<string[]> {
	const name = (await git(dir, ['config', 'user.name'])).stdout.trim();
	const email = (await git(dir, ['config', 'user.email'])).stdout.trim();
	return [
		...(name ? [] : ['-c', 'user.name=fr5a']),
		...(email ? [] : ['-c', 'user.email=fr5a@localhost'])
	];
}

/** A blob's text (capped like the Changes view), or null when absent. */
async function show(dir: string, spec: string): Promise<string | null> {
	const r = await git(dir, ['show', spec]);
	if (r.code !== 0) return null;
	return r.stdout.length > MAX_BYTES
		? `(${Math.round(r.stdout.length / 1024)} KB — too large to diff)`
		: r.stdout;
}

/** Every path a stash touches: tracked changes, plus untracked files (its third parent). */
async function stashPaths(
	dir: string,
	id: string
): Promise<{ path: string; status: ChangeStatus; untracked: boolean }[]> {
	const out: { path: string; status: ChangeStatus; untracked: boolean }[] = [];
	const d = await git(dir, [
		'-c',
		'core.quotePath=false',
		'diff',
		'--no-renames',
		'--name-status',
		'-z',
		`${id}^1`,
		id
	]);
	const t = d.stdout.split('\0');
	for (let i = 0; i + 1 < t.length; i += 2) {
		if (!t[i] || !t[i + 1]) continue;
		const status: ChangeStatus = t[i] === 'A' ? 'added' : t[i] === 'D' ? 'deleted' : 'modified';
		out.push({ path: t[i + 1], status, untracked: false });
	}
	const u = await git(dir, [
		'-c',
		'core.quotePath=false',
		'ls-tree',
		'-r',
		'-z',
		'--name-only',
		`${id}^3`
	]);
	if (u.code === 0)
		for (const p of u.stdout.split('\0').filter(Boolean))
			out.push({ path: p, status: 'added', untracked: true });
	return out;
}

/** Position of a stash commit in `refs/stash` (indexes shift as stashes come and go). */
async function stashIndex(dir: string, id: string): Promise<number> {
	const r = await git(dir, ['stash', 'list', '--format=%H']);
	const i = r.code === 0 ? r.stdout.split('\n').indexOf(id) : -1;
	if (i === -1) throw new GitOpError('That stash no longer exists.');
	return i;
}

/** Stashes of one repo, newest first; [] when it has none (or isn't a repo). */
export async function repoStashes(dir: string, prefix = ''): Promise<GitStash[]> {
	const r = await git(dir, ['stash', 'list', '-z', '--format=%H%x1f%ct%x1f%gs']);
	if (r.code !== 0) return [];
	const out: GitStash[] = [];
	for (const entry of r.stdout.split('\0')) {
		const [id, ct, subject] = entry.replace(/^\n/, '').split('\x1f');
		if (!id || subject === undefined) continue;
		const files: GitChange[] = [];
		for (const f of await stashPaths(dir, id)) {
			if (!isTrackedNote(f.path)) continue;
			files.push({
				path: prefix ? `${prefix}/${f.path}` : f.path,
				status: f.status,
				before: f.status === 'added' ? null : await show(dir, `${id}^1:${f.path}`),
				after:
					f.status === 'deleted'
						? null
						: await show(dir, `${id}${f.untracked ? '^3' : ''}:${f.path}`)
			});
		}
		out.push({
			repo: prefix,
			id,
			date: Number(ct) * 1000,
			message: subject.replace(/^On [^:]+: /, ''),
			files
		});
	}
	return out;
}

/** Stash these notes (paths relative to `dir`) and revert them to the last commit. */
export async function stashPush(dir: string, paths: string[], message: string): Promise<void> {
	if (!paths.length) return;
	const r = await git(dir, [
		LITERAL,
		...(await identity(dir)),
		'stash',
		'push',
		'--include-untracked',
		'--quiet',
		'-m',
		message,
		'--',
		...paths
	]);
	if (r.code !== 0) fail(r, 'git stash failed');
}

/**
 * Bring a stash back (and drop it when `drop`). Refuses when a note it holds
 * has changed since; returns the notes a merge left with conflict markers
 * (the stash is then kept).
 */
export async function stashApply(dir: string, id: string, drop: boolean): Promise<string[]> {
	const idx = await stashIndex(dir, id);
	const touched = new Set((await stashPaths(dir, id)).map((f) => f.path));
	const st = await git(dir, [
		'-c',
		'core.quotePath=false',
		'status',
		'--porcelain=v1',
		'-z',
		'--no-renames',
		'--untracked-files=all'
	]);
	const dirty = parsePorcelain(st.stdout)
		.map((r) => r.path)
		.filter((p) => touched.has(p));
	if (dirty.length)
		throw new GitOpError(
			`Your edits to ${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? '…' : ''} would be overwritten — stash or revert them first.`
		);
	const r = await git(dir, ['stash', 'apply', '--quiet', `stash@{${idx}}`]);
	if (r.code !== 0) {
		const u = await git(dir, ['diff', '--name-only', '-z', '--diff-filter=U']);
		const conflicts = u.stdout.split('\0').filter(Boolean);
		if (!conflicts.length) fail(r, 'git stash apply failed');
		// Keep the markers in the files, not a half-merged index.
		await git(dir, [LITERAL, 'reset', '--quiet', '--', ...conflicts]);
		return conflicts;
	}
	if (drop) await git(dir, ['stash', 'drop', '--quiet', `stash@{${idx}}`]);
	return [];
}

export async function stashDrop(dir: string, id: string): Promise<void> {
	const idx = await stashIndex(dir, id);
	const r = await git(dir, ['stash', 'drop', '--quiet', `stash@{${idx}}`]);
	if (r.code !== 0) fail(r, 'git stash drop failed');
}

/**
 * Put notes back to their last committed text. Notes the last commit doesn't
 * have are unstaged and returned (relative to `dir`) for the caller to trash.
 */
export async function revertPaths(dir: string, paths: string[]): Promise<string[]> {
	if (!paths.length) return [];
	const head = await git(dir, [
		'-c',
		'core.quotePath=false',
		'ls-tree',
		'-r',
		'-z',
		'--name-only',
		'HEAD',
		'--',
		...paths
	]);
	const committed = new Set(head.code === 0 ? head.stdout.split('\0').filter(Boolean) : []);
	const restore = paths.filter((p) => committed.has(p));
	const fresh = paths.filter((p) => !committed.has(p));
	if (restore.length) {
		const r = await git(dir, [LITERAL, 'checkout', '--quiet', 'HEAD', '--', ...restore]);
		if (r.code !== 0) fail(r, 'git checkout failed');
	}
	if (fresh.length)
		await git(dir, [LITERAL, 'rm', '--quiet', '--cached', '--ignore-unmatch', '--', ...fresh]);
	return fresh;
}

// --- workspace: root + nested repos ------------------------------------------

const repoDir = (root: string, repo: string) => (repo ? path.join(root, repo) : root);
const prefixed = (repo: string, p: string) => (repo ? `${repo}/${p}` : p);

/** Only notes inside the workspace (no `..`, no dot-folders, no absolute paths). */
function checkPaths(paths: string[]): void {
	for (const p of paths)
		if (!isTrackedNote(p) || p.startsWith('/')) throw new GitOpError(`Not a note: ${p}`);
}

function checkRepo(repo: string, nested: string[]): void {
	if (repo && !nested.includes(repo)) throw new GitOpError(`No repository at ${repo}.`);
}

export async function workspaceStashes(root: string, nested: string[]): Promise<GitStash[]> {
	const all = await Promise.all(['', ...nested].map((r) => repoStashes(repoDir(root, r), r)));
	return all.flat().sort((a, b) => b.date - a.date);
}

/** One stash per repo the notes belong to, all with `message`. */
export async function workspaceStash(
	root: string,
	nested: string[],
	paths: string[],
	message: string
): Promise<void> {
	checkPaths(paths);
	for (const [repo, rels] of byRepo(paths, nested))
		await stashPush(repoDir(root, repo), rels, message);
}

export async function workspaceStashApply(
	root: string,
	nested: string[],
	repo: string,
	id: string,
	drop: boolean
): Promise<string[]> {
	checkRepo(repo, nested);
	return (await stashApply(repoDir(root, repo), id, drop)).map((p) => prefixed(repo, p));
}

export async function workspaceStashDrop(
	root: string,
	nested: string[],
	repo: string,
	id: string
): Promise<void> {
	checkRepo(repo, nested);
	await stashDrop(repoDir(root, repo), id);
}

/** Revert notes; returns the new ones (workspace paths) for the caller to trash. */
export async function workspaceRevert(
	root: string,
	nested: string[],
	paths: string[]
): Promise<string[]> {
	checkPaths(paths);
	const fresh: string[] = [];
	for (const [repo, rels] of byRepo(paths, nested))
		for (const p of await revertPaths(repoDir(root, repo), rels)) fresh.push(prefixed(repo, p));
	return fresh;
}
