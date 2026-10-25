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
 * before touching anything; a target that already exists stops it too. All
 * or nothing: a failed write or rename puts back what was already done
 * (renames undone, notes restored with their text and times) and throws.
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

	const written: { id: string; text: string; atime: Date; mtime: Date }[] = [];
	const renamed: [string, string][] = [];
	/** Undo renames (newest first), then put the notes back as they were. */
	const rollBack = async () => {
		for (const [from, to] of [...renamed].reverse())
			await fs.rename(abs(to), abs(from)).catch(() => {});
		for (const w of written) {
			const file = abs(w.id);
			await fs.writeFile(file, w.text, 'utf8').catch(() => {});
			await fs.utimes(file, w.atime, w.mtime).catch(() => {});
		}
	};
	const fail = async (what: string, err: unknown): Promise<never> => {
		await rollBack();
		const why = err instanceof Error ? err.message : String(err);
		throw new Error(`Couldn’t ${what} (${why}); nothing was changed.`);
	};

	for (const r of plan.rewrites) {
		const file = abs(r.id);
		try {
			const { atime, mtime } = await fs.stat(file);
			const text = await fs.readFile(file, 'utf8');
			written.push({ id: r.id, text, atime, mtime });
			await fs.writeFile(file, r.text, 'utf8');
			await fs.utimes(file, atime, mtime);
		} catch (err) {
			await fail(`update ${r.id}`, err);
		}
	}
	for (const m of plan.moves) {
		const from = abs(m.from);
		const to = abs(m.to);
		if (!(await exists(from))) continue; // vanished meanwhile: nothing to move
		try {
			const { atime, mtime } = await fs.stat(from);
			await fs.mkdir(path.dirname(to), { recursive: true });
			await fs.rename(from, to);
			renamed.push([m.from, m.to]);
			await fs.utimes(to, atime, mtime).catch(() => {});
		} catch (err) {
			await fail(`move ${m.from}`, err);
		}
	}
	// Emptied source folders (`assets/`, `AI chats/`) go; ones still holding files stay.
	const dirs = new Set(renamed.map(([from]) => path.dirname(abs(from))));
	for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
		for (let d = dir; d !== base && d.startsWith(base + path.sep); d = path.dirname(d)) {
			const removed = await fs.rmdir(d).then(...ok);
			if (!removed) break;
		}
	}
	return {
		moved: renamed.length,
		rewritten: written.length,
		skipped: [...plan.skipped],
		written: written.map((w) => w.id),
		renamed
	};
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
