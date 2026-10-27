import type { NoteMeta } from '../../../../shared/types';
import { parseCanvas, serializeCanvas } from '../maps/canvas';
import type { PreparedWrite } from './apply';
import { blankMap, mapChangeLines, mapPatch } from './mapTools';
import { AbortError } from './openai';

/** What a map approval rechecks and mutates; injected so the flow is unit-tested. */
export interface MapReviewDeps {
	enabled(): boolean;
	notes(): readonly NoteMeta[];
	list(): Promise<string[]>;
	read(name: string): Promise<string | null>;
	write(name: string, text: string): Promise<void>;
	remove(name: string): Promise<void>;
	/** Flush pending saves and refuse while the canvas is actively edited. */
	guard(name: string): Promise<void>;
	/** Second, destructive confirmation (false on Cancel/Stop). */
	confirmDelete(name: string, signal?: AbortSignal): Promise<boolean>;
	forgot(name: string): void;
	/** Bump so open canvases re-read the map after a write. */
	changed(): void;
}

/** The map's name as it exists on disk (`Atlas` for a request of `atlas`). */
export function findMapName(names: readonly string[], name: string): string | undefined {
	return names.find((n) => n.toLowerCase() === name.toLowerCase());
}

/**
 * The map half of an approval: resolve the map's real name, prepare a validated
 * before/after, and recheck the disk text immediately before writing.
 */
export async function prepareMapReview(
	tool: 'create_map' | 'edit_map' | 'delete_map',
	name: string,
	patch: unknown,
	deps: MapReviewDeps
): Promise<PreparedWrite> {
	if (!deps.enabled()) throw new Error('Mind maps are disabled.');
	await deps.guard(name);
	const names = await deps.list();
	const existing = findMapName(names, name);
	if (tool === 'create_map' && existing)
		throw new Error(`A map called “${existing}” already exists.`);
	if (tool !== 'create_map' && !existing) throw new Error(`No map called “${name}”.`);
	// Use the name as it exists on disk: case-only agent requests read the same file.
	const target = existing ?? name;
	const before = tool === 'create_map' ? null : await deps.read(target);
	if (tool !== 'create_map' && before === null) throw new Error(`No map called “${name}”.`);
	const parsedBefore = before === null ? null : parseCanvas(before);
	if (parsedBefore?.skipped.nodes.length || parsedBefore?.skipped.edges.length)
		throw new Error(
			'This map has malformed nodes or edges; repair it in the map editor before AI editing.'
		);
	const beforeDoc = parsedBefore?.doc ?? null;
	let after = tool === 'create_map' ? blankMap() : '';
	if (tool === 'edit_map') {
		after = serializeCanvas(mapPatch(patch, beforeDoc!, deps.notes()));
		if (after === before) throw new Error('The map patch makes no change.');
	}
	const afterDoc = parseCanvas(after).doc;
	return {
		label: `mind map “${target}”${tool === 'delete_map' ? ' (permanent deletion; linked notes remain)' : ''}`,
		summary: mapChangeLines(tool, beforeDoc, afterDoc),
		before: before ?? '',
		after,
		async apply(signal?: AbortSignal) {
			if (!deps.enabled()) throw new Error('Mind maps were disabled; nothing changed.');
			await deps.guard(target);
			const latest = await deps.read(target);
			if (
				latest !== before ||
				(tool === 'create_map' &&
					(await deps.list()).some((n) => n.toLowerCase() === target.toLowerCase()))
			)
				throw new Error('The map changed since review; nothing applied. Read it again.');
			if (tool === 'edit_map') mapPatch(patch, parseCanvas(before!).doc, deps.notes());
			if (signal?.aborted) throw new AbortError();
			if (tool === 'delete_map') {
				const confirmed = await deps.confirmDelete(target, signal);
				if (signal?.aborted) throw new AbortError();
				if (!confirmed) return 'The user rejected deletion; map kept.';
				await deps.guard(target);
				if (signal?.aborted) throw new AbortError();
				if ((await deps.read(target)) !== before)
					throw new Error('The map changed during confirmation; nothing deleted.');
				// Stop can land while the final guard waits on a save or the read is in flight.
				if (signal?.aborted) throw new AbortError();
				await deps.remove(target);
				deps.forgot(target);
			} else await deps.write(target, after);
			deps.changed();
			return `${tool === 'create_map' ? 'Created' : tool === 'edit_map' ? 'Edited' : 'Deleted'} map “${target}”.`;
		}
	};
}
