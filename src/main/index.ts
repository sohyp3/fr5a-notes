import { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import Store from 'electron-store';
import { NoteIndex } from './db';
import { FileService } from './fileService';
import { buildTagTree } from './tags';
import { registerSyncHandlers } from './syncIpc';
import { createHttp } from './http';
import { createSecrets } from './secrets';
import { deleteMeta, listMeta, readMeta, writeMeta } from './metaFiles';
import { workspaceChanges } from './gitChanges';
import { findNestedRepos } from './repos';
import { Channels } from '../shared/types';
import type { HttpRequest, NoteMeta, StateKey } from '../shared/types';
// electron-vite copies the file into the build output and rewrites this to the
// runtime path (works in both dev and the packaged app).
import icon from '../../resources/icon.png?asset';

// `__dirname` is provided by electron-vite's ESM shim at runtime.

let mainWindow: BrowserWindow | null = null;
let conflictWindow: BrowserWindow | null = null;
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
	/** AI harness: provider profiles, search provider, privacy rules (no keys). */
	ai?: unknown;
	/** safeStorage-encrypted secrets (API keys), base64. */
	secrets?: Record<string, string>;
}

const store = new Store<StoreSchema>({ name: 'fr5a' });

/** Renderer-writable keys — anything else on the wire is rejected. */
const RENDERER_KEYS = new Set<StateKey>(['lastOpenFile', 'sidebar', 'settings', 'theme', 'ai']);

const secrets = createSecrets(store);
// net.fetch goes through Chromium's stack, so system proxy / VPN settings apply.
const http = createHttp((url, init) => net.fetch(url, init));

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
		// macOS keeps its native traffic lights with `hidden`; centre them in the
		// 46px titlebar. The renderer hides its custom controls on darwin.
		trafficLightPosition: { x: 16, y: 17 },
		backgroundColor: '#faf9f7',
		webPreferences: {
			preload: path.join(__dirname, '../preload/index.js'),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	mainWindow.on('ready-to-show', () => mainWindow?.show());

	// Native right-click menu (Electron shows none by default): spelling
	// suggestions + clipboard actions. Renderer menus that preventDefault
	// (e.g. the note-card menu) suppress this event.
	mainWindow.webContents.on('context-menu', (_e, params) => {
		const wc = mainWindow?.webContents;
		if (!wc) return;
		const items: MenuItemConstructorOptions[] = [];
		if (params.misspelledWord) {
			for (const word of params.dictionarySuggestions) {
				items.push({ label: word, click: () => wc.replaceMisspelling(word) });
			}
			if (!params.dictionarySuggestions.length) {
				items.push({ label: 'No suggestions', enabled: false });
			}
			items.push(
				{
					label: 'Add to Dictionary',
					click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord)
				},
				{ type: 'separator' }
			);
		}
		const f = params.editFlags;
		if (params.isEditable) {
			items.push(
				{ role: 'cut', enabled: f.canCut },
				{ role: 'copy', enabled: f.canCopy },
				{ role: 'paste', enabled: f.canPaste },
				{ type: 'separator' },
				{ role: 'selectAll', enabled: f.canSelectAll }
			);
		} else if (params.selectionText.trim()) {
			items.push({ role: 'copy', enabled: f.canCopy });
		}
		if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow! });
	});

	// Open external links in the OS browser, never in-app.
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('http')) shell.openExternal(url);
		return { action: 'deny' };
	});

	loadPage(mainWindow, 'index.html');
}

/** Load a renderer page: the dev server in development, the built file otherwise. */
function loadPage(win: BrowserWindow, page: string): void {
	// electron-vite injects the dev server URL in development.
	const devUrl = process.env['ELECTRON_RENDERER_URL'];
	if (devUrl) {
		win.loadURL(page === 'index.html' ? devUrl : `${devUrl}/${page}`);
	} else {
		win.loadFile(path.join(__dirname, '../renderer', page));
	}
}

// --- conflict window -------------------------------------------------------

/**
 * Modal child window listing the files a pull left conflicted. It pulls the
 * list itself over `sync:conflicts`; closing it without applying aborts the
 * merge (see `closed`).
 */
