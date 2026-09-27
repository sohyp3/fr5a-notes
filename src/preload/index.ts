import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/types';
import type {
	ConflictFile,
	NoteMeta,
	ResolveChoice,
	StateKey,
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
