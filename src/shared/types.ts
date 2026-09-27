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

/**
 * Sidebar UI state persisted across launches (electron-store). Expansion maps
 * record explicit overrides only — a missing path falls back to the default
 * (top-level rows start open).
 */
export interface SidebarState {
	/** Whether the whole "Folders" section is shown. */
	foldersOpen: boolean;
	/** Whether the whole "Tags" section is shown. */
	tagsOpen: boolean;
	folderExpanded: Record<string, boolean>;
	tagExpanded: Record<string, boolean>;
}

/** Keys the renderer may read/write in the persistent store. */
export type StateKey = 'lastOpenFile' | 'sidebar' | 'settings' | 'theme';

/** One file left conflicted by a pull; `null` means that side deleted the file. */
export interface ConflictFile {
	path: string;
	mine: string | null;
	theirs: string | null;
}

export type SyncResult = { status: 'ok' } | { status: 'conflict'; files: ConflictFile[] };

/** How to settle one conflicted file: take a side, or write explicit content. */
export type ResolveChoice =
	{ path: string; pick: 'mine' | 'theirs' } | { path: string; content: string };

export type SyncErrorCode =
	'no-git' | 'not-a-repo' | 'no-remote' | 'auth' | 'network' | 'nothing-to-push' | 'git';

/** What a sync IPC call returns; errors travel as data since IPC drops custom error fields. */
export type SyncResponse =
	| { ok: true; result: SyncResult }
	| { ok: false; error: { code: SyncErrorCode | 'busy' | 'no-workspace'; message: string } };

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
	// Persistent UI state (electron-store): last open file, sidebar, settings.
	stateGet: 'state:get',
	stateSet: 'state:set',
	windowMinimize: 'window:minimize',
	windowMaximize: 'window:maximize',
	windowClose: 'window:close',
	// Git sync (system git CLI). Resolve/abort/conflicts are used by the conflict window.
	syncPull: 'sync:pull',
	syncPush: 'sync:push',
	syncResolve: 'sync:resolve',
	syncAbort: 'sync:abort',
	syncConflicts: 'sync:conflicts',
	// main -> renderer push
	notesChanged: 'notes:changed',
	/** A pull stopped on conflicts; payload is ConflictFile[]. */
	syncConflict: 'sync:conflict',
	/** A sync finished cleanly (pull/push/resolve/abort); reload open notes. */
	syncDone: 'sync:done'
} as const;
