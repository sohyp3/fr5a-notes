import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/types';
import type { NoteMeta, TagNode } from '../shared/types';

/**
 * The single, typed bridge the renderer is allowed to touch. Everything the UI
 * can do to the filesystem funnels through here — no `nodeIntegration`, no raw
 * `ipcRenderer` in the window.
 */
const api = {
	getWorkspace: (): Promise<string | null> => ipcRenderer.invoke(Channels.workspaceGet),
	pickWorkspace: (): Promise<string | null> => ipcRenderer.invoke(Channels.workspacePick),

	listNotes: (): Promise<NoteMeta[]> => ipcRenderer.invoke(Channels.notesList),
	listTags: (): Promise<TagNode[]> => ipcRenderer.invoke(Channels.tagsList),

	readNote: (id: string): Promise<string> => ipcRenderer.invoke(Channels.noteRead, id),
	writeNote: (id: string, content: string): Promise<void> =>
		ipcRenderer.invoke(Channels.noteWrite, id, content),
	createNote: (title?: string, folder?: string): Promise<NoteMeta> =>
		ipcRenderer.invoke(Channels.noteCreate, title, folder),
	deleteNote: (id: string): Promise<void> => ipcRenderer.invoke(Channels.noteDelete, id),

	// Folders: list every sub-directory (incl. empty), create a new one.
	listFolders: (): Promise<string[]> => ipcRenderer.invoke(Channels.foldersList),
	createFolder: (name: string, parent?: string): Promise<string> =>
		ipcRenderer.invoke(Channels.folderCreate, name, parent),

	// Trash: soft-delete lands notes in `.fr5a_trash`; restore / permanent delete.
	listTrash: (): Promise<NoteMeta[]> => ipcRenderer.invoke(Channels.trashList),
	restoreNote: (id: string): Promise<string> => ipcRenderer.invoke(Channels.noteRestore, id),
	permanentDelete: (id: string): Promise<void> => ipcRenderer.invoke(Channels.trashDelete, id),

	// Frameless titlebar controls.
	minimize: (): Promise<void> => ipcRenderer.invoke(Channels.windowMinimize),
	maximize: (): Promise<void> => ipcRenderer.invoke(Channels.windowMaximize),
	close: (): Promise<void> => ipcRenderer.invoke(Channels.windowClose),

	/** Subscribe to index changes; returns an unsubscribe fn. */
	onNotesChanged: (cb: () => void): (() => void) => {
		const listener = () => cb();
		ipcRenderer.on(Channels.notesChanged, listener);
		return () => ipcRenderer.off(Channels.notesChanged, listener);
	}
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
