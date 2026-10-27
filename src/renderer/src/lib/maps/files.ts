/**
 * Map files under `.fr5a/maps/` through the platform's meta-file calls. Never
 * indexed as notes, so nothing here refreshes the vault.
 */
import { platform } from '../platform';
import {
	MAPS_DIR,
	emptyCanvas,
	mapNameOf,
	mapPath,
	parseCanvas,
	rewritePaths,
	serializeCanvas
} from './canvas';

/** Map names, newest first (the host lists files by mtime). */
export async function listMaps(): Promise<string[]> {
	const entries = await platform.listMeta(MAPS_DIR).catch(() => [] as string[]);
	return entries.map(mapNameOf).filter((n): n is string => {
		if (n === null) return false;
		try {
			mapPath(n);
			return true;
		} catch {
			return false;
		}
	});
}

export const readMap = (name: string): Promise<string | null> => platform.readMeta(mapPath(name));

/** Saves of a map that was just closed may still be on their way to disk. */
const saving = new Map<string, Promise<void>>();
const failures = new Map<string, Error>();
/** An open editor can hold changes not yet in its tracked disk save. */
const editors = new Map<string, () => Promise<boolean>>();
export function registerMapEditor(name: string, guard: () => Promise<boolean>): () => void {
	editors.set(name, guard);
	return () => {
		if (editors.get(name) === guard) editors.delete(name);
	};
}
/** Flush queued saves and refuse reads while the canvas is being edited. */
export async function guardMapRead(name: string): Promise<void> {
	const guard = editors.get(name);
	if (guard && !(await guard()))
		throw new Error('The map has unsaved or active editor changes; finish editing and try again.');
	await saved(name);
}
/** Flush queued saves and refuse external writes while the canvas is being edited. */
export async function guardMapWrite(name: string): Promise<void> {
	await guardMapRead(name);
	const failure = failures.get(name);
	if (failure) throw new Error(`The map could not be saved: ${failure.message}`);
}

export function recordMapSaveFailure(name: string, err: unknown): void {
	failures.set(name, err instanceof Error ? err : new Error(String(err)));
}

export function clearMapSaveFailure(name: string): void {
	failures.delete(name);
}

/** The map editor's pending save (it never rejects): opening, renaming, deleting wait for it. */
export function trackSave(name: string, save: Promise<void>): void {
	saving.set(name, save);
	void save.finally(() => {
		if (saving.get(name) === save) saving.delete(name);
	});
}

/** Resolves once every save of `name` started so far is on disk. */
export const saved = (name: string): Promise<void> => saving.get(name) ?? Promise.resolve();
/** Includes saves begun by canvases that have already been closed. */
export async function savedAll(): Promise<void> {
	while (saving.size) await Promise.all([...saving.values()]);
	const failure = failures.values().next().value;
	if (failure) throw new Error(`A mind map could not be saved: ${failure.message}`);
}
export const writeMap = (name: string, text: string): Promise<void> =>
	platform.writeMeta(mapPath(name), text);
export const deleteMap = (name: string): Promise<void> => platform.deleteMeta(mapPath(name));

/** A name not taken yet: `Mind map`, `Mind map 2`, … */
export function freeName(base: string, taken: readonly string[]): string {
	const lower = new Set(taken.map((t) => t.toLowerCase()));
	if (!lower.has(base.toLowerCase())) return base;
	for (let i = 2; ; i++) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export async function createMap(name: string): Promise<void> {
	await writeMap(name, serializeCanvas(emptyCanvas()));
}

export async function renameMap(from: string, to: string): Promise<void> {
	await saved(from);
	const text = (await readMap(from)) ?? serializeCanvas(emptyCanvas());
	if (from.toLowerCase() === to.toLowerCase()) {
		// Only the case changes: on a case-insensitive disk `to` *is* `from`, so
		// deleting `from` after writing `to` would delete the map. Step aside first.
		const aside = `${from}.renaming`;
		await writeMap(aside, text);
		await deleteMap(from);
		await writeMap(to, text);
		await deleteMap(aside);
		return;
	}
	await writeMap(to, text);
	await deleteMap(from);
}

export async function duplicateMap(from: string, to: string): Promise<void> {
	await saved(from);
	await writeMap(to, (await readMap(from)) ?? serializeCanvas(emptyCanvas()));
}

export async function removeMap(name: string): Promise<void> {
	await saved(name);
	await deleteMap(name);
}

/**
 * Re-point note references in every map at a moved note / folder (`skip`:
 * the map open in the editor, which patches its own state). Small files:
 * list, parse, patch, write only the ones that changed.
 */
export async function rewriteMapsOnMove(from: string, to: string, skip?: string): Promise<void> {
	for (const name of await listMaps()) {
		if (name === skip) continue;
		const text = await readMap(name).catch(() => null);
		if (!text) continue;
		try {
			const { doc, skipped } = parseCanvas(text);
			const next = rewritePaths(doc, from, to);
			if (next) await writeMap(name, serializeCanvas(next, skipped));
		} catch {
			// A file that isn't a canvas is left as it is.
		}
	}
}
