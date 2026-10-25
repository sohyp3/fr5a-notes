import { parentOf } from '../../../shared/paths';

/**
 * Mouse drag-and-drop of notes and folders onto folders (touch layouts use
 * "Move to…" instead). The dragged item is kept here as well as in the
 * DataTransfer, because `dragover` can only see the payload's types.
 */

const TYPES = { note: 'application/x-fr5a-note', folder: 'application/x-fr5a-folder' } as const;

export type DragItem = { kind: 'note' | 'folder'; path: string };

let current: DragItem | null = null;

export function startDrag(e: DragEvent, item: DragItem): void {
	current = item;
	if (!e.dataTransfer) return;
	e.dataTransfer.setData(TYPES[item.kind], item.path);
	e.dataTransfer.effectAllowed = 'move';
}

export function endDrag(): void {
	current = null;
}

/** The item being dragged, if it can land in folder `target` ('' = workspace root). */
export function dropFor(e: DragEvent, target: string): DragItem | null {
	const types = e.dataTransfer?.types ?? [];
	if (!current || !types.includes(TYPES[current.kind])) return null;
	const { kind, path } = current;
	if (parentOf(path) === target) return null;
	if (kind === 'folder' && (target === path || target.startsWith(`${path}/`))) return null;
	return current;
}
