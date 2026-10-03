import { platform } from '../platform';
import type {
	GitChange,
	GitOpResponse,
	GitStash,
	NoteMeta,
	TagNode,
	SidebarState
} from '../../../../shared/types';
import { uiStack, editorStack } from '../fonts';
import { accentById, applyPalette, DEFAULT_ACCENT } from '../accents';
import { setPinned, setLocked, setAiLocal, titleFromContent } from '../editor/markdown';
import { syncErrorMessage } from '../sync';
import { getAiSettings } from '../harness/config.svelte';
import { folderPrivacy, isHidden } from '../harness/privacy';
import {
	baseOf,
	cleanName,
	joinPath,
	noteStem,
	parentOf,
	remapPath,
	withNoteExt
} from '../../../../shared/paths';
import type { Layout } from '../layout';
import type { Editor } from '@tiptap/core';

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

export type View = 'editor' | 'settings' | 'changes';
export type Pane = 'nav' | 'list' | 'editor' | 'harness';
export type SettingsSection = 'general' | 'appearance' | 'editor' | 'sync' | 'ai' | 'shortcuts';
/** How a note opens: 'auto' = view on touch devices (no keyboard pop-up), edit with a mouse. */
export type OpenIn = 'auto' | 'view' | 'edit';

/** Resizable pane widths (px) and their limits. */
export const PANE_WIDTHS = {
	sidebar: { def: 250, min: 180, max: 420 },
	list: { def: 300, min: 220, max: 560 },
	harness: { def: 400, min: 300, max: 760 }
} as const;
export type PaneName = keyof typeof PANE_WIDTHS;

/** Pane layout persisted with the sidebar state. */
interface PanePrefs {
	sidebarOpen: boolean;
	listOpen: boolean;
	widths: Record<PaneName, number>;
}

export interface ConfirmRequest {
	title: string;
	body?: string;
	confirm: string;
	danger?: boolean;
	resolve(ok: boolean): void;
}

/** A one-field dialog (rename): resolves the typed text, or null on cancel. */
export interface PromptRequest {
	title: string;
	label: string;
	value: string;
	confirm: string;
	/** Why `value` can't be used (shown under the field), or null when it's fine. */
	check?(value: string): string | null;
	resolve(value: string | null): void;
}

/** The "Move to…" folder picker's subject. */
export interface MoveRequest {
	kind: 'note' | 'folder';
	path: string;
}

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
	/** AI harness on. Off: its code is never loaded, no button, no Mod+J. */
	ai: boolean;
	/** Open notes in view or edit mode. */
	openIn: OpenIn;
}

const DEFAULT_SETTINGS: Settings = {
	uiFont: 'inter',
	enFont: 'inter',
	arFont: 'naskh',
	vim: false,
	ghost: true,
	accent: DEFAULT_ACCENT,
	ai: true,
	openIn: 'auto'
};

