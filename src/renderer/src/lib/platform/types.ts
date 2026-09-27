import type {
	ConflictFile,
	NoteMeta,
	ResolveChoice,
	StateKey,
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

	/**
	 * Hosts that own the working copy (Android): first-run connect/clone to an
	 * HTTPS remote with a GitHub token (kept in secure storage), then pull.
	 */
	syncSetup?(url: string, token: string): Promise<SyncResponse>;
	syncStatus?(): Promise<{ remote: string | null; hasToken: boolean }>;
	syncForgetToken?(): Promise<void>;

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
