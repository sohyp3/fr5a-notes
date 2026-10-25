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
	return entries.map(mapNameOf).filter((n): n is string => n !== null);
}

export const readMap = (name: string): Promise<string | null> => platform.readMeta(mapPath(name));
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
	const text = await readMap(from);
	await writeMap(to, text ?? serializeCanvas(emptyCanvas()));
	await deleteMap(from);
}

export async function duplicateMap(from: string, to: string): Promise<void> {
	await writeMap(to, (await readMap(from)) ?? serializeCanvas(emptyCanvas()));
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
