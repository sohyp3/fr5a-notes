import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Files under the workspace's hidden `.fr5a/` folder: harness sessions and
 * skills. The note scan and watcher skip dot-folders, so these never show up
 * as notes, but git sync still carries them. Paths are relative to `.fr5a/`
 * and can't escape it.
 */

export const META_DIR = '.fr5a';

export function metaPath(root: string, rel: string): string {
	const base = path.join(root, META_DIR);
	const abs = path.resolve(base, rel);
	if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error(`Bad meta path: ${rel}`);
	return abs;
}

export async function readMeta(root: string, rel: string): Promise<string | null> {
	try {
		return await fs.readFile(metaPath(root, rel), 'utf8');
	} catch {
		return null;
	}
}

export async function writeMeta(root: string, rel: string, content: string): Promise<void> {
	const abs = metaPath(root, rel);
	await fs.mkdir(path.dirname(abs), { recursive: true });
	// Write-then-rename so a crash mid-write never leaves a truncated session.
	const tmp = `${abs}.tmp`;
	await fs.writeFile(tmp, content, 'utf8');
	await fs.rename(tmp, abs);
}

/** Entries (not recursive) of a `.fr5a/` sub-directory: files newest first, then folders as `name/`. */
export async function listMeta(root: string, rel: string): Promise<string[]> {
	const dir = metaPath(root, rel);
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		const files = await Promise.all(
			entries
				.filter((e) => e.isFile() && !e.name.endsWith('.tmp'))
				.map(async (e) => ({
					name: e.name,
					mtime: (await fs.stat(path.join(dir, e.name))).mtimeMs
				}))
		);
		const dirs = entries
			.filter((e) => e.isDirectory() && e.name !== '.git')
			.map((e) => `${e.name}/`);
		return [...files.sort((a, b) => b.mtime - a.mtime).map((f) => f.name), ...dirs.sort()];
	} catch {
		return [];
	}
}

export async function deleteMeta(root: string, rel: string): Promise<void> {
	await fs.rm(metaPath(root, rel), { force: true });
}
