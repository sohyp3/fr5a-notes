import type { NoteMeta, TagNode, SidebarState } from '../../../../shared/types';
import { uiStack, editorStack } from '../fonts';
import { accentById, applyPalette, DEFAULT_ACCENT } from '../accents';
import { setPinned, setLocked, titleFromContent } from '../editor/markdown';

const SAVE_DEBOUNCE = 500;
const THEME_KEY = 'fr5a-theme';
const SETTINGS_KEY = 'fr5a-settings';
/** Pending-save id for a draft note that has no file yet. */
const DRAFT_ID = '\0draft';

const DEFAULT_SIDEBAR: SidebarState = {
	foldersOpen: true,
	tagsOpen: true,
	folderExpanded: {},
	tagExpanded: {}
};

export type View = 'editor' | 'settings';

export interface Settings {
	/** Font option ids (see fonts.ts). */
	uiFont: string;
	enFont: string;
	arFont: string;
	/** Enable Vim motions in the editor. */
	vim: boolean;
	/** "Ghost Syntax": collapse Markdown symbols until hover/caret. */
	ghost: boolean;
	/** Accent color id (see accents.ts). */
	accent: string;
}

const DEFAULT_SETTINGS: Settings = {
	uiFont: 'inter',
	enFont: 'inter',
	arFont: 'naskh',
	vim: false,
	ghost: true,
	accent: DEFAULT_ACCENT
};

/**
 * Central application state. A single instance is shared across components via
 * `getAppState()`. Uses Svelte 5 runes, so plain field reads/writes are
 * reactive in any component that touches them.
 */
class AppState {
	workspace = $state<string | null>(null);
	notes = $state<NoteMeta[]>([]);
	tags = $state<TagNode[]>([]);
	/** Every workspace sub-directory (incl. empty ones), workspace-relative. */
	folders = $state<string[]>([]);

	/** Right-click note menu: screen position + target note, or null when closed. */
	contextMenu = $state<{ x: number; y: number; note: NoteMeta } | null>(null);

	activeId = $state<string | null>(null);
	/** Body of the active note as last loaded from disk. */
	activeContent = $state('');
	/**
	 * A new note not yet on disk. It materialises on the first save: the first
	 * H1 typed becomes the filename (no more Untitled.md), and a draft left
	 * completely blank never touches the disk at all.
	 */
	draft = $state(false);
	/** Folder (workspace-relative, '' = root) a materialising draft lands in. */
	private draftFolder = '';
	/**
	 * Keys the editor component. Bumped when a *different* buffer should mount
	 * (open/create) — deliberately NOT when a draft materialises into a file, so
	 * typing isn't interrupted by a remount.
	 */
	editorSession = $state(0);

	/** Flipped once init() has restored persisted state — gates the UI fade-in. */
	booted = $state(false);

	/** Sidebar layout: section visibility + folder/tag expansion (persisted). */
	sidebar = $state<SidebarState>({ ...DEFAULT_SIDEBAR });

	search = $state('');
	selectedTag = $state<string | null>(null);
	/** Workspace-relative folder path used to filter the note list ('' = root). */
	selectedFolder = $state<string | null>(null);
	/** When true the note list shows the `.fr5a_trash` contents instead. */
	trashOpen = $state(false);
	/** Soft-deleted notes (ids carry the `.fr5a_trash/` prefix). */
	trashNotes = $state<NoteMeta[]>([]);
	sidebarOpen = $state(true);
	/** Global keyboard-shortcut cheat sheet overlay (toggle with Mod+/). */
	cheatSheetOpen = $state(false);
	theme = $state<'light' | 'dark'>('light');

	/** Bumped to force the editor to recreate (e.g. after an external rewrite). */
	editorReloadToken = $state(0);

	/** Which top-level view is showing in the main window. */
	view = $state<View>('editor');
	/** Zen mode hides the sidebar + note list and centres the editor. */
	zen = $state(false);

	settings = $state<Settings>({ ...DEFAULT_SETTINGS });

	/** Reflects a pending debounced write, for a subtle "saving…" hint. */
	saving = $state(false);

	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private pending: { id: string; content: string } | null = null;

