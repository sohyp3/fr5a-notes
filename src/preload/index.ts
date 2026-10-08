import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/types';
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
} from '../shared/types';

/**
 * The single, typed bridge the renderer is allowed to touch. Everything the UI
 * can do to the filesystem funnels through here — no `nodeIntegration`, no raw
 * `ipcRenderer` in the window.
 */
const api = {
	platform: process.platform,

	getWorkspace: (): Promise<string | null> => ipcRenderer.invoke(Channels.workspaceGet),
	pickWorkspace: (): Promise<string | null> => ipcRenderer.invoke(Channels.workspacePick),

	listNotes: (): Promise<NoteMeta[]> => ipcRenderer.invoke(Channels.notesList),
	listTags: (): Promise<TagNode[]> => ipcRenderer.invoke(Channels.tagsList),

	readNote: (id: string): Promise<string> => ipcRenderer.invoke(Channels.noteRead, id),
	writeNote: (id: string, content: string): Promise<void> =>
		ipcRenderer.invoke(Channels.noteWrite, id, content),
	createNote: (title?: string, folder?: string, content?: string): Promise<NoteMeta> =>
		ipcRenderer.invoke(Channels.noteCreate, title, folder, content),
	deleteNote: (id: string): Promise<void> => ipcRenderer.invoke(Channels.noteDelete, id),
	moveNote: (id: string, to: string): Promise<string> =>
		ipcRenderer.invoke(Channels.noteMove, id, to),
	moveFolder: (path: string, to: string): Promise<string> =>
		ipcRenderer.invoke(Channels.folderMove, path, to),
	deleteFolder: (path: string): Promise<void> => ipcRenderer.invoke(Channels.folderDelete, path),

	// Folders: list every sub-directory (incl. empty), create a new one.
	listFolders: (): Promise<string[]> => ipcRenderer.invoke(Channels.foldersList),
	createFolder: (name: string, parent?: string): Promise<string> =>
		ipcRenderer.invoke(Channels.folderCreate, name, parent),

	// Trash: soft-delete lands notes in `.fr5a_trash`; restore / permanent delete.
	listTrash: (): Promise<NoteMeta[]> => ipcRenderer.invoke(Channels.trashList),
	restoreNote: (id: string): Promise<string> => ipcRenderer.invoke(Channels.noteRestore, id),
	permanentDelete: (id: string): Promise<void> => ipcRenderer.invoke(Channels.trashDelete, id),

	// Persistent UI state (electron-store): last open file, sidebar, settings.
	getState: <T = unknown>(key: StateKey): Promise<T | null> =>
		ipcRenderer.invoke(Channels.stateGet, key),
	setState: (key: StateKey, value: unknown): Promise<void> =>
		ipcRenderer.invoke(Channels.stateSet, key, value),

	// Frameless titlebar controls.
	minimize: (): Promise<void> => ipcRenderer.invoke(Channels.windowMinimize),
	maximize: (): Promise<void> => ipcRenderer.invoke(Channels.windowMaximize),
	close: (): Promise<void> => ipcRenderer.invoke(Channels.windowClose),

	// Git sync. All git work happens in main; errors come back as `{ ok: false, error }`.
	syncPull: (): Promise<SyncResponse> => ipcRenderer.invoke(Channels.syncPull),
	syncPush: (): Promise<SyncResponse> => ipcRenderer.invoke(Channels.syncPush),
	syncResolve: (choices: ResolveChoice[]): Promise<SyncResponse> =>
		ipcRenderer.invoke(Channels.syncResolve, choices),
	syncAbort: (): Promise<SyncResponse> => ipcRenderer.invoke(Channels.syncAbort),
	/** Conflicted files of the merge awaiting resolution (conflict window). */
	syncConflicts: (): Promise<ConflictFile[]> => ipcRenderer.invoke(Channels.syncConflicts),
	/** Root + nested repos and their remotes. */
	syncRepos: (): Promise<SyncRepo[]> => ipcRenderer.invoke(Channels.syncRepos),
	/**
	 * Give workspace folder `path` its own repo syncing to `url` (system git and
	 * its credentials; the token is unused on desktop).
	 */
	syncAddRepo: (path: string, url: string): Promise<SyncResponse> =>
		ipcRenderer.invoke(Channels.syncAddRepo, path, url),
	/** Notes changed since the last commit; null when the folder isn't under git. */
	gitChanges: (): Promise<GitChange[] | null> => ipcRenderer.invoke(Channels.gitChanges),
	gitStash: (paths: string[], message: string): Promise<GitOpResponse> =>
		ipcRenderer.invoke(Channels.gitStash, paths, message),
	gitStashes: (): Promise<GitStash[]> => ipcRenderer.invoke(Channels.gitStashes),
	gitStashApply: (repo: string, id: string, drop: boolean): Promise<GitOpResponse> =>
		ipcRenderer.invoke(Channels.gitStashApply, repo, id, drop),
	gitStashDrop: (repo: string, id: string): Promise<GitOpResponse> =>
		ipcRenderer.invoke(Channels.gitStashDrop, repo, id),
	gitRevert: (paths: string[]): Promise<GitOpResponse> =>
		ipcRenderer.invoke(Channels.gitRevert, paths),

	// AI harness. HTTP runs in main (the renderer's CSP blocks fetch).
	httpFetch: (req: HttpRequest): Promise<HttpResponse> =>
		ipcRenderer.invoke(Channels.httpFetch, req),
	/** Stream a response body; chunks arrive on `onChunk` until the promise settles. */
	httpStream: async (
		id: string,
		req: HttpRequest,
		onChunk: (text: string) => void
	): Promise<HttpResponse> => {
		const listener = (_e: unknown, chunkId: string, text: string) => {
			if (chunkId === id) onChunk(text);
		};
		ipcRenderer.on(Channels.httpChunk, listener);
		try {
			return await ipcRenderer.invoke(Channels.httpStream, id, req);
		} finally {
			ipcRenderer.off(Channels.httpChunk, listener);
		}
	},
	httpAbort: (id: string): Promise<void> => ipcRenderer.invoke(Channels.httpAbort, id),
	getSecret: (name: string): Promise<string | null> => ipcRenderer.invoke(Channels.secretGet, name),
	setSecret: (name: string, value: string | null): Promise<void> =>
		ipcRenderer.invoke(Channels.secretSet, name, value),
	readMeta: (rel: string): Promise<string | null> => ipcRenderer.invoke(Channels.metaRead, rel),
	writeMeta: (rel: string, content: string): Promise<void> =>
		ipcRenderer.invoke(Channels.metaWrite, rel, content),
	/** Files newest first, then folders as `name/`. */
	listMeta: (rel: string): Promise<string[]> => ipcRenderer.invoke(Channels.metaList, rel),
	deleteMeta: (rel: string): Promise<void> => ipcRenderer.invoke(Channels.metaDelete, rel),

	/** Workspace images load over the `fr5a:` protocol main registers (images only). */
	assetUrl: (path: string): string =>
		`fr5a://workspace/${path.split('/').map(encodeURIComponent).join('/')}`,
	saveAsset: (path: string, data: Uint8Array): Promise<string> =>
		ipcRenderer.invoke(Channels.assetSave, path, data),

	/** A pull stopped on conflicts; returns an unsubscribe fn. */
	onSyncConflict: (cb: (files: ConflictFile[]) => void): (() => void) => {
		const listener = (_e: unknown, files: ConflictFile[]) => cb(files);
		ipcRenderer.on(Channels.syncConflict, listener);
		return () => ipcRenderer.off(Channels.syncConflict, listener);
	},
	/** A sync (or conflict resolution) finished and files on disk may have changed. */
	onSyncDone: (cb: () => void): (() => void) => {
		const listener = () => cb();
		ipcRenderer.on(Channels.syncDone, listener);
		return () => ipcRenderer.off(Channels.syncDone, listener);
	},

	/** Subscribe to index changes; returns an unsubscribe fn. */
	onNotesChanged: (cb: () => void): (() => void) => {
		const listener = () => cb();
		ipcRenderer.on(Channels.notesChanged, listener);
		return () => ipcRenderer.off(Channels.notesChanged, listener);
	}
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
