import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import Store from 'electron-store';
import { NoteIndex } from './db';
import { FileService } from './fileService';
import { buildTagTree } from './tags';
import { Channels } from '../shared/types';
import type { NoteMeta, StateKey } from '../shared/types';
// electron-vite copies the file into the build output and rewrites this to the
// runtime path (works in both dev and the packaged app).
import icon from '../../resources/icon.png?asset';

// `__dirname` is provided by electron-vite's ESM shim at runtime.

let mainWindow: BrowserWindow | null = null;
let fileService: FileService | null = null;
let index: NoteIndex | null = null;

// --- persisted state (electron-store) --------------------------------------

interface StoreSchema {
	/** Root directory of the last-opened workspace. */
	workspace?: string;
	/** Note id (workspace-relative) re-opened on launch. */
	lastOpenFile?: string;
	/** Sidebar section/expansion state (renderer-owned shape). */
	sidebar?: unknown;
	/** Renderer settings: theme colors, fonts, vim toggle, ghost syntax. */
	settings?: unknown;
	theme?: string;
}

const store = new Store<StoreSchema>({ name: 'fr5a' });

/** Renderer-writable keys — anything else on the wire is rejected. */
const RENDERER_KEYS = new Set<StateKey>(['lastOpenFile', 'sidebar', 'settings', 'theme']);

/** One-time migration from the old hand-rolled fr5a-config.json. */
async function migrateLegacyConfig(): Promise<void> {
	if (store.get('workspace')) return;
	try {
		const legacy = path.join(app.getPath('userData'), 'fr5a-config.json');
		const config = JSON.parse(await fs.readFile(legacy, 'utf8')) as { workspace?: string };
		if (config.workspace) store.set('workspace', config.workspace);
	} catch {
		// No legacy config — fresh install.
	}
}

// --- workspace lifecycle ---------------------------------------------------

function pushNotesChanged(): void {
	mainWindow?.webContents.send(Channels.notesChanged);
}

async function openWorkspace(root: string): Promise<void> {
	await fileService?.stop();
	index?.close();

	index = new NoteIndex(path.join(app.getPath('userData'), 'fr5a-index.db'));
	fileService = new FileService(root, index, pushNotesChanged);
	await fileService.start();
	store.set('workspace', root);
}

// --- window ----------------------------------------------------------------

function createWindow(): void {
	mainWindow = new BrowserWindow({
		width: 1180,
		height: 760,
		minWidth: 720,
		minHeight: 480,
		icon,
		show: false,
		frame: false,
		titleBarStyle: 'hidden',
		backgroundColor: '#faf9f7',
		webPreferences: {
			preload: path.join(__dirname, '../preload/index.js'),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	mainWindow.on('ready-to-show', () => mainWindow?.show());

	// Open external links in the OS browser, never in-app.
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('http')) shell.openExternal(url);
		return { action: 'deny' };
	});

	// electron-vite injects the dev server URL in development.
	const devUrl = process.env['ELECTRON_RENDERER_URL'];
	if (devUrl) {
		mainWindow.loadURL(devUrl);
	} else {
		mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
	}
}

// --- IPC -------------------------------------------------------------------

function registerIpc(): void {
	ipcMain.handle(Channels.workspaceGet, () => fileService?.root ?? null);

	ipcMain.handle(Channels.workspacePick, async () => {
		if (!mainWindow) return null;
		const result = await dialog.showOpenDialog(mainWindow, {
			title: 'Choose your notes folder',
			properties: ['openDirectory', 'createDirectory']
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		await openWorkspace(result.filePaths[0]);
		return result.filePaths[0];
	});

	ipcMain.handle(Channels.notesList, (): NoteMeta[] => index?.all() ?? []);

	ipcMain.handle(Channels.tagsList, () => buildTagTree(index?.tagPairs() ?? []));

	ipcMain.handle(Channels.noteRead, (_e, id: string) => fileService?.read(id) ?? '');

	ipcMain.handle(Channels.noteWrite, (_e, id: string, content: string) =>
		fileService?.write(id, content)
	);

	ipcMain.handle(Channels.noteCreate, (_e, title?: string, folder?: string, content?: string) =>
		fileService?.create(title, folder, content)
	);

	ipcMain.handle(Channels.noteDelete, (_e, id: string) => fileService?.delete(id));

	ipcMain.handle(
		Channels.foldersList,
		(): Promise<string[]> => fileService?.listFolders() ?? Promise.resolve([])
	);
	ipcMain.handle(Channels.folderCreate, (_e, name: string, parent?: string) =>
		fileService?.createFolder(name, parent)
	);

	// Trash.
	ipcMain.handle(
		Channels.trashList,
		(): Promise<NoteMeta[]> => fileService?.listTrash() ?? Promise.resolve([])
	);
	ipcMain.handle(Channels.noteRestore, (_e, id: string) => fileService?.restore(id));
	ipcMain.handle(Channels.trashDelete, (_e, id: string) => fileService?.permanentDelete(id));

	// Persistent UI state (last open file, sidebar layout, settings).
	ipcMain.handle(Channels.stateGet, (_e, key: StateKey) =>
		RENDERER_KEYS.has(key) ? (store.get(key) ?? null) : null
	);
	ipcMain.handle(Channels.stateSet, (_e, key: StateKey, value: unknown) => {
		if (!RENDERER_KEYS.has(key)) return;
		if (value === null || value === undefined) store.delete(key);
		else store.set(key, value);
	});

	// Frameless window controls.
	ipcMain.handle(Channels.windowMinimize, () => mainWindow?.minimize());
	ipcMain.handle(Channels.windowMaximize, () => {
		if (!mainWindow) return;
		if (mainWindow.isMaximized()) mainWindow.unmaximize();
		else mainWindow.maximize();
	});
	ipcMain.handle(Channels.windowClose, () => mainWindow?.close());
}

// --- bootstrap -------------------------------------------------------------

app.whenReady().then(async () => {
	// Ties the window to its taskbar/dock entry (and, with the .desktop file's
	// StartupWMClass, prevents the duplicate-icon issue on Linux docks).
	app.setAppUserModelId('com.fr5a.app');

	registerIpc();
	createWindow();

	// Re-open the last workspace if it still exists.
	await migrateLegacyConfig();
	const workspace = store.get('workspace');
	if (workspace) {
		try {
			await fs.access(workspace);
			await openWorkspace(workspace);
			pushNotesChanged();
		} catch (err) {
			// Folder moved/deleted, or the index failed to open — log and fall
			// back to the empty state rather than failing silently.
			console.error('[fr5a] failed to open workspace:', err);
		}
	}

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', async () => {
	await fileService?.stop();
	index?.close();
	if (process.platform !== 'darwin') app.quit();
});
