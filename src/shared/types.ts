/** Types shared across the main, preload and renderer processes. */

export interface NoteMeta {
	/** Stable id — the path relative to the workspace root. */
	id: string;
	/** Absolute path on disk. */
	absPath: string;
	/** First heading or filename, used as the list title. */
	title: string;
	/** Plain-text preview for the note list. */
	snippet: string;
	/** Last-modified time (ms epoch). */
	mtime: number;
	/** Distinct tags found in the body. */
	tags: string[];
	/** Pinned notes sort to the top of the list. */
	pinned: boolean;
	/** Locked notes are read-only and can't be deleted until unlocked. */
	locked: boolean;
}

export interface TagNode {
	name: string;
	path: string;
	count: number;
	children: TagNode[];
}

export interface Workspace {
	path: string | null;
}

/** Channel names, kept in one place so main + preload can't drift. */
export const Channels = {
	workspacePick: 'workspace:pick',
	workspaceGet: 'workspace:get',
	notesList: 'notes:list',
	noteRead: 'note:read',
	noteWrite: 'note:write',
	noteCreate: 'note:create',
	noteDelete: 'note:delete',
	tagsList: 'tags:list',
	// Folders: the workspace's sub-directories (incl. empty ones), and creation.
	foldersList: 'folders:list',
	folderCreate: 'folder:create',
	// Trash (.fr5a_trash): soft-delete, restore, permanent delete.
	trashList: 'trash:list',
	noteRestore: 'note:restore',
	trashDelete: 'trash:delete',
	windowMinimize: 'window:minimize',
	windowMaximize: 'window:maximize',
	windowClose: 'window:close',
	// main -> renderer push
	notesChanged: 'notes:changed'
} as const;
