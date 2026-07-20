import type { NoteMeta } from '../../../shared/types';

/**
 * A node in the workspace folder tree, derived from note ids (which are
 * workspace-relative paths). Only sub-directories appear — root-level notes are
 * covered by "All Notes".
 */
export interface FolderNode {
	/** Leaf folder name, e.g. `project1`. */
	name: string;
	/** Full path from the workspace root, e.g. `work/project1`. */
	path: string;
	/** Notes in this folder or any descendant. */
	count: number;
	children: FolderNode[];
}

export function buildFolderTree(notes: NoteMeta[], folders: string[] = []): FolderNode[] {
	const roots: FolderNode[] = [];
	const index = new Map<string, FolderNode>();

	const ensure = (path: string): FolderNode => {
		let node = index.get(path);
		if (node) return node;
		const slash = path.lastIndexOf('/');
		const name = slash === -1 ? path : path.slice(slash + 1);
		node = { name, path, count: 0, children: [] };
		index.set(path, node);
		if (slash === -1) roots.push(node);
		else ensure(path.slice(0, slash)).children.push(node);
		return node;
	};

	for (const note of notes) {
		const slash = note.id.lastIndexOf('/');
		if (slash === -1) continue; // root-level note, no folder
		const dir = note.id.slice(0, slash);
		let prefix = '';
		for (const segment of dir.split('/')) {
			prefix = prefix ? `${prefix}/${segment}` : segment;
			ensure(prefix).count++;
		}
	}

	// Materialise explicitly-created folders (incl. empty ones) so they show in
	// the tree even before they hold any notes.
	for (const folder of folders) {
		let prefix = '';
		for (const segment of folder.split('/')) {
			prefix = prefix ? `${prefix}/${segment}` : segment;
			ensure(prefix);
		}
	}

	const sortRec = (nodes: FolderNode[]) => {
		nodes.sort((a, b) => a.name.localeCompare(b.name));
		for (const n of nodes) sortRec(n.children);
	};
	sortRec(roots);
	return roots;
}