const clampWidth = (pane: PaneName, px: number) =>
	Math.round(Math.min(PANE_WIDTHS[pane].max, Math.max(PANE_WIDTHS[pane].min, px)));

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
	/** Note list pane shown (desktop + tablet layouts; persisted). */
	listOpen = $state(true);
	/** Pane widths in px, resizable by dragging pane edges (persisted). */
	widths = $state<Record<PaneName, number>>({
		sidebar: PANE_WIDTHS.sidebar.def,
		list: PANE_WIDTHS.list.def,
		harness: PANE_WIDTHS.harness.def
	});
	/** A pane edge is being dragged: widths track the pointer without springing. */
	resizing = $state(false);
	private paneTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * The open note is editable. In view mode the text can't be changed and no
	 * caret / on-screen keyboard appears until Edit is tapped.
	 */
	editing = $state(true);
	/** Text of the open note when it was opened — the "since opened" diff without git. */
	baseline = $state<{ id: string | null; text: string } | null>(null);

	/** Section Settings shows (transient). */
	settingsSection = $state<SettingsSection>('general');
	/** Phones: a section is open (else the list of sections). */
	settingsDrill = $state(false);
	/** Notes changed since the last commit; null = not a git repo (or not loaded yet). */
	changes = $state<GitChange[] | null>(null);
	changesLoading = $state(false);
	/** Path the Changes view selects first. */
	changesFocus = $state<string | null>(null);
	private changesTimer: ReturnType<typeof setTimeout> | null = null;
	/** Stashes of every repo, newest first (loaded while Changes is open). */
	stashes = $state<GitStash[]>([]);
	/** A stash / revert is running. */
	gitBusy = $state(false);

	/** Note card whose swipe actions are revealed (one at a time). */
	swipeOpen = $state<string | null>(null);
	/** A pending confirmation dialog. */
	confirmRequest = $state<ConfirmRequest | null>(null);
	/** A pending one-field dialog (rename). */
	promptRequest = $state<PromptRequest | null>(null);
	/** The "Move to…" picker, open for a note or a folder. */
	moveRequest = $state<MoveRequest | null>(null);
	/** Short-lived message at the bottom of the window (moves, saves, errors). */
	notice = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	private noticeTimer: ReturnType<typeof setTimeout> | null = null;
	/** Folder context menu: screen position + folder path. */
	folderMenu = $state<{ x: number; y: number; path: string } | null>(null);
	/** Tablet AI bottom sheet: expanded to (almost) full height. */
	sheetExpanded = $state(false);

	/** Global keyboard-shortcut cheat sheet overlay (toggle with Mod+/). */
	cheatSheetOpen = $state(false);
	theme = $state<'light' | 'dark'>('light');

	/**
	 * The live TipTap instance (set by Editor.svelte's mount action), so the AI
	 * harness can read the buffer / caret and apply approved edits.
	 */
	editor = $state.raw<Editor | null>(null);

	/** AI harness pane: side split (desktop), bottom sheet (tablet), own pane (phone). */
	harnessOpen = $state(false);
	/** Becomes true on first open; the pane's code is loaded lazily and then stays mounted. */
	harnessLoaded = $state(false);

	/** Bumped to force the editor to recreate (e.g. after an external rewrite). */
	editorReloadToken = $state(0);

	/** Which top-level view is showing in the main window. */
	view = $state<View>('editor');
	/** Zen mode hides the sidebar + note list and centres the editor. */
	zen = $state(false);
	/**
	 * Window layout. Mouse-driven windows are always 'desktop'. Touch devices:
	 * 'phone' (<600px) stacks one pane at a time (folders → list → editor, with a
	 * back button); 'tablet' (600–1023px) shows list + editor with folders in a
	 * drawer; ≥1024px uses the desktop three-pane layout with touch-sized targets.
	 */
	layout = $state<Layout>('desktop');
	/** Touch device (Android or coarse pointer): formatting toolbar, bigger targets. */
	touch = $state(false);
	/** Which pane the phone layout shows. Tracked everywhere so rotation lands sensibly. */
	pane = $state<Pane>('nav');
	/** Folders drawer on the tablet layout. */
	drawerOpen = $state(false);

	settings = $state<Settings>({ ...DEFAULT_SETTINGS });

	/** Git sync in flight ('pull' | 'push'), or null when idle. */
	syncing = $state<'pull' | 'push' | null>(null);
	/** Last sync outcome shown in the titlebar; errors stay until dismissed. */
	/** Inline conflict resolver open (hosts with `conflictsInline`, i.e. Android). */
	conflictOpen = $state(false);
	syncMessage = $state<{ kind: 'ok' | 'error' | 'conflict'; text: string } | null>(null);
	private syncMessageTimer: ReturnType<typeof setTimeout> | null = null;

	/** Reflects a pending debounced write, for a subtle "saving…" hint. */
	saving = $state(false);

	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private pending: { id: string; content: string } | null = null;
	/** A move / rename in flight: saves wait for it, then write to the new path. */
	private moving: Promise<unknown> | null = null;
	private moveListeners: ((from: string, to: string) => void)[] = [];
	/** Close functions of open menus (ActionMenu), newest last: Android back closes them first. */
	private dismissers: (() => void)[] = [];

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
		const storedTheme = ((await platform.getState<string>('theme')) ??
			localStorage.getItem(THEME_KEY)) as 'light' | 'dark' | null;
		this.theme =
			storedTheme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
		this.applyTheme();

		// Settings: electron-store first, localStorage as a one-time migration.
		try {
			const stored =
				(await platform.getState<Partial<Settings>>('settings')) ??
				JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
			if (stored) this.settings = { ...DEFAULT_SETTINGS, ...stored };
		} catch {
			/* ignore malformed settings */
		}
		this.applyFonts();
		this.applyGhost();
		this.applyAccent();

		// Sidebar layout (section visibility + expanded folders/tags).
		const sidebar = await platform.getState<Partial<SidebarState>>('sidebar');
		if (sidebar) this.sidebar = { ...DEFAULT_SIDEBAR, ...sidebar };
		const panes = this.sidebar.panes as Partial<PanePrefs> | undefined;
		if (panes) {
			this.sidebarOpen = panes.sidebarOpen ?? true;
			this.listOpen = panes.listOpen ?? true;
			for (const p of Object.keys(PANE_WIDTHS) as PaneName[]) {
				const w = panes.widths?.[p];
				if (typeof w === 'number') this.widths[p] = clampWidth(p, w);
			}
		}

		this.workspace = await platform.getWorkspace();
		// Folder privacy (hidden from cloud AI) shows in the sidebar and list.
		if (this.settings.ai) void getAiSettings().load();
		await this.refresh();

		// Re-open the note from the previous session, if it still exists.
		const last = await platform.getState<string>('lastOpenFile');
		if (last && this.notes.some((n) => n.id === last)) {
			await this.openNote(last);
		}

		// Live updates from the filesystem watcher.
		platform.onNotesChanged(() => this.refresh());
		// Android can kill a backgrounded app before the save debounce fires.
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) void this.flush();
		});
		// Git sync: reload from disk after a clean sync; surface conflicts.
		platform.onSyncDone(() => {
			this.conflictOpen = false;
			void this.reloadFromDisk().then(() => this.refreshChanges());
		});
		platform.onSyncConflict((files) => {
			this.showSyncMessage(
				'conflict',
				`Conflicts in ${files.length} ${files.length === 1 ? 'file' : 'files'}. Resolve them in the conflict window.`
			);
			if (platform.conflictsInline) this.conflictOpen = true;
		});
		// Hardware back (Android) walks the stacked layout; at the root it exits.
		platform.onBackButton?.(() => this.back());
		// Touch devices have no hover: ghost syntax is revealed at the caret only.
		if (platform.platform === 'android' || matchMedia('(hover: none)').matches)
			document.documentElement.setAttribute('data-hover', 'none');
		// The stacked layout opens on the folders pane, whatever note was restored.
		this.pane = 'nav';
		this.booted = true;
		void this.refreshChanges();
	}

	// --- changes (git status) -------------------------------------------------

	/** Re-read git status now (Changes view, after a sync). */
	async refreshChanges(): Promise<void> {
		if (!platform.gitChanges || !this.workspace) {
			this.changes = null;
			return;
		}
		if (this.changesTimer) clearTimeout(this.changesTimer);
		this.changesTimer = null;
		this.changesLoading = true;
		try {
			await this.flush();
			this.changes = await platform.gitChanges();
		} catch (err) {
			console.error('[changes]', err);
		} finally {
			this.changesLoading = false;
		}
	}

	/** Coalesce status refreshes while typing / while files change. */
	private scheduleChanges(): void {
		if (!platform.gitChanges || this.changes === null) return;
		if (this.changesTimer) clearTimeout(this.changesTimer);
		this.changesTimer = setTimeout(() => void this.refreshChanges(), 1500);
	}

	/** Open the Changes view, optionally on one note's diff. */
	showChanges(path: string | null = null): void {
		this.changesFocus = path;
		this.setView('changes');
		void this.refreshChanges();
		void this.refreshStashes();
	}

	async refreshStashes(): Promise<void> {
		if (!platform.gitStashes || !this.workspace) {
			this.stashes = [];
			return;
		}
		try {
			this.stashes = await platform.gitStashes();
		} catch (err) {
			console.error('[stashes]', err);
		}
	}

	/**
	 * Run a stash / revert: pending edits reach disk first, and afterwards the
	 * open note is re-read (the op may have rewritten it). Returns the error or
	 * conflict text to show, or null when it went through cleanly.
	 */
	private async gitOp(op: () => Promise<GitOpResponse>): Promise<string | null> {
		this.gitBusy = true;
		let outcome: string | null;
		try {
			await this.flush();
			const res = await op();
			outcome = !res.ok
				? res.error
				: res.conflicts?.length
					? `Applied, but ${res.conflicts.join(', ')} had changed too: look for the <<<<<<< conflict markers. The stash was kept.`
					: null;
		} catch (err) {
			outcome = err instanceof Error ? err.message : String(err);
		}
		try {
			await this.reloadFromDisk();
			await Promise.all([this.refreshChanges(), this.refreshStashes()]);
		} finally {
			this.gitBusy = false;
		}
		return outcome;
	}

	/** Set these changed notes aside (one stash per repo) and revert them. */
	stashChanges(paths: string[], message: string): Promise<string | null> {
		return this.gitOp(() => platform.gitStash!(paths, message));
	}

	/** Bring a stash back; `drop` removes it once it applied cleanly. */
	applyStash(s: GitStash, drop: boolean): Promise<string | null> {
		return this.gitOp(() => platform.gitStashApply!(s.repo, s.id, drop));
	}

	dropStash(s: GitStash): Promise<string | null> {
		return this.gitOp(() => platform.gitStashDrop!(s.repo, s.id));
	}

	/** Put notes back to the last commit; new notes go to the trash. */
	revertChanges(paths: string[]): Promise<string | null> {
		return this.gitOp(() => platform.gitRevert!(paths));
	}

	/** git status of one note, if it differs from the last commit. */
	changeFor(id: string | null): GitChange | null {
		return (id && this.changes?.find((c) => c.path === id)) || null;
	}

	async refresh(): Promise<void> {
		if (!this.workspace) {
			this.notes = [];
			this.tags = [];
			this.folders = [];
			return;
		}
		const [notes, tags, trash, folders] = await Promise.all([
			platform.listNotes(),
			platform.listTags(),
			platform.listTrash(),
			platform.listFolders()
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
		this.scheduleChanges();
	}

	async pickWorkspace(): Promise<void> {
		const path = await platform.pickWorkspace();
		if (path) {
			this.workspace = path;
			this.activeId = null;
			this.activeContent = '';
			this.draft = false;
			this.selectedTag = null;
			void platform.setState('lastOpenFile', null);
			await this.refresh();
		}
	}

	async openNote(id: string): Promise<void> {
		this.swipeOpen = null;
		if (id === this.activeId) {
			this.view = 'editor';
			this.pane = 'editor';
			return;
		}
		await this.flush(); // persist any pending edits before switching
		this.draft = false; // a blank draft is simply discarded
		// Load the body BEFORE flipping activeId. The editor is keyed on
		// editorSession, so its content must already be in place when the new
		// instance mounts — otherwise it mounts with stale/empty text.
		const content = await platform.readNote(id);
		this.view = 'editor';
		this.pane = 'editor';
		this.activeContent = content;
		this.activeId = id;
		this.baseline = { id, text: content.replace(/\r\n?/g, '\n') };
		this.editing = this.defaultEditing();
		this.editorSession++;
		void platform.setState('lastOpenFile', id);
	}

	async createNote(): Promise<void> {
		await this.flush(); // persist the outgoing note (or materialise a draft)
		// New notes land in the folder currently in view ('' = workspace root).
		this.draftFolder = this.trashOpen ? '' : (this.selectedFolder ?? '');
		// No file yet: open an in-memory draft on an empty H1 line. The first
		// save derives the filename from the typed title.
		this.view = 'editor';
		this.pane = 'editor';
		this.draft = true;
		this.activeId = null;
		this.activeContent = '# ';
		this.baseline = { id: null, text: '' };
		// A new note is for writing: always open it editable.
		this.editing = true;
		this.editorSession++;
	}

	// --- view / edit mode ------------------------------------------------------

	/** Mode a note opens in, from the setting ('auto': view on touch, edit with a mouse). */
	private defaultEditing(): boolean {
		const o = this.settings.openIn;
		return o === 'edit' || (o === 'auto' && !this.touch);
	}

	setEditing(on: boolean): void {
		this.editing = on;
		if (!on) void this.flush();
	}

	toggleEditing(): void {
		this.setEditing(!this.editing);
	}

	/**
	 * Create a folder (under the selected folder if one is active, else the root)
	 * and select it so the user drops straight into the new scope.
	 */
	async createFolder(name: string): Promise<void> {
		const parent = this.selectedFolder ?? '';
		const rel = await platform.createFolder(name, parent);
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
			if (this.pane === 'editor') this.pane = 'list';
			this.activeId = null;
			this.activeContent = '';
			void platform.setState('lastOpenFile', null);
		}
		await platform.deleteNote(id);
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
		await platform.restoreNote(trashId);
		await this.refresh();
	}

	/** Permanently delete a note from the trash — this cannot be undone. */
	async permanentDelete(trashId: string): Promise<void> {
		if (trashId === this.activeId) {
			this.cancelPending();
			this.activeId = null;
			this.activeContent = '';
		}
		await platform.permanentDelete(trashId);
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
		// Touch layouts: tapping a tag always drills into it (no toggle-off).
		this.selectedTag = this.selectedTag === path && !this.touch ? null : path;
		this.pane = 'list';
		this.drawerOpen = false;
	}

	selectFolder(path: string | null): void {
		this.view = 'editor';
		this.trashOpen = false;
		this.selectedTag = null;
		this.selectedFolder = this.selectedFolder === path && !this.touch ? null : path;
		this.pane = 'list';
		this.drawerOpen = false;
	}

	/** Open the Trash view (its own note list). */
	openTrash(): void {
		this.view = 'editor';
		this.selectedTag = null;
		this.selectedFolder = null;
		this.trashOpen = true;
		this.pane = 'list';
		this.drawerOpen = false;
	}

	/** "All Notes": clear every filter and show the whole tree. */
	showAllNotes(): void {
		this.view = 'editor';
		this.selectedTag = null;
		this.selectedFolder = null;
		this.trashOpen = false;
		this.pane = 'list';
		this.drawerOpen = false;
	}

	// --- stacked (compact) navigation ---------------------------------------

	setLayout(layout: Layout, touch: boolean): void {
		this.layout = layout;
		this.touch = touch;
		if (layout !== 'tablet') this.drawerOpen = false;
		if (touch) document.documentElement.setAttribute('data-touch', '');
		else document.documentElement.removeAttribute('data-touch');
	}

	toggleDrawer(): void {
		this.drawerOpen = !this.drawerOpen;
	}

	// --- AI harness ----------------------------------------------------------

	openHarness(): void {
		if (!this.settings.ai) return;
		this.harnessLoaded = true;
		this.harnessOpen = true;
		this.drawerOpen = false;
		if (this.layout === 'phone') {
			this.view = 'editor';
			this.pane = 'harness';
		}
	}

	closeHarness(): void {
		this.harnessOpen = false;
		if (this.pane === 'harness') this.pane = this.activeId || this.draft ? 'editor' : 'list';
	}

	toggleHarness(): void {
		// On a phone the pane is "open" only while it is the one on screen.
		const visible = this.layout === 'phone' ? this.pane === 'harness' : this.harnessOpen;
		if (visible) this.closeHarness();
		else this.openHarness();
	}

	/** Does the top bar show a back button (phone layout only)? */
	get canGoBack(): boolean {
		return this.layout === 'phone' && (this.view !== 'editor' || this.pane !== 'nav');
	}

	/**
	 * One step back (top-bar button / Android back): close a dialog or the
	 * revealed swipe actions, leave Settings / Changes, close the drawer, or on
	 * phones editor → list → folders. False when there's nowhere to go (the
	 * host may then exit).
	 */
	back(): boolean {
		if (this.confirmRequest) {
			this.answerConfirm(false);
			return true;
		}
		if (this.promptRequest) {
			this.answerPrompt(null);
			return true;
		}
		const menu = this.dismissers[this.dismissers.length - 1];
		if (menu) {
			menu();
			return true;
		}
		if (this.moveRequest || this.folderMenu) {
			this.moveRequest = null;
			this.folderMenu = null;
			return true;
		}
		if (this.contextMenu) {
			this.closeContextMenu();
			return true;
		}
		if (this.swipeOpen) {
			this.swipeOpen = null;
			return true;
		}
		if (this.view === 'settings' && this.layout === 'phone' && this.settingsDrill) {
			this.settingsDrill = false;
			return true;
		}
		if (this.view !== 'editor') {
			this.view = 'editor';
			return true;
		}
		if (this.drawerOpen) {
			this.drawerOpen = false;
			return true;
		}
		if (this.layout === 'tablet' && this.harnessOpen) {
			this.closeHarness();
			return true;
		}
		if (this.layout !== 'phone') return false;
		if (this.pane === 'harness') {
			this.closeHarness();
			return true;
		}
		if (this.pane === 'editor') {
			void this.flush();
			this.pane = 'list';
			return true;
		}
		if (this.pane === 'list') {
			this.pane = 'nav';
			return true;
		}
		return false;
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
		void platform.setState('sidebar', $state.snapshot(this.sidebar));
	}

	// --- pinning -----------------------------------------------------------

	async setPinned(id: string, pinned: boolean): Promise<void> {
		// Persist any live edits first so we toggle against current content.
		if (id === this.activeId) await this.flush();
		const content = await platform.readNote(id);
		const next = setPinned(content, pinned);
		if (next === content) return;
		await platform.writeNote(id, next);
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
		const content = await platform.readNote(id);
		const next = setLocked(content, locked);
		if (next === content) return;
		await platform.writeNote(id, next);
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

	// --- AI privacy (hidden from cloud AI) --------------------------------------

	/** The note may only go to local AI providers (its own marker or its folder). */
	hiddenFromAi(note: { id: string; aiLocal?: boolean }): boolean {
		return this.settings.ai && isHidden(note, getAiSettings().config.localOnlyFolders);
	}

	/** How a folder is hidden from cloud AI: itself, through a parent, or not. */
	folderHidden(path: string): ReturnType<typeof folderPrivacy> {
		return this.settings.ai ? folderPrivacy(path, getAiSettings().config.localOnlyFolders) : null;
	}

	/** Add / drop the note's `<!-- ai: local -->` marker (mirrors `setLocked`). */
	async setHiddenFromAi(id: string, hidden: boolean): Promise<void> {
		if (id === this.activeId) await this.flush();
		const content = await platform.readNote(id);
		const next = setAiLocal(content, hidden);
		if (next === content) return;
		await platform.writeNote(id, next);
		if (id === this.activeId) {
			this.activeContent = next;
			this.editorReloadToken++;
		}
		await this.refresh();
		this.notify('ok', hidden ? 'Hidden from cloud AI' : 'Cloud AI may read this note');
	}

	toggleFolderHidden(path: string): void {
		const ai = getAiSettings();
		const self = ai.config.localOnlyFolders.includes(path);
		ai.setFolderHidden(path, !self);
		this.notify(
			'ok',
			self ? `Cloud AI may read “${baseOf(path)}”` : `“${baseOf(path)}” hidden from cloud AI`
		);
	}

	// --- move / rename -----------------------------------------------------------

	openMove(kind: MoveRequest['kind'], path: string): void {
		this.contextMenu = null;
		this.folderMenu = null;
		this.moveRequest = { kind, path };
	}

	/** An open menu, closed by Android back before anything else; returns an unregister. */
	onDismiss(close: () => void): () => void {
		this.dismissers.push(close);
		return () => {
			this.dismissers = this.dismissers.filter((x) => x !== close);
		};
	}

	/** Subscribe to moves (`from` → `to`, a note or a folder); returns an unsubscribe. */
	onMoved(cb: (from: string, to: string) => void): () => void {
		this.moveListeners.push(cb);
		return () => {
			this.moveListeners = this.moveListeners.filter((x) => x !== cb);
		};
	}

	folderExists(path: string): boolean {
		const p = path.toLowerCase();
		return (
			this.folders.some((f) => f.toLowerCase() === p) ||
			this.notes.some((n) => n.id.toLowerCase().startsWith(`${p}/`))
		);
	}

	async renameNote(id: string): Promise<void> {
		const dir = parentOf(id);
		const target = (v: string) => joinPath(dir, withNoteExt(cleanName(v), id));
		const name = await this.prompt({
			title: 'Rename note',
			label: 'File name',
			value: noteStem(id),
			confirm: 'Rename',
			check: (v) => {
				if (!cleanName(v)) return 'Enter a name.';
				const to = target(v).toLowerCase();
				return to !== id.toLowerCase() && this.notes.some((n) => n.id.toLowerCase() === to)
					? 'A note with that name is already in this folder.'
					: null;
			}
		});
		if (name !== null) await this.relocateNote(id, target(name));
	}

	/** Move a note into `folder` ('' = workspace root). */
	async moveNoteTo(id: string, folder: string): Promise<void> {
		if (parentOf(id) !== folder) await this.relocateNote(id, joinPath(folder, baseOf(id)));
	}

	async renameFolder(path: string): Promise<void> {
		const parent = parentOf(path);
		const name = await this.prompt({
			title: 'Rename folder',
			label: 'Folder name',
			value: baseOf(path),
			confirm: 'Rename',
			check: (v) => {
				const c = cleanName(v);
				if (!c) return 'Enter a name.';
				const to = joinPath(parent, c);
				return to.toLowerCase() !== path.toLowerCase() && this.folderExists(to)
					? 'A folder with that name is already here.'
					: null;
			}
		});
		if (name !== null) await this.relocateFolder(path, joinPath(parent, cleanName(name)));
	}

	/** Move a folder into `parent` ('' = workspace root). */
	async moveFolderTo(path: string, parent: string): Promise<void> {
		if (parentOf(path) === parent) return;
		if (parent === path || parent.startsWith(`${path}/`)) {
			this.notify('error', 'A folder can’t move into itself.');
			return;
		}
		await this.relocateFolder(path, joinPath(parent, baseOf(path)));
	}

	private async relocateNote(id: string, to: string): Promise<void> {
		const note = this.notes.find((n) => n.id === id);
		if (note && !(await this.keepsPrivacy(note.title, note.aiLocal ? null : id, to))) return;
		if (id === this.activeId) await this.flush();
		const next = await this.runMove(() => platform.moveNote(id, to));
		if (next === null) return;
		this.pathMoved(id, next);
		await this.refresh();
		this.notify(
			'ok',
			parentOf(next) === parentOf(id)
				? `Renamed to ${baseOf(next)}`
				: `Moved to ${parentOf(next) || 'Notes'}`
		);
	}

	private async relocateFolder(from: string, to: string): Promise<void> {
		// A folder listed itself stays hidden (the setting moves along); only an inherited one can lapse.
		const self = getAiSettings().config.localOnlyFolders.includes(from);
		if (!self && !(await this.keepsPrivacy(baseOf(from), from, to))) return;
		await this.flush();
		const next = await this.runMove(() => platform.moveFolder(from, to));
		if (next === null) return;
		await getAiSettings().folderMoved(from, next);
		this.pathMoved(from, next);
		await this.refresh();
		this.notify(
			'ok',
			parentOf(next) === parentOf(from)
				? `Renamed to ${baseOf(next)}`
				: `Moved to ${parentOf(next) || 'Notes'}`
		);
	}

	/** Run a host move; saves queued meanwhile wait for it. Null (and a notice) on failure. */
	private async runMove(op: () => Promise<string>): Promise<string | null> {
		const run = op();
		this.moving = run;
		try {
			return await run;
		} catch (err) {
			this.notify('error', err instanceof Error ? err.message : String(err));
			return null;
		} finally {
			if (this.moving === run) this.moving = null;
		}
	}

	/**
	 * Moving out of a folder hidden from cloud AI would expose the note/folder
	 * at `path` (null = it stays hidden anyway): ask first.
	 */
	private async keepsPrivacy(name: string, path: string | null, to: string): Promise<boolean> {
		if (path === null || !this.settings.ai) return true;
		const folders = getAiSettings().config.localOnlyFolders;
		const now = folderPrivacy(parentOf(path), folders) ?? folderPrivacy(path, folders);
		if (!now || folderPrivacy(parentOf(to), folders)) return true;
		return this.confirm({
			title: 'Let cloud AI read it?',
			body: `“${name}” is hidden from cloud AI because it’s in “${now.folder || 'Notes'}”. Moved to “${parentOf(to) || 'Notes'}”, cloud providers could read it.`,
			confirm: 'Move anyway'
		});
	}

	/** Re-point everything that names a moved note / folder (open note, filters, expansion…). */
	private pathMoved(from: string, to: string): void {
		const active = this.activeId && remapPath(this.activeId, from, to);
		if (active) {
			// The editor is keyed on the session, not the id: no remount, caret stays.
			this.activeId = active;
			if (this.baseline) this.baseline = { ...this.baseline, id: active };
			void platform.setState('lastOpenFile', active);
		}
		if (this.pending) this.pending.id = remapPath(this.pending.id, from, to) ?? this.pending.id;
		if (this.selectedFolder)
			this.selectedFolder = remapPath(this.selectedFolder, from, to) ?? this.selectedFolder;
		const expanded: Record<string, boolean> = {};
		let changed = false;
		for (const [k, v] of Object.entries(this.sidebar.folderExpanded)) {
			const nk = remapPath(k, from, to);
			if (nk !== null) changed = true;
			expanded[nk ?? k] = v;
		}
		if (changed) {
			this.sidebar.folderExpanded = expanded;
			this.persistSidebar();
		}
		for (const cb of this.moveListeners) cb(from, to);
	}

	// --- notices + prompt dialog ---------------------------------------------------

	notify(kind: 'ok' | 'error', text: string): void {
		if (this.noticeTimer) clearTimeout(this.noticeTimer);
		this.notice = { kind, text };
		this.noticeTimer = setTimeout(() => (this.notice = null), kind === 'ok' ? 2400 : 5000);
	}

	prompt(req: Omit<PromptRequest, 'resolve'>): Promise<string | null> {
		this.promptRequest?.resolve(null);
		return new Promise((resolve) => (this.promptRequest = { ...req, resolve }));
	}

	answerPrompt(value: string | null): void {
		const r = this.promptRequest;
		this.promptRequest = null;
		r?.resolve(value);
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
		this.drawerOpen = false;
		this.swipeOpen = null;
	}

	toggleSettings(): void {
		if (this.view === 'settings') this.setView('editor');
		else this.openSettings();
	}

	/** Open Settings, optionally on one section (e.g. 'ai' from the harness). */
	openSettings(section?: SettingsSection): void {
		if (section) this.settingsSection = section;
		this.settingsDrill = !!section;
		this.setView('settings');
	}

	// --- confirmation dialog ---------------------------------------------------

	/** Ask before something irreversible; resolves false on cancel / back / Escape. */
	confirm(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
		this.confirmRequest?.resolve(false);
		return new Promise((resolve) => (this.confirmRequest = { ...req, resolve }));
	}

	answerConfirm(ok: boolean): void {
		const r = this.confirmRequest;
		this.confirmRequest = null;
		r?.resolve(ok);
	}

	// --- pane layout (persisted) ---------------------------------------------

	toggleList(): void {
		this.listOpen = !this.listOpen;
		this.persistPanes();
	}

	setWidth(pane: PaneName, px: number): void {
		this.widths[pane] = clampWidth(pane, px);
		this.persistPanes();
	}

	resetWidth(pane: PaneName): void {
		this.setWidth(pane, PANE_WIDTHS[pane].def);
	}

	private persistPanes(): void {
		if (this.paneTimer) clearTimeout(this.paneTimer);
		this.paneTimer = setTimeout(() => {
			const panes: PanePrefs = {
				sidebarOpen: this.sidebarOpen,
				listOpen: this.listOpen,
				widths: { ...this.widths }
			};
			this.sidebar.panes = panes;
			this.persistSidebar();
		}, 300);
	}

	toggleZen(): void {
		this.zen = !this.zen;
	}

	// --- settings ----------------------------------------------------------

	updateSettings(patch: Partial<Settings>): void {
		this.settings = { ...this.settings, ...patch };
		// Turning AI off unmounts the pane, so nothing of it stays alive.
		if (patch.ai === false) {
			this.closeHarness();
			this.harnessLoaded = false;
		}
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
		void platform.setState('settings', $state.snapshot(this.settings));
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
		// Only write real edits. Opening a note can emit editor updates without
		// changing the text; writing then would bump the file's mtime and float
		// the note to the top of the list. (activeContent mirrors the disk; the
		// editor normalises CRLF, so compare against the normalised form.)
		if (this.activeId && content === this.activeContent.replace(/\r\n?/g, '\n')) {
			this.cancelPending();
			return;
		}
		this.pending = { id: this.activeId ?? DRAFT_ID, content };
		this.saving = true;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE);
	}

	/** Write any pending edit to disk immediately. */
	async flush(): Promise<void> {
		// Mid-move the old path is going away: write once the new one is known.
		if (this.moving) await this.moving.catch(() => {});
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
		await platform.writeNote(id, content);
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
			if (this.activeId) await platform.writeNote(this.activeId, content);
			this.saving = false;
			return;
		}
		const title = titleFromContent(content);
		if (title === null) {
			// Still blank (just the empty H1 scaffold) — keep it off the disk.
			this.saving = false;
			return;
		}
		const meta = await platform.createNote(title, this.draftFolder, content);
		this.draft = false;
		this.activeId = meta.id;
		this.activeContent = content;
		this.saving = false;
		void platform.setState('lastOpenFile', meta.id);
		await this.refresh();
	}

	private cancelPending(): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		this.pending = null;
		this.saving = false;
	}

	// --- git sync ---------------------------------------------------------

	/** Run a pull/push in main. Pending edits are flushed first so git sees them. */
	async sync(op: 'pull' | 'push'): Promise<void> {
		if (this.syncing) return;
		this.syncing = op;
		this.showSyncMessage(null);
		try {
			await this.flush();
			const res = await (op === 'pull' ? platform.syncPull() : platform.syncPush());
			if (!res.ok) {
				this.showSyncMessage('error', syncErrorMessage(res.error));
			} else if (res.result.status === 'ok') {
				this.showSyncMessage('ok', op === 'pull' ? 'Pulled' : 'Pushed');
			}
			// 'conflict' is reported through the onSyncConflict event.
		} catch (err) {
			this.showSyncMessage('error', err instanceof Error ? err.message : String(err));
		} finally {
			this.syncing = null;
		}
	}

	showSyncMessage(kind: 'ok' | 'error' | 'conflict' | null, text = ''): void {
		if (this.syncMessageTimer) clearTimeout(this.syncMessageTimer);
		this.syncMessageTimer = null;
		this.syncMessage = kind ? { kind, text } : null;
		if (kind === 'ok') this.syncMessageTimer = setTimeout(() => (this.syncMessage = null), 2500);
	}

	/** Files may have changed under us (pull / conflict resolution): re-read the open note. */
	async reloadFromDisk(): Promise<void> {
		if (this.syncMessage?.kind === 'conflict') this.showSyncMessage(null);
		await this.refresh();
		const id = this.activeId;
		if (!id || this.draft || !this.notes.some((n) => n.id === id)) return;
		// Keystrokes typed while the sync ran are newer than disk — keep them.
		if (this.pending) return;
		const content = await platform.readNote(id);
		if (id !== this.activeId || content === this.activeContent) return;
		this.activeContent = content;
		this.editorReloadToken++;
	}

	// --- theme ------------------------------------------------------------

	toggleTheme(): void {
		this.setTheme(this.theme === 'light' ? 'dark' : 'light');
	}

	setTheme(theme: 'light' | 'dark'): void {
		this.theme = theme;
		localStorage.setItem(THEME_KEY, this.theme);
		void platform.setState('theme', this.theme);
		this.applyTheme();
	}

	private applyTheme(): void {
		document.documentElement.setAttribute('data-theme', this.theme);
		// Accent hex differs per theme, so re-resolve it whenever the theme flips.
		this.applyAccent();
	}

	toggleSidebar(): void {
		this.sidebarOpen = !this.sidebarOpen;
		this.persistPanes();
	}
}

let instance: AppState | null = null;

export function getAppState(): AppState {
	return (instance ??= new AppState());
}

export type { AppState };
