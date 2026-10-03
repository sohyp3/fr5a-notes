import type {
	ConflictFile,
	GitChange,
	GitOpResponse,
	GitStash,
	HttpRequest,
	HttpResponse,
	NoteMeta,
	ResolveChoice,
	StateKey,
	SyncRepo,
	SyncResponse,
	TagNode
} from '../../../../shared/types';

/**
 * Everything the renderer may ask of the host. The UI talks to this interface
 * only (via `platform` from `lib/platform`), never to `window.api` directly, so
 * a non-Electron host can supply its own implementation.
 */
export interface PlatformApi {
	/** Host OS, as `process.platform` (e.g. 'linux', 'darwin'). */
	readonly platform: string;
	/** Show the conflict resolver inside the main window (no second window on this host). */
	readonly conflictsInline?: boolean;

	getWorkspace(): Promise<string | null>;
	pickWorkspace(): Promise<string | null>;

	listNotes(): Promise<NoteMeta[]>;
	listTags(): Promise<TagNode[]>;

	readNote(id: string): Promise<string>;
	writeNote(id: string, content: string): Promise<void>;
	createNote(title?: string, folder?: string, content?: string): Promise<NoteMeta>;
	deleteNote(id: string): Promise<void>;
	/**
	 * Move / rename a note to workspace path `to` (its folder is created; the
	 * extension is kept when `to` has none). A taken name gets a numeric
	 * suffix. Returns the note's final id.
	 */
	moveNote(id: string, to: string): Promise<string>;
	/**
	 * Move / rename a folder and everything in it. Refused when `to` exists,
	 * lies inside the folder, or the folder holds a nested git repo.
	 */
	moveFolder(path: string, to: string): Promise<string>;

	listFolders(): Promise<string[]>;
	createFolder(name: string, parent?: string): Promise<string>;

	listTrash(): Promise<NoteMeta[]>;
	restoreNote(id: string): Promise<string>;
	permanentDelete(id: string): Promise<void>;

	/** Persistent UI state: last open file, sidebar, settings, theme. */
	getState<T = unknown>(key: StateKey): Promise<T | null>;
	setState(key: StateKey, value: unknown): Promise<void>;

	/** Frameless titlebar controls; absent on hosts without window chrome (Android). */
	minimize?(): Promise<void>;
	maximize?(): Promise<void>;
	close?(): Promise<void>;

	/** Git sync. Errors come back as `{ ok: false, error }`. */
	syncPull(): Promise<SyncResponse>;
	syncPush(): Promise<SyncResponse>;
	syncResolve(choices: ResolveChoice[]): Promise<SyncResponse>;
	syncAbort(): Promise<SyncResponse>;
	/** Conflicted files of the merge awaiting resolution (conflict window). */
	syncConflicts(): Promise<ConflictFile[]>;

	/** The workspace's repos: root + nested folders with their own remotes. */
	syncRepos?(): Promise<SyncRepo[]>;
	/**
	 * Add a nested repo: clone `url` into workspace folder `path`, or turn an
	 * existing folder into its own repo pointing at `url`. Android keeps a
	 * per-repo token; desktop uses system git credentials. The parent repo's
	 * `.gitignore` gets the folder so its notes never reach the root remote.
	 */
	syncAddRepo?(path: string, url: string, token: string): Promise<SyncResponse>;
	/** Android: stop syncing a nested repo (its files stay on disk). */
	syncRemoveRepo?(path: string): Promise<void>;
	/**
	 * Notes changed since the last commit (root + nested repos), with the
	 * committed text for diffing. Null when the workspace isn't under git.
	 */
	gitChanges?(): Promise<GitChange[] | null>;
	/** Stash these changed notes (workspace paths; one stash per repo) and revert them. */
	gitStash?(paths: string[], message: string): Promise<GitOpResponse>;
	/** Stashes of every repo, newest first. */
	gitStashes?(): Promise<GitStash[]>;
	/** Bring a stash back; `drop` removes it once applied cleanly. */
	gitStashApply?(repo: string, id: string, drop: boolean): Promise<GitOpResponse>;
	gitStashDrop?(repo: string, id: string): Promise<GitOpResponse>;
	/** Revert notes to the last commit; notes it doesn't have go to the trash. */
	gitRevert?(paths: string[]): Promise<GitOpResponse>;

	/**
	 * Hosts that own the working copy (Android): first-run connect/clone to an
	 * HTTPS remote with a GitHub token (kept in secure storage), then pull.
	 */
	syncSetup?(url: string, token: string): Promise<SyncResponse>;
	syncStatus?(): Promise<{ remote: string | null; hasToken: boolean }>;
	syncForgetToken?(): Promise<void>;

	/** AI harness: outbound HTTP (http/https only). Non-2xx comes back as data, not a throw. */
	httpFetch(req: HttpRequest): Promise<HttpResponse>;
	/**
	 * Streamed request: body text arrives on `onChunk`. Hosts without streaming
	 * (Android) omit this; callers fall back to `httpFetch` and parse the whole body.
	 */
	httpStream?(id: string, req: HttpRequest, onChunk: (text: string) => void): Promise<HttpResponse>;
	httpAbort?(id: string): Promise<void>;

	/** Secrets (API keys): OS keyring on desktop, Keystore on Android. */
	getSecret(name: string): Promise<string | null>;
	setSecret(name: string, value: string | null): Promise<void>;

	/** Files under the workspace's hidden `.fr5a/` folder (paths relative to it). */
	readMeta(rel: string): Promise<string | null>;
	writeMeta(rel: string, content: string): Promise<void>;
	/** Entries of a `.fr5a/` sub-directory: files newest first, then folders as `name/`. */
	listMeta(rel: string): Promise<string[]>;
	deleteMeta(rel: string): Promise<void>;

	/**
	 * Hardware back button (Android). `cb` returns true when it handled the
	 * press; otherwise the host falls back to its default (exit the app).
	 */
	onBackButton?(cb: () => boolean): () => void;

	/** Event subscriptions; each returns an unsubscribe fn. */
	onSyncConflict(cb: (files: ConflictFile[]) => void): () => void;
	onSyncDone(cb: () => void): () => void;
	onNotesChanged(cb: () => void): () => void;
}
