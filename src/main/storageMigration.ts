import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
	storageMoveError,
	storageRewriteError,
	type StoragePlan,
	type StorageResult
} from '../shared/storageMigration';

/**
 * Desktop executor of a storage plan (`shared/storageMigration.ts`): rewrites
 * the notes' links in place, then renames the files into `.fr5a/`. Every file
 * keeps its mtime (the note list is sorted by it). Validates the whole plan
 * before touching anything; a target that already exists stops it too.
 */
export async function applyStorageMigration(
	root: string,
	plan: StoragePlan
): Promise<StorageResult & { written: string[]; renamed: [string, string][] }> {
	const base = path.resolve(root);
	const abs = (rel: string) => {
		const p = path.resolve(base, rel);
		if (!p.startsWith(base + path.sep)) throw new Error(`Outside the workspace: ${rel}`);
		return p;
	};
	for (const m of plan.moves) {
		const err = storageMoveError(m);
		if (err) throw new Error(err);
		if (await exists(abs(m.to))) throw new Error(`Already there: ${m.to}`);
	}
	for (const r of plan.rewrites) {
		const err = storageRewriteError(r);
		if (err) throw new Error(err);
	}

	const written: string[] = [];
	const skipped = [...plan.skipped];
	for (const r of plan.rewrites) {
		const file = abs(r.id);
		try {
			const { atime, mtime } = await fs.stat(file);
			await fs.writeFile(file, r.text, 'utf8');
			await fs.utimes(file, atime, mtime);
			written.push(r.id);
		} catch {
			skipped.push(r.id);
		}
	}
	const renamed: [string, string][] = [];
	for (const m of plan.moves) {
		const from = abs(m.from);
		const to = abs(m.to);
		try {
			const { atime, mtime } = await fs.stat(from);
			await fs.mkdir(path.dirname(to), { recursive: true });
			await fs.rename(from, to);
			await fs.utimes(to, atime, mtime).catch(() => {});
			renamed.push([m.from, m.to]);
		} catch {
			/* vanished meanwhile: nothing to move */
		}
	}
	// Emptied source folders (`assets/`, `AI chats/`) go; ones still holding files stay.
	const dirs = new Set(plan.moves.map((m) => path.dirname(abs(m.from))));
	for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
		for (let d = dir; d !== base && d.startsWith(base + path.sep); d = path.dirname(d)) {
			const removed = await fs.rmdir(d).then(...ok);
			if (!removed) break;
		}
	}
	return { moved: renamed.length, rewritten: written.length, skipped, written, renamed };
}

/** `then` handlers: resolved → true, rejected → false. */
const ok = [() => true, () => false] as const;

async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}