function openConflictWindow(): void {
	if (conflictWindow) {
		conflictWindow.webContents.reload();
		conflictWindow.focus();
		return;
	}
	conflictWindow = new BrowserWindow({
		parent: mainWindow ?? undefined,
		modal: true,
		width: 960,
		height: 640,
		minWidth: 600,
		minHeight: 400,
		icon,
		title: 'Resolve sync conflicts',
		show: false,
		autoHideMenuBar: true,
		backgroundColor: '#faf9f7',
		webPreferences: {
			preload: path.join(__dirname, '../preload/index.js'),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	conflictWindow.on('ready-to-show', () => conflictWindow?.show());
	conflictWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	conflictWindow.on('closed', () => {
		conflictWindow = null;
		// Closed via the window frame: treat as Cancel so the repo isn't left mid-merge.
		void syncHandlers?.abortPending();
	});
	loadPage(conflictWindow, 'conflict.html');
}

function closeConflictWindow(): void {
	const win = conflictWindow;
	conflictWindow = null;
	win?.close();
}

let syncHandlers: ReturnType<typeof registerSyncHandlers> | null = null;

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
	ipcMain.handle(Channels.noteMove, (_e, id: string, to: string) => {
		if (!fileService) throw new Error('No workspace open');
		return fileService.move(id, to);
	});
	ipcMain.handle(Channels.folderMove, (_e, dir: string, to: string) => {
		if (!fileService) throw new Error('No workspace open');
		return fileService.moveFolder(dir, to);
	});
	ipcMain.handle(Channels.folderDelete, (_e, dir: string) => {
		if (!fileService) throw new Error('No workspace open');
		return fileService.deleteFolder(dir);
	});

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

	// AI harness: outbound HTTP (the renderer's CSP blocks fetch), secrets, `.fr5a/` files.
	ipcMain.handle(Channels.httpFetch, (_e, req: HttpRequest) => http.fetch(req));
	ipcMain.handle(Channels.httpStream, (e, id: string, req: HttpRequest) =>
		http.stream(id, req, (text) => {
			if (!e.sender.isDestroyed()) e.sender.send(Channels.httpChunk, id, text);
		})
	);
	ipcMain.handle(Channels.httpAbort, (_e, id: string) => http.abort(id));
	ipcMain.handle(Channels.secretGet, (_e, name: string) => secrets.get(name));
	ipcMain.handle(Channels.secretSet, (_e, name: string, value: string | null) =>
		secrets.set(name, value)
	);
	const root = () => {
		if (!fileService) throw new Error('No workspace open');
		return fileService.root;
	};
	ipcMain.handle(Channels.metaRead, (_e, rel: string) => readMeta(root(), rel));
	ipcMain.handle(Channels.metaWrite, (_e, rel: string, content: string) =>
		writeMeta(root(), rel, content)
	);
	ipcMain.handle(Channels.metaList, (_e, rel: string) => listMeta(root(), rel));
	ipcMain.handle(Channels.metaDelete, (_e, rel: string) => deleteMeta(root(), rel));
	// Read-only git status of the notes (root + nested repos), for the Changes view.
	ipcMain.handle(Channels.gitChanges, async () => {
		const r = fileService?.root;
		return r ? workspaceChanges(r, await findNestedRepos(r)) : null;
	});

	// Git sync. The renderer never runs git itself; results/errors come back as data.
	syncHandlers = registerSyncHandlers(ipcMain, {
		getRoot: () => fileService?.root ?? null,
		emit: (channel, ...args) => mainWindow?.webContents.send(channel, ...args),
		openConflicts: () => openConflictWindow(),
		closeConflicts: closeConflictWindow,
		trash: async (id) => {
			await fileService?.delete(id);
		}
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
	// Ties the window to its taskbar entry on Windows. On Linux the equivalent
	// is the .desktop file's StartupWMClass, which must equal the package.json
	// "name" ("fr5a-notes") — that's what Electron reports as WM_CLASS/app_id.
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
