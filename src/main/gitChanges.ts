import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isTrackedNote, type ChangeStatus, type GitChange } from '../shared/types';

/**
 * "What changed since the last sync": git status of the workspace's notes plus
 * the committed text of each, so the renderer can show a diff. Read-only — it
 * never stages or commits. Nested repos (their own `.git`) are included with
 * their folder as a path prefix.
 */

/** Bigger files are listed without their text. */
const MAX_BYTES = 512 * 1024;

function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
	return new Promise((resolve) => {
		execFile(
			'git',
			args,
			{
				cwd,
				env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
				maxBuffer: 64 * 1024 * 1024
			},
			(err, stdout) => {
				const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
				resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout });
			}
		);
	});
}

/** `git status --porcelain=v1 -z --no-renames` output → path + status. */
export function parsePorcelain(out: string): { path: string; status: ChangeStatus }[] {
	const rows: { path: string; status: ChangeStatus }[] = [];
	for (const entry of out.split('\0')) {
		if (entry.length < 4) continue;
		const x = entry[0];
		const y = entry[1];
		const p = entry.slice(3);
		const status: ChangeStatus =
			x === '?' || x === 'A' ? 'added' : x === 'D' || y === 'D' ? 'deleted' : 'modified';
		rows.push({ path: p, status });
	}
	return rows;
}

async function readCapped(file: string): Promise<string | null> {
	try {
		const st = await fs.stat(file);
		if (st.size > MAX_BYTES) return `(${Math.round(st.size / 1024)} KB — too large to diff)`;
		return await fs.readFile(file, 'utf8');
	} catch {
		return null;
	}
}

/** Changes of one repo; null when `dir` is not a git work tree. */
export async function repoChanges(dir: string, prefix = ''): Promise<GitChange[] | null> {
	const inside = await git(dir, ['rev-parse', '--is-inside-work-tree']);
	if (inside.code !== 0 || inside.stdout.trim() !== 'true') return null;
	const hasHead = (await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0;
	const st = await git(dir, [
		'-c',
		'core.quotePath=false',
		'status',
		'--porcelain=v1',
		'-z',
		'--no-renames',
		'--untracked-files=all'
	]);
	if (st.code !== 0) return null;
	const out: GitChange[] = [];
	for (const row of parsePorcelain(st.stdout)) {
		if (!isTrackedNote(row.path)) continue;
		const before =
			row.status === 'added' || !hasHead
				? null
				: (await git(dir, ['show', `HEAD:${row.path}`])).stdout;
		const after = row.status === 'deleted' ? null : await readCapped(path.join(dir, row.path));
		out.push({
			path: prefix ? `${prefix}/${row.path}` : row.path,
			status: hasHead ? row.status : 'added',
			before,
			after
		});
	}
	return out;
}

/** Root repo + nested repos, sorted by path; null when nothing is under git. */
export async function workspaceChanges(
	root: string,
	nested: string[]
): Promise<GitChange[] | null> {
	const all = [
		await repoChanges(root),
		...(await Promise.all(nested.map((n) => repoChanges(path.join(root, n), n))))
	];
	if (all.every((c) => c === null)) return null;
	return all.flatMap((c) => c ?? []).sort((a, b) => a.path.localeCompare(b.path));
}
