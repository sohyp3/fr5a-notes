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
	/** Carries `<!-- ai: local -->`: only local AI providers may read it. */
	aiLocal: boolean;
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
	/** Pane visibility + widths (renderer-owned shape). */
	panes?: { sidebarOpen?: boolean; listOpen?: boolean; widths?: Record<string, number> };
}

/** Keys the renderer may read/write in the persistent store. */
export type StateKey = 'lastOpenFile' | 'sidebar' | 'settings' | 'theme' | 'ai';

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

/** An outbound HTTP request made on the renderer's behalf (LLM / web search / pages). */
export interface HttpRequest {
	url: string;
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	/** Text body (JSON is pre-stringified by the caller). */
	body?: string;
	/** Abort after this many ms (default 120s). */
	timeoutMs?: number;
}

export interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	/** Whole body as text. For a streamed request: whatever was not delivered as chunks. */
	body: string;
}

export type ChangeStatus = 'added' | 'modified' | 'deleted';

/**
 * A note that differs from the last commit (git status). `before` is the
 * committed text (null when new), `after` the file on disk (null when deleted).
 */
export interface GitChange {
	/** Workspace-relative path (nested repos prefixed with their folder). */
	path: string;
	status: ChangeStatus;
	before: string | null;
	after: string | null;
}

/** Note files git status looks at: Markdown / text outside dot-folders. */
export function isTrackedNote(path: string): boolean {
	return /\.(md|markdown|txt)$/i.test(path) && !path.split('/').some((s) => s.startsWith('.'));
}

/**
 * Notes set aside and reverted to the last commit, to bring back later.
 * Desktop: `git stash` entries (ones made in a terminal show up too);
 * Android: snapshots kept under the repo's `.git/`, never synced.
 */
export interface GitStash {
	/** Repo folder ('' = root). */
	repo: string;
	/** Stable id: the stash commit (desktop) or the snapshot id (Android). */
	id: string;
	message: string;
	/** ms epoch. */
	date: number;
	/** Stashed notes (workspace paths): `before` = the commit it was made on, `after` = stashed text. */
	files: GitChange[];
}

/** Result of a stash / revert. `conflicts`: notes an apply left with conflict markers. */
export type GitOpResponse = { ok: true; conflicts?: string[] } | { ok: false; error: string };

/** One git repo in the workspace: '' is the root, others are nested folders. */
export interface SyncRepo {
	path: string;
	remote: string | null;
	/** Android: a token is stored for this repo. */
	hasToken?: boolean;
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
	/** Move / rename a note or a folder inside the workspace. */
	noteMove: 'note:move',
	folderMove: 'folder:move',
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
	/** Workspace repos (root + nested) and their remotes. */
	syncRepos: 'sync:repos',
	syncAddRepo: 'sync:addRepo',
	/** Notes changed since the last commit (git status + committed text). */
	gitChanges: 'git:changes',
	// Stash changed notes, list / apply / drop stashes, revert notes to the last commit.
	gitStash: 'git:stash',
	gitStashes: 'git:stashes',
	gitStashApply: 'git:stashApply',
	gitStashDrop: 'git:stashDrop',
	gitRevert: 'git:revert',
	// Outbound HTTP for the AI harness (the renderer's CSP blocks fetch).
	httpFetch: 'http:fetch',
	httpStream: 'http:stream',
	httpAbort: 'http:abort',
	// Secrets (API keys) encrypted with safeStorage.
	secretGet: 'secret:get',
	secretSet: 'secret:set',
	// Files under the workspace's hidden `.fr5a/` folder (harness sessions, skills).
	metaRead: 'meta:read',
	metaWrite: 'meta:write',
	metaList: 'meta:list',
	metaDelete: 'meta:delete',
	// main -> renderer push
	/** A streamed HTTP body chunk: (requestId, text). */
	httpChunk: 'http:chunk',
	notesChanged: 'notes:changed',
	/** A pull stopped on conflicts; payload is ConflictFile[]. */
	syncConflict: 'sync:conflict',
	/** A sync finished cleanly (pull/push/resolve/abort); reload open notes. */
	syncDone: 'sync:done'
} as const;