	/** Notes filtered by the selected folder, tag and search box. */
	filtered = $derived.by(() => {
		const q = this.search.trim().toLowerCase();
		// Trash is its own list — folder/tag filters don't apply, only search.
		if (this.trashOpen) {
			return this.trashNotes.filter(
				(n) => !q || n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q)
			);
		}
		return this.notes.filter((n) => {
			if (this.selectedFolder !== null) {
				const folder = this.selectedFolder;
				const dir = n.id.includes('/') ? n.id.slice(0, n.id.lastIndexOf('/')) : '';
				// A note belongs to the folder if it sits in it or any descendant.
				const inFolder = folder === '' ? true : dir === folder || dir.startsWith(`${folder}/`);
				if (!inFolder) return false;
			}
			if (this.selectedTag) {
				const t = this.selectedTag;
				const match = n.tags.some((tag) => tag === t || tag.startsWith(`${t}/`));
				if (!match) return false;
			}
			if (q) {
				return n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q);
			}
			return true;
		});
	});

	async init(): Promise<void> {
		// Theme: electron-store, else the old localStorage copy, else the OS.
		const storedTheme = ((await window.api.getState<string>('theme')) ??
			localStorage.getItem(THEME_KEY)) as 'light' | 'dark' | null;
		this.theme =
			storedTheme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
		this.applyTheme();

		// Settings: electron-store first, localStorage as a one-time migration.
		try {
			const stored =
				(await window.api.getState<Partial<Settings>>('settings')) ??
				JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
			if (stored) this.settings = { ...DEFAULT_SETTINGS, ...stored };
		} catch {
			/* ignore malformed settings */
		}
		this.applyFonts();
		this.applyGhost();
		this.applyAccent();

		// Sidebar layout (section visibility + expanded folders/tags).
		const sidebar = await window.api.getState<Partial<SidebarState>>('sidebar');
		if (sidebar) this.sidebar = { ...DEFAULT_SIDEBAR, ...sidebar };

		this.workspace = await window.api.getWorkspace();
		await this.refresh();

		// Re-open the note from the previous session, if it still exists.
		const last = await window.api.getState<string>('lastOpenFile');
		if (last && this.notes.some((n) => n.id === last)) {
			await this.openNote(last);
		}

		// Live updates from the filesystem watcher.
		window.api.onNotesChanged(() => this.refresh());
		this.booted = true;
	}

	async refresh(): Promise<void> {
		if (!this.workspace) {
			this.notes = [];
			this.tags = [];
			this.folders = [];
			return;
		}
		const [notes, tags, trash, folders] = await Promise.all([
			window.api.listNotes(),
			window.api.listTags(),
			window.api.listTrash(),
			window.api.listFolders()
		]);
		this.notes = notes;
		this.tags = tags;
		this.trashNotes = trash;
		this.folders = folders;
		// If the active note was deleted externally, clear the editor.
		if (this.activeId && !notes.some((n) => n.id === this.activeId)) {
			this.activeId = null;
			this.activeContent = '';
		}
	}

	async pickWorkspace(): Promise<void> {
		const path = await window.api.pickWorkspace();
		if (path) {
			this.workspace = path;
			this.activeId = null;
			this.activeContent = '';
			this.draft = false;
			this.selectedTag = null;
			void window.api.setState('lastOpenFile', null);
			await this.refresh();
		}
	}

	async openNote(id: string): Promise<void> {
		if (id === this.activeId) {
			this.view = 'editor';
			return;
		}
		await this.flush(); // persist any pending edits before switching
		this.draft = false; // a blank draft is simply discarded
		// Load the body BEFORE flipping activeId. The editor is keyed on
		// editorSession, so its content must already be in place when the new
		// instance mounts — otherwise it mounts with stale/empty text.
		const content = await window.api.readNote(id);
		this.view = 'editor';
		this.activeContent = content;
		this.activeId = id;
		this.editorSession++;
		void window.api.setState('lastOpenFile', id);
	}

	async createNote(): Promise<void> {
		await this.flush(); // persist the outgoing note (or materialise a draft)
		// New notes land in the folder currently in view ('' = workspace root).
		this.draftFolder = this.trashOpen ? '' : (this.selectedFolder ?? '');
		// No file yet: open an in-memory draft on an empty H1 line. The first
		// save derives the filename from the typed title.
		this.view = 'editor';
		this.draft = true;
		this.activeId = null;
		this.activeContent = '# ';
		this.editorSession++;
	}

	/**
	 * Create a folder (under the selected folder if one is active, else the root)
	 * and select it so the user drops straight into the new scope.
	 */
	async createFolder(name: string): Promise<void> {
		const parent = this.selectedFolder ?? '';
		const rel = await window.api.createFolder(name, parent);
		await this.refresh();
		if (rel) this.selectFolder(rel);
	}

	async deleteActive(): Promise<void> {
		if (this.activeId) await this.deleteNote(this.activeId);
	}

	async deleteNote(id: string): Promise<void> {
		// Locked notes are protected — the caller must unlock first.
		if (this.notes.find((n) => n.id === id)?.locked) return;
		if (id === this.activeId) {
			this.cancelPending();
			this.activeId = null;
			this.activeContent = '';
			void window.api.setState('lastOpenFile', null);
		}
		await window.api.deleteNote(id);
		await this.refresh();
	}

	// --- trash operations --------------------------------------------------

	/** Move a trashed note back to its original location. */
	async restoreNote(trashId: string): Promise<void> {
		if (trashId === this.activeId) {
			this.cancelPending();
			this.activeId = null;
			this.activeContent = '';
		}
		await window.api.restoreNote(trashId);
		await this.refresh();
	}

	/** Permanently delete a note from the trash — this cannot be undone. */
	async permanentDelete(trashId: string): Promise<void> {
		if (trashId === this.activeId) {
			this.cancelPending();
			this.activeId = null;
			this.activeContent = '';
		}
		await window.api.permanentDelete(trashId);
		await this.refresh();
	}

	// --- cheat sheet -------------------------------------------------------

	toggleCheatSheet(): void {
		this.cheatSheetOpen = !this.cheatSheetOpen;
	}

	// Folder / tag / trash are mutually-exclusive "scopes": picking one clears
	// the others so the note-list query always reflects a single active filter.
	// `filtered` is $derived, so every component re-queries the moment we flip
	// these — that's the "reactive selection" the UI needs.

	selectTag(path: string | null): void {
		this.view = 'editor';
		this.trashOpen = false;
		this.selectedFolder = null;
		this.selectedTag = this.selectedTag === path ? null : path;
	}

	selectFolder(path: string | null): void {
		this.view = 'editor';
		this.trashOpen = false;
		this.selectedTag = null;
		this.selectedFolder = this.selectedFolder === path ? null : path;
	}

	/** Open the Trash view (its own note list). */
	openTrash(): void {
		this.view = 'editor';
		this.selectedTag = null;
		this.selectedFolder = null;
		this.trashOpen = true;
	}

	/** "All Notes": clear every filter and show the whole tree. */
	showAllNotes(): void {
		this.view = 'editor';
		this.selectedTag = null;
		this.selectedFolder = null;
		this.trashOpen = false;
	}

	// --- sidebar layout (persisted via electron-store) ----------------------

	/** Collapse every folder and subfolder in the sidebar tree. */
	collapseFolders(): void {
		for (const path of this.folders) this.sidebar.folderExpanded[path] = false;
		this.persistSidebar();
	}

	/** Show/hide a whole sidebar section ("Folders" / "Tags"). */
	toggleSection(section: 'folders' | 'tags'): void {
		if (section === 'folders') this.sidebar.foldersOpen = !this.sidebar.foldersOpen;
		else this.sidebar.tagsOpen = !this.sidebar.tagsOpen;
		this.persistSidebar();
	}

	// Expansion maps hold explicit overrides; the default is "top level open".
	isFolderExpanded(path: string, depth: number): boolean {
		return this.sidebar.folderExpanded[path] ?? depth < 1;
	}

	toggleFolderExpanded(path: string, depth: number): void {
		this.sidebar.folderExpanded[path] = !this.isFolderExpanded(path, depth);
		this.persistSidebar();
	}

	isTagExpanded(path: string, depth: number): boolean {
		return this.sidebar.tagExpanded[path] ?? depth < 1;
	}

	toggleTagExpanded(path: string, depth: number): void {
		this.sidebar.tagExpanded[path] = !this.isTagExpanded(path, depth);
		this.persistSidebar();
	}

	private persistSidebar(): void {
		void window.api.setState('sidebar', $state.snapshot(this.sidebar));
	}

	// --- pinning -----------------------------------------------------------

	async setPinned(id: string, pinned: boolean): Promise<void> {
		// Persist any live edits first so we toggle against current content.
		if (id === this.activeId) await this.flush();
		const content = await window.api.readNote(id);
		const next = setPinned(content, pinned);
		if (next === content) return;
		await window.api.writeNote(id, next);
		if (id === this.activeId) {
			this.activeContent = next;
			// Recreate the editor so the (hidden) metadata line is part of its doc
			// and survives subsequent auto-saves.
			this.editorReloadToken++;
		}
		await this.refresh();
	}

	async togglePin(id: string): Promise<void> {
		const note = this.notes.find((n) => n.id === id);
		await this.setPinned(id, !note?.pinned);
	}

	// --- locking -----------------------------------------------------------

	/**
	 * Write the note's locked flag to its metadata. A locked note is read-only in
	 * the editor and can't be deleted; only unlocking is allowed. Mirrors
	 * `setPinned`: flush live edits, rewrite the file, recreate the editor.
	 */
	async setLocked(id: string, locked: boolean): Promise<void> {
		if (id === this.activeId) await this.flush();
		const content = await window.api.readNote(id);
		const next = setLocked(content, locked);
		if (next === content) return;
		await window.api.writeNote(id, next);
		if (id === this.activeId) {
			this.activeContent = next;
			// Recreate the editor so its editable state (and the hidden metadata
			// line) reflect the new lock.
			this.editorReloadToken++;
		}
		await this.refresh();
	}

	async toggleLock(id: string): Promise<void> {
		const note = this.notes.find((n) => n.id === id);
		await this.setLocked(id, !note?.locked);
	}

	// --- note context menu -------------------------------------------------

	openContextMenu(x: number, y: number, note: NoteMeta): void {
		this.contextMenu = { x, y, note };
	}

	closeContextMenu(): void {
		this.contextMenu = null;
	}

	// --- navigation / modes ------------------------------------------------

	setView(view: View): void {
		this.view = view;
	}

	toggleSettings(): void {
		this.view = this.view === 'settings' ? 'editor' : 'settings';
	}

	toggleZen(): void {
		this.zen = !this.zen;
	}

	// --- settings ----------------------------------------------------------

	updateSettings(patch: Partial<Settings>): void {
		this.settings = { ...this.settings, ...patch };
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
		void window.api.setState('settings', $state.snapshot(this.settings));
		this.applyFonts();
		this.applyGhost();
		this.applyAccent();
	}

	private applyAccent(): void {
		// Full theming: the accent drives --accent plus tinted window surfaces
		// (--bg-primary / --bg-secondary / --text-main), so the whole app follows.
		applyPalette(accentById(this.settings.accent), this.theme);
	}

	private applyFonts(): void {
		const root = document.documentElement;
		root.style.setProperty('--font-ui', uiStack(this.settings.uiFont));
		// One mixed-script stack drives the editor: English first (Latin), Arabic
		// next (fallback for Arabic glyphs) — applied in both LTR and RTL.
		root.style.setProperty(
			'--font-editor',
			editorStack(this.settings.enFont, this.settings.arFont)
		);
	}

	private applyGhost(): void {
		document.documentElement.setAttribute('data-ghost', this.settings.ghost ? 'on' : 'off');
	}

	// --- auto-save (debounced 500ms) --------------------------------------

	queueSave(content: string): void {
		if (!this.activeId && !this.draft) return;
		this.pending = { id: this.activeId ?? DRAFT_ID, content };
		this.saving = true;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE);
	}

	/** Write any pending edit to disk immediately. */
	async flush(): Promise<void> {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (!this.pending) return;
		const { id, content } = this.pending;
		this.pending = null;
		if (id === DRAFT_ID) {
			await this.materializeDraft(content);
			return;
		}
		// Keep the in-memory copy in sync so re-derived UI (and a later reopen)
		// reflect what we just wrote without a round-trip.
		if (id === this.activeId) this.activeContent = content;
		await window.api.writeNote(id, content);
		this.saving = false;
	}

	/**
	 * First save of a draft: derive the filename from the first H1 typed and
	 * create the file. The editor instance is left alone (its key is
	 * editorSession, not the id), so typing continues uninterrupted.
	 */
	private async materializeDraft(content: string): Promise<void> {
		if (!this.draft) {
			// The draft became a file while this save sat in the queue — write there.
			if (this.activeId) await window.api.writeNote(this.activeId, content);
			this.saving = false;
			return;
		}
		const title = titleFromContent(content);
		if (title === null) {
			// Still blank (just the empty H1 scaffold) — keep it off the disk.
			this.saving = false;
			return;
		}
		const meta = await window.api.createNote(title, this.draftFolder, content);
		this.draft = false;
		this.activeId = meta.id;
		this.activeContent = content;
		this.saving = false;
		void window.api.setState('lastOpenFile', meta.id);
		await this.refresh();
	}

	private cancelPending(): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		this.pending = null;
		this.saving = false;
	}

	// --- theme ------------------------------------------------------------

	toggleTheme(): void {
		this.setTheme(this.theme === 'light' ? 'dark' : 'light');
	}

	setTheme(theme: 'light' | 'dark'): void {
		this.theme = theme;
		localStorage.setItem(THEME_KEY, this.theme);
		void window.api.setState('theme', this.theme);
		this.applyTheme();
	}

	private applyTheme(): void {
		document.documentElement.setAttribute('data-theme', this.theme);
		// Accent hex differs per theme, so re-resolve it whenever the theme flips.
		this.applyAccent();
	}

	toggleSidebar(): void {
		this.sidebarOpen = !this.sidebarOpen;
	}
}

let instance: AppState | null = null;

export function getAppState(): AppState {
	return (instance ??= new AppState());
}

export type { AppState };
