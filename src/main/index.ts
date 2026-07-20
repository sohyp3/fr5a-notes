import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { NoteIndex } from './db';
import { FileService } from './fileService';
import { buildTagTree } from './tags';
import { Channels } from '../shared/types';
import type { NoteMeta } from '../shared/types';
// electron-vite copies the file into the build output and rewrites this to the
// runtime path (works in both dev and the packaged app).
import icon from '../../resources/icon.png?asset';

// `__dirname` is provided by electron-vite's ESM shim at runtime.

let mainWindow: BrowserWindow | null = null;
let fileService: FileService | null = null;
let index: NoteIndex | null = null;

// --- persisted config (just the last workspace path) ----------------------

interface Config {
	workspace?: string;
}

const configPath = () => path.join(app.getPath('userData'), 'fr5a-config.json');

async function loadConfig(): Promise<Config> {
	try {
		return JSON.parse(await fs.readFile(configPath(), 'utf8'));
	} catch {
		return {};
	}
}

async function saveConfig(config: Config): Promise<void> {
	await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8');
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
	await saveConfig({ workspace: root });
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

	ipcMain.handle(Channels.noteCreate, (_e, title?: string, folder?: string) =>
		fileService?.create(title, folder)
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
	registerIpc();
	createWindow();

	// Re-open the last workspace if it still exists.
	const config = await loadConfig();
	if (config.workspace) {
		try {
			await fs.access(config.workspace);
			await openWorkspace(config.workspace);
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
