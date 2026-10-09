<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { tick, untrack } from 'svelte';
	import { Editor } from '@tiptap/core';
	import Document from '@tiptap/extension-document';
	import Paragraph from '@tiptap/extension-paragraph';
	import Text from '@tiptap/extension-text';
	import { UndoRedo } from '@tiptap/extensions';
	import Placeholder from '@tiptap/extension-placeholder';
	import { getAppState } from '../stores/app.svelte';
	import { MarkdownSyntax } from '../editor/MarkdownSyntax';
	import { MarkdownShortcuts } from '../editor/MarkdownShortcuts';
	import { ListBehavior } from '../editor/ListBehavior';
	import { TableBehavior, insertTable } from '../editor/TableBehavior';
	import { ImageBehavior, insertImages } from '../editor/ImageBehavior';
	import { HighlightBehavior, highlightAt, setHighlight } from '../editor/HighlightBehavior';
	import { isHighlightColor, type HighlightColor } from '../editor/highlights';
	import { imageSource } from '../editor/images';
	import { TagSuggest, flattenTagTree } from '../editor/TagSuggest';
	import { Vim, type VimMode } from '../editor/vim';
	import {
		textToDoc,
		docToText,
		detectDir,
		setDir,
		detectLocked,
		type Direction
	} from '../editor/markdown';
	import EmptyState from './EmptyState.svelte';
	import FormatToolbar, { type ToolAction } from './FormatToolbar.svelte';
	import ActionMenu, { type MenuItem } from './ActionMenu.svelte';
	import TablePicker from './TablePicker.svelte';
	import HighlightPicker from './HighlightPicker.svelte';
	import NoteTabs from './NoteTabs.svelte';
	import Icon from './Icon.svelte';
	import { platform } from '../platform';
	import { reducedMotion } from '../portal';
	import type { IconName } from '../icons';
	import {
		BAR_LABELS,
		NOTE_ITEMS,
		fitBar,
		isInsertItem,
		type BarItem,
		type InsertItem,
		type NoteItem
	} from '../noteBar';
	import logo from '$lib/assets/logo.png';
	import mascotNew from '$lib/assets/fr5a-new.png';

	const app = getAppState();

	let editor: Editor | undefined = $state();
	let dir = $state<Direction>('ltr');
	let vimMode = $state<VimMode>('normal');
	let scroller = $state<HTMLDivElement | null>(null);
	let scrolled = $state(false);
	let moreBtn = $state<HTMLButtonElement | null>(null);
	let moreAt = $state<{ x: number; y: number } | null>(null);
	let crumbBtn = $state<HTMLButtonElement | null>(null);
	let crumbAt = $state<{ x: number; y: number } | null>(null);
	let insertBtn = $state<HTMLButtonElement | null>(null);
	let insertAt = $state<{ x: number; y: number } | null>(null);
	let tableBtn = $state<HTMLButtonElement | null>(null);
	let highlightBtn = $state<HTMLButtonElement | null>(null);
	/** The table size picker, opened from `anchor` (`toggle`: its own button, which closes it again). */
	let tableAt = $state<{
		x: number;
		y: number;
		sheet: boolean;
		anchor: HTMLElement;
		toggle: boolean;
	} | null>(null);
	/**
	 * The highlight color picker (shown while `open`). Kept once closed: the
	 * picker still reads its props while it fades out.
	 */
	let highlightPick = $state<{
		open: boolean;
		at: { x: number; y: number };
		above: boolean;
		anchor: HTMLElement;
		toggle: boolean;
		color: HighlightColor | null;
		any: boolean;
	} | null>(null);
	/** Right-click on the bar (mouse): move a button into its menu, or customize the bar. */
	let barMenu = $state<{ at: { x: number; y: number }; id: BarItem | null } | null>(null);
	let imageInput = $state<HTMLInputElement | null>(null);
	// Suppress auto-save while we programmatically replace content.
	let loading = false;

	// No hardware keyboard to drive modal editing on Android: Vim stays off there.
	const vimOn = $derived(app.settings.vim && platform.platform !== 'android');
	const highlights = $derived(app.settings.highlights);
	const activeMeta = $derived(app.notes.find((n) => n.id === app.activeId));
	// Locked notes are read-only. Fall back to the buffer so the badge is right
	// even before the index round-trips.
	const locked = $derived(activeMeta?.locked ?? detectLocked(app.activeContent));
	// View mode (or a lock): no caret, no keyboard, no accidental edits.
	const editable = $derived(app.editing && !locked);
	const compact = $derived(app.layout === 'phone');
	let headW = $state(0);
	/** A narrow header (touch tablets: 44px targets beside the list): the crumb keeps to the file name. */
	const narrow = $derived(compact || (headW > 0 && headW < (app.touch ? 620 : 440)));
	const mac = platform.platform === 'darwin';
	/** A shortcut to show in a menu row: none on touch, where there's no keyboard to press it. */
	const keys = (onMac: string, other: string) => (app.touch ? undefined : mac ? onMac : other);
	const change = $derived(app.changeFor(app.activeId));
	const hiddenAi = $derived(!!activeMeta && app.hiddenFromAi(activeMeta));
	// Recreate the editor when a different buffer opens (editorSession), Vim or
	// highlights are toggled, or an external rewrite (e.g. pin toggle) bumps the
	// reload token. Keyed on the session — not the note id — so a draft
	// materialising into a real file doesn't remount the editor mid-typing.
	const editorKey = $derived(
		`${app.editorSession}:${vimOn}:${highlights}:${app.editorReloadToken}`
	);
	const crumb = $derived.by(() => {
		const id = app.activeId;
		if (!id) return { dir: '', name: 'New note' };
		const i = id.lastIndexOf('/');
		return i === -1 ? { dir: '', name: id } : { dir: id.slice(0, i), name: id.slice(i + 1) };
	});

	/** What an `<img>` loads for an image line's `src` (relative to the open note). */
	function imageUrl(src: string): string | null {
		const at = imageSource(src, app.activeDir);
		if (!at) return null;
		return at.kind === 'url' ? at.url : (platform.assetUrl?.(at.path) ?? null);
	}

	const saveImage = (file: File) => app.saveImage(file);

	function buildEditor(node: HTMLElement, content: string): Editor {
		const extensions = [
			Document,
			Paragraph,
			Text,
			UndoRedo,
			Placeholder.configure({ placeholder: 'Start writing…' }),
			MarkdownSyntax.configure({ highlights, imageUrl }),
			MarkdownShortcuts,
			ListBehavior,
			TableBehavior,
			ImageBehavior.configure({ save: saveImage }),
			// Fed from the store's tag tree (itself the SQLite index over IPC).
			TagSuggest.configure({ getTags: () => flattenTagTree(app.tags) })
		];
		if (highlights) extensions.push(HighlightBehavior.configure({ color: lastHighlight }));
		if (vimOn) {
			extensions.push(Vim.configure({ onModeChange: (m) => (vimMode = m) }));
		}
		const canEdit = app.editing && !detectLocked(content);
		return new Editor({
			element: node,
			extensions,
			content: textToDoc(content),
			// Locked / view mode mount read-only; `editable` below flips it live.
			editable: canEdit,
			// Touch: never pop the keyboard on open — except for a new note's title.
			autofocus: canEdit && (!app.touch || app.draft) ? 'end' : false,
			onUpdate: ({ editor }) => {
				if (loading) return;
				app.queueSave(docToText(editor));
			}
		});
	}

	/**
	 * Attachment: owns one TipTap instance for the lifetime of the node. Untracked:
	 * only the `{#key}` above recreates it, never a change to what it read.
	 */
	function mount(node: HTMLElement): () => void {
		const ed = untrack(() => {
			const content = app.activeContent;
			dir = detectDir(content) ?? 'ltr';
			vimMode = 'normal';
			return buildEditor(node, content);
		});
		editor = ed;
		app.editor = ed;
		return () => {
			app.flush();
			ed.destroy();
			// Only clear the shared ref if it still points at *this* instance —
			// during a keyed swap the next editor may already have claimed it.
			if (editor === ed) editor = undefined;
			if (app.editor === ed) app.editor = null;
		};
	}

	/** Attachment: view ⇄ edit without remounting (keeps undo history, scroll and caret). */
	function followEditable(): void {
		const on = editable;
		if (editor && !editor.isDestroyed && editor.isEditable !== on) {
			editor.setEditable(on, false);
			if (!on) (document.activeElement as HTMLElement | null)?.blur();
		}
	}

	/**
	 * Enter edit mode with the caret where the user looked (a double-tap
	 * point) or on the first visible line — never jumping the scroll position.
	 */
	async function startEditing(at?: { x: number; y: number }): Promise<void> {
		if (locked) return;
		app.setEditing(true);
		await tick();
		const ed = editor;
		if (!ed || !scroller) return;
		// A rendered table cell / picture: it puts the caret into its source.
		const cell =
			at && document.elementFromPoint(at.x, at.y)?.closest('.md-table [data-line], .md-image');
		if (cell) {
			cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
			return;
		}
		let point = at;
		if (!point) {
			const r = scroller.getBoundingClientRect();
			point = { x: r.left + r.width / 2, y: r.top + 28 };
		}
		const hit = ed.view.posAtCoords({ left: point.x, top: point.y });
		if (hit) ed.commands.setTextSelection(hit.pos);
		const top = scroller.scrollTop;
		ed.view.focus();
		scroller.scrollTop = top;
	}

	function onDoubleClick(e: MouseEvent): void {
		if (editable || locked) return;
		e.preventDefault();
		void startEditing({ x: e.clientX, y: e.clientY });
	}

	function toggleDir(): void {
		if (!editor) return;
		const next: Direction = dir === 'rtl' ? 'ltr' : 'rtl';
		const text = setDir(docToText(editor), next);
		loading = true;
		editor.commands.setContent(textToDoc(text), { emitUpdate: false });
		loading = false;
		dir = next;
		app.queueSave(text);
	}

	async function deleteNote(): Promise<void> {
		if (!app.activeId || locked) return;
		await app.deleteNote(app.activeId);
	}

	function openMore(): void {
		if (moreAt) {
			moreAt = null;
			return;
		}
		const r = moreBtn!.getBoundingClientRect();
		moreAt = { x: r.right - 200, y: r.bottom + 6 };
	}

	/** Encrypt / decrypt the open note; a draft is marked to be saved encrypted. */
	const encryptItem = $derived.by((): MenuItem[] => {
		if (!app.vault || (!activeMeta && !app.draft)) return [];
		const on = app.activeEncrypted;
		return [
			{
				label: on ? (app.draft ? 'Don’t encrypt' : 'Remove encryption') : 'Encrypt note',
				icon: 'key',
				action: () =>
					app.draft
						? app.toggleDraftEncrypted()
						: activeMeta && void app.setEncrypted(activeMeta.id, !on)
			}
		];
	});

	/** Rename / move / AI privacy / encryption of the open note (crumb menu; also in ⋯ on phones). */
	const fileItems = $derived.by((): MenuItem[] => {
		const n = activeMeta;
		if (!n) return encryptItem;
		const viaFolder = !n.aiLocal && hiddenAi;
		const items: MenuItem[] = [
			{ label: 'Rename…', icon: 'rename', action: () => void app.renameNote(n.id) },
			{ label: 'Move to…', icon: 'move', action: () => app.openMove('note', n.id) }
		];
		if (app.settings.ai)
			items.push({
				label: hiddenAi ? 'Let cloud AI read' : 'Hide from cloud AI',
				icon: 'shield',
				disabled: viaFolder,
				hint: viaFolder ? 'folder' : undefined,
				action: () => void app.setHiddenFromAi(n.id, !n.aiLocal)
			});
		return [...items, ...encryptItem];
	});

	function openCrumb(): void {
		if (crumbAt) {
			crumbAt = null;
			return;
		}
		const r = crumbBtn!.getBoundingClientRect();
		crumbAt = { x: r.left, y: r.bottom + 4 };
	}

	/** A note action as a row of ⋯ (Settings → Toolbar put it there, or the bar ran out of room). */
	function noteRow(id: NoteItem): MenuItem {
		switch (id) {
			case 'edit':
				return editable
					? {
							label: 'Done editing',
							icon: app.touch ? 'check' : 'eye',
							hint: keys('⌘⇧E', 'Ctrl+Shift+E'),
							action: () => app.setEditing(false)
						}
					: {
							label: 'Edit',
							icon: 'edit',
							hint: keys('⌘⇧E', 'Ctrl+Shift+E'),
							action: () => void startEditing()
						};
			case 'ai':
				return {
					label: app.harnessOpen ? 'Close AI assistant' : 'AI assistant',
					icon: 'ai',
					hint: keys('⌘J', 'Ctrl+J'),
					action: () => app.toggleHarness()
				};
			case 'pin':
				return {
					label: activeMeta?.pinned ? 'Unpin note' : 'Pin note',
					icon: 'pin',
					hint: keys('⌘P', 'Ctrl+P'),
					disabled: !app.activeId,
					action: () => app.activeId && app.togglePin(app.activeId)
				};
			case 'dir':
				return {
					label: dir === 'rtl' ? 'Left-to-right text' : 'Right-to-left text',
					icon: 'dir',
					hint: dir.toUpperCase(),
					disabled: locked,
					action: toggleDir
				};
			case 'lock':
				return {
					label: locked ? 'Unlock note' : 'Lock note',
					icon: locked ? 'unlock' : 'lock',
					disabled: !app.activeId,
					action: () => app.activeId && app.toggleLock(app.activeId)
				};
			case 'changes':
				return {
					label: change ? 'Show changes' : 'Changes',
					icon: 'diff',
					hint: change ? 'modified' : undefined,
					action: () => app.showChanges(app.activeId)
				};
			case 'trash':
				return {
					label: 'Move to Trash',
					icon: 'trash',
					danger: true,
					disabled: locked || !activeMeta,
					action: () => void deleteNote()
				};
		}
	}

	// --- Insert: image, table, highlight -----------------------------------

	function pickImage(): void {
		imageInput?.click();
	}

	function onImagePicked(): void {
		const files = [...(imageInput?.files ?? [])];
		if (imageInput) imageInput.value = '';
		if (editor && files.length) void insertImages(editor.view, files, saveImage);
	}

	/**
	 * How a popup opens from `anchor`: under a header button, or `above` one of
	 * the touch toolbar. `toggle`: the anchor is the popup's own button, so
	 * pressing it again closes it (a menu's button just opens the menu).
	 */
	interface PopupFrom {
		above: boolean;
		toggle: boolean;
	}

	/** The table size picker. */
	function openTable(anchor: HTMLElement, { above, toggle }: PopupFrom): void {
		if (tableAt && toggle) {
			tableAt = null;
			return;
		}
		const r = anchor.getBoundingClientRect();
		// The popover flips above `y` when it wouldn't fit below.
		tableAt = {
			x: above ? r.left : r.right - 210,
			y: above ? r.top - 6 : r.bottom + 6,
			sheet: app.layout === 'phone',
			anchor,
			toggle
		};
	}

	/** The color last picked (Mod+Shift+H paints it). */
	function lastHighlight(): HighlightColor {
		const c = app.settings.highlightColor;
		return isHighlightColor(c) ? c : 'yellow';
	}

	/** The highlight color picker, centred on `anchor`. */
	function openHighlight(anchor: HTMLElement, { above, toggle }: PopupFrom): void {
		if (highlightPick?.open) {
			highlightPick.open = false;
			return;
		}
		if (!editor) return;
		const r = anchor.getBoundingClientRect();
		const { color, any } = highlightAt(editor.state);
		const x = r.left + r.width / 2;
		highlightPick = {
			open: true,
			at: { x, y: above ? r.top - 6 : r.bottom + 6 },
			above,
			anchor,
			toggle,
			color,
			any
		};
	}

	function pickHighlight(color: HighlightColor | null): void {
		if (!editor) return;
		setHighlight(color)(editor.state, editor.view.dispatch);
		if (color && color !== app.settings.highlightColor)
			app.updateSettings({ highlightColor: color });
		editor.view.focus();
	}

	interface InsertAction {
		id: InsertItem;
		label: string;
		icon: IconName;
		hint?: string;
		/** Its popup is open. */
		on: boolean;
		run(anchor: HTMLElement, from: PopupFrom): void;
	}

	/**
	 * Image / table / highlight while editing. Settings → Toolbar makes each a
	 * button (header with a mouse, formatting toolbar on touch) or a row of Insert.
	 */
	const inserts = $derived.by((): InsertAction[] => {
		if (!editable) return [];
		const all: InsertAction[] = [];
		if (platform.saveAsset)
			all.push({ id: 'image', label: 'Image', icon: 'image', on: false, run: pickImage });
		all.push({ id: 'table', label: 'Table', icon: 'table', on: !!tableAt, run: openTable });
		if (highlights)
			all.push({
				id: 'highlight',
				label: 'Highlight',
				icon: 'highlight',
				hint: keys('⌘⇧H', 'Ctrl+Shift+H'),
				on: !!highlightPick?.open,
				run: openHighlight
			});
		return all;
	});
	const promoted = $derived(inserts.filter((a) => app.barSpot(a.id) === 'bar'));
	const grouped = $derived(inserts.filter((a) => app.barSpot(a.id) === 'menu'));

	/** Insert actions as menu rows; their popups open under the menu's button. */
	function insertRows(list: InsertAction[], anchor: () => HTMLElement | null): MenuItem[] {
		return list.map((a, i) => ({
			label: `${a.label}…`,
			icon: a.icon,
			hint: a.hint,
			divider: i > 0 && a.id === 'highlight',
			action: () => {
				const el = anchor();
				if (el) a.run(el, { above: false, toggle: false });
			}
		}));
	}

	/** The touch toolbar's side of an insert action: popups open above it. */
	const toolAction = (a: InsertAction): ToolAction => ({
		label: a.label,
		icon: a.icon,
		popup: a.id !== 'image',
		on: a.on,
		do: (anchor, fromMenu) => a.run(anchor, { above: true, toggle: !fromMenu })
	});

	const headerInsertItems = $derived(insertRows(grouped, () => insertBtn));

	// --- the bar: what sits in it, what waits in ⋯ (Settings → Toolbar) ----------

	const noteApplies = (id: NoteItem): boolean =>
		id === 'edit' ? !locked : id === 'ai' ? app.settings.ai : id === 'trash' ? !!activeMeta : true;

	/** Buttons placed in the bar, in order. Touch keeps insert actions in the formatting toolbar. */
	const wanted = $derived.by((): BarItem[] => {
		const ids: BarItem[] = [];
		if (!app.touch) {
			if (grouped.length && app.barSpot('insert') === 'bar') ids.push('insert');
			ids.push(...promoted.map((a) => a.id));
		}
		ids.push(...NOTE_ITEMS.filter((id) => noteApplies(id) && app.barSpot(id) === 'bar'));
		return ids;
	});
	/** Insert placed in ⋯ (mouse): its rows go straight in. */
	const insertInMore = $derived(
		!app.touch && grouped.length > 0 && app.barSpot('insert') === 'menu'
	);
	const noteMenu = $derived(
		NOTE_ITEMS.filter((id) => noteApplies(id) && app.barSpot(id) === 'menu')
	);

	/** Rough button widths (px), to fold what doesn't fit into ⋯ instead of clipping it. */
	function barWidth(id: BarItem): number {
		const t = app.touch;
		if (id === 'edit') return editable ? (t ? 88 : 32) : t ? 84 : 72;
		if (id === 'dir') return t ? 44 : 40;
		return t ? 44 : 30;
	}

	/** How many of `wanted` fit; beside the crumb, which keeps room for the file name. */
	const fit = $derived.by(() => {
		if (!headW) return wanted.length;
		const budget = compact ? headW - 16 : headW - 34 - 12 - (app.touch ? 160 : 120);
		const menu = (compact && fileItems.length > 0) || insertInMore || noteMenu.length > 0;
		return fitBar(wanted.map(barWidth), budget, app.touch ? 44 : 30, 4, menu);
	});
	const onBar = $derived(wanted.slice(0, fit));
	const folded = $derived(wanted.slice(fit));

	/** ⋯: the file actions on phones (no crumb), then whatever isn't on the bar. */
	const moreItems = $derived.by((): MenuItem[] => {
		const groups: MenuItem[][] = [];
		if (compact) groups.push(fileItems);
		groups.push(
			insertRows(
				inserts.filter(
					(a) =>
						folded.includes(a.id) ||
						(!app.touch && grouped.includes(a) && !onBar.includes('insert'))
				),
				() => moreBtn
			)
		);
		const notes = NOTE_ITEMS.filter((id) => noteMenu.includes(id) || folded.includes(id));
		groups.push(notes.filter((id) => id !== 'trash').map(noteRow));
		if (notes.includes('trash')) groups.push([noteRow('trash')]);
		return groups
			.filter((g) => g.length)
			.flatMap((g, i) => g.map((item, j) => (i && !j ? { ...item, divider: true } : item)));
	});
	const customize: MenuItem = {
		label: 'Customize toolbar…',
		icon: 'toolbar',
		divider: true,
		action: () => app.openSettings('toolbar')
	};

	function onBarContext(e: MouseEvent): void {
		if (app.touch) return;
		e.preventDefault();
		const id = (e.target as Element).closest<HTMLElement>('[data-bar]')?.dataset.bar;
		barMenu = { at: { x: e.clientX, y: e.clientY }, id: (id as BarItem | undefined) ?? null };
	}

	const barMenuItems = $derived.by((): MenuItem[] => {
		const id = barMenu?.id;
		return [
			...(id
				? [
						{
							label: `Move “${BAR_LABELS[id]}” to ${isInsertItem(id) ? 'Insert' : 'the menu'}`,
							icon: 'more' as const,
							action: () => app.setBarSpot(id, 'menu')
						}
					]
				: []),
			{ ...customize, divider: !!id }
		];
	});

	/** Insert buttons keep the editor's focus (and the touch keyboard). */
	const keepFocus = (e: PointerEvent) => e.preventDefault();

	function openInsert(): void {
		if (insertAt) {
			insertAt = null;
			return;
		}
		const r = insertBtn!.getBoundingClientRect();
		insertAt = { x: r.right - 200, y: r.bottom + 6 };
	}

	const dur = reducedMotion() ? 0 : 1;
</script>

{#snippet barButton(id: BarItem)}
	{#if id === 'insert'}
		<button
			bind:this={insertBtn}
			data-bar="insert"
			class={[
				'act icon',
				{
					on:
						!!insertAt ||
						(!!insertBtn && tableAt?.anchor === insertBtn) ||
						(!!highlightPick?.open && highlightPick.anchor === insertBtn)
				}
			]}
			title="Insert {grouped.map((a) => a.label.toLowerCase()).join(', ')}"
			aria-label="Insert"
			aria-haspopup="menu"
			aria-expanded={!!insertAt}
			onclick={openInsert}
		>
			<Icon name="plus" size={17} stroke={1.8} />
		</button>
	{:else if id === 'image'}
		<button
			data-bar="image"
			class="act icon"
			title="Insert image"
			aria-label="Insert image"
			onpointerdown={keepFocus}
			onclick={pickImage}
		>
			<Icon name="image" size={16} stroke={1.7} />
		</button>
	{:else if id === 'table'}
		{@const open = !!tableBtn && tableAt?.anchor === tableBtn}
		<button
			bind:this={tableBtn}
			data-bar="table"
			class={['act icon', { on: open }]}
			title="Insert table"
			aria-label="Insert table"
			aria-haspopup="dialog"
			aria-expanded={open}
			onpointerdown={keepFocus}
			onclick={() => tableBtn && openTable(tableBtn, { above: false, toggle: true })}
		>
			<Icon name="table" size={16} stroke={1.7} />
		</button>
	{:else if id === 'highlight'}
		{@const open = !!highlightBtn && !!highlightPick?.open && highlightPick.anchor === highlightBtn}
		<button
			bind:this={highlightBtn}
			data-bar="highlight"
			class={['act icon', { on: open }]}
			title="Highlight ({mac ? '⌘⇧H' : 'Ctrl+Shift+H'})"
			aria-label="Highlight"
			aria-haspopup="true"
			aria-expanded={open}
			onpointerdown={keepFocus}
			onclick={() => highlightBtn && openHighlight(highlightBtn, { above: false, toggle: true })}
		>
			<Icon name="highlight" size={16} stroke={1.7} />
		</button>
	{:else if id === 'edit'}
		{#if editable}
			<button
				data-bar="edit"
				class="act mode"
				title="View mode (Mod+Shift+E): read without editing"
				aria-label="Done editing"
				onclick={() => app.setEditing(false)}
			>
				{#if app.touch}<Icon name="check" size={17} /><span>Done</span>{:else}<Icon
						name="eye"
						size={16}
					/>{/if}
			</button>
		{:else}
			<button
				data-bar="edit"
				class="act mode edit"
				title="Edit (Mod+Shift+E) · double-tap text to edit there"
				aria-label="Edit note"
				onclick={() => startEditing()}
			>
				<Icon name="edit" size={16} /><span>Edit</span>
			</button>
		{/if}
	{:else if id === 'ai'}
		<button
			data-bar="ai"
			class={['act ai', { on: app.harnessOpen }]}
			title="AI harness (Mod+J)"
			aria-label="Toggle AI harness"
			onclick={() => app.toggleHarness()}
		>
			AI
		</button>
	{:else if id === 'pin'}
		<button
			data-bar="pin"
			class={['act icon pin', { on: activeMeta?.pinned }]}
			title={activeMeta?.pinned ? 'Unpin note' : 'Pin note'}
			aria-label="Toggle pin"
			aria-pressed={!!activeMeta?.pinned}
			onclick={() => app.activeId && app.togglePin(app.activeId)}
		>
			<Icon name="pin" size={16} stroke={1.7} />
		</button>
	{:else if id === 'dir'}
		<button
			data-bar="dir"
			class="act dir"
			title="Text direction (LTR / RTL)"
			aria-label="Toggle text direction"
			disabled={locked}
			onclick={toggleDir}
		>
			{dir === 'rtl' ? 'RTL' : 'LTR'}
		</button>
	{:else if id === 'lock'}
		<button
			data-bar="lock"
			class={['act icon lock', { on: locked }]}
			title={locked ? 'Unlock note' : 'Lock note'}
			aria-label="Toggle lock"
			aria-pressed={locked}
			onclick={() => app.activeId && app.toggleLock(app.activeId)}
		>
			<Icon name={locked ? 'lock' : 'unlock'} size={16} stroke={1.7} />
		</button>
	{:else if id === 'changes'}
		<button
			data-bar="changes"
			class={['act icon', { dot: !!change }]}
			title={change ? 'Changed since the last sync — show diff' : 'Changes'}
			aria-label="Show changes"
			onclick={() => app.showChanges(app.activeId)}
		>
			<Icon name="diff" size={16} stroke={1.7} />
		</button>
	{:else if id === 'trash'}
		<button
			data-bar="trash"
			class="act icon del"
			title={locked ? 'Unlock the note to delete it' : 'Delete note'}
			aria-label="Delete note"
			disabled={locked}
			onclick={deleteNote}
		>
			<Icon name="trash" size={16} stroke={1.7} />
		</button>
	{/if}
{/snippet}

<section
	class={['editor-pane', { 'is-rtl': dir === 'rtl', compact, viewing: !editable }]}
	data-mode={editable ? 'edit' : 'view'}
>
	{#if app.settings.tabs && app.workspace && app.tabs.length}
		<NoteTabs />
	{/if}
	{#if !app.workspace}
		<div class="placeholder-screen" in:fade={{ duration: 150 * dur }}>
			<EmptyState
				src={logo}
				alt="fr5a"
				title="Welcome"
				body="Choose a folder of Markdown files to begin. Your files stay yours — on disk, in plain text."
			>
				{#snippet action()}
					<button class="cta" onclick={() => app.pickWorkspace()}>Choose folder…</button>
				{/snippet}
			</EmptyState>
		</div>
	{:else if !app.activeId && !app.draft}
		<div class="placeholder-screen" in:fade={{ duration: 150 * dur }}>
			<EmptyState
				src={mascotNew}
				title="Nothing open"
				body="Pick a note from the list, or start a fresh one."
			>
				{#snippet action()}
					<button class="cta" onclick={() => app.createNote()}>New note</button>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<header class={['editor-head', { scrolled }]} bind:clientWidth={headW}>
			{#if !compact}
				<div class="crumb">
					{#if fileItems.length}
						<button
							bind:this={crumbBtn}
							class={['crumb-btn', { on: !!crumbAt }]}
							title="{app.activeId ?? 'New note'} — {activeMeta ? 'rename or move' : 'encryption'}"
							aria-label="File: {app.activeId ?? 'New note'}. {activeMeta
								? 'Rename or move'
								: 'Encryption'}"
							aria-haspopup="menu"
							aria-expanded={!!crumbAt}
							onclick={openCrumb}
						>
							{#if crumb.dir && !narrow}<span class="cdir">{crumb.dir} /</span>{/if}
							<span class="cname">{crumb.name}</span>
							<span class="caret-down" aria-hidden="true"><Icon name="chevron" size={11} /></span>
						</button>
					{:else}
						<span class="cname">{crumb.name}</span>
					{/if}
					<!-- Narrow headers keep the file name: badges fold to their icon, and
					     "Viewing" goes (the Edit button already says it). -->
					{#if app.activeEncrypted}<span
							class="state shield"
							title="Encrypted — saved and synced as ciphertext only your key opens"
							><Icon name="key" size={10} stroke={2.2} />{#if !narrow}Encrypted{/if}</span
						>{/if}
					{#if hiddenAi}<span
							class="state shield"
							title="Hidden from cloud AI — only local providers can read this note"
							><Icon name="shield" size={10} stroke={2.2} />{#if !narrow}Local AI only{/if}</span
						>{/if}
					{#if locked}<span class="state" title="Locked"
							>{#if narrow}<Icon name="lock" size={10} stroke={2.2} />{:else}Locked{/if}</span
						>{:else if !editable && !narrow}<span class="state">Viewing</span>{/if}
				</div>
			{/if}
			<!-- Right-click moves a button into its menu (mouse); Settings → Toolbar does the rest. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="editor-actions" oncontextmenu={onBarContext}>
				{#each onBar as id (id)}
					{@render barButton(id)}
				{/each}
				{#if moreItems.length}
					<button
						bind:this={moreBtn}
						class={['act icon', { on: !!moreAt }]}
						title="More"
						aria-label="More actions"
						aria-haspopup="menu"
						aria-expanded={!!moreAt}
						onclick={openMore}
					>
						<Icon name="more" size={18} />
					</button>
				{/if}
			</div>
		</header>

		<div class="editor-body">
			{#key editorKey}
				<!-- Double-tap to edit is a shortcut; the Edit button / Mod+Shift+E is the accessible path. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="scroll"
					bind:this={scroller}
					onscroll={() => (scrolled = (scroller?.scrollTop ?? 0) > 4)}
					ondblclick={onDoubleClick}
					in:fly={{ y: 12, duration: 190 * dur }}
				>
					<div class="mount" style:direction={dir} {@attach mount} {@attach followEditable}></div>
				</div>
			{/key}

			{#if vimOn && editable}
				<div
					class={[
						'vim-badge',
						{
							insert: vimMode === 'insert',
							visual: vimMode === 'visual' || vimMode === 'visual-line'
						}
					]}
				>
					{vimMode === 'visual-line' ? 'V-LINE' : vimMode.toUpperCase()}
				</div>
			{/if}
		</div>

		{#if app.touch && editor && editable}
			<FormatToolbar {editor} buttons={promoted.map(toolAction)} insert={grouped.map(toolAction)} />
		{/if}
		<input
			bind:this={imageInput}
			class="file-input"
			type="file"
			accept="image/*"
			multiple
			tabindex="-1"
			aria-hidden="true"
			onchange={onImagePicked}
		/>
	{/if}
</section>

{#if crumbAt}
	<ActionMenu
		items={fileItems}
		at={crumbAt}
		title={activeMeta?.title ?? 'Note'}
		label="File actions"
		trigger={crumbBtn}
		onclose={() => (crumbAt = null)}
	/>
{/if}

{#if insertAt}
	<ActionMenu
		items={headerInsertItems}
		at={insertAt}
		title="Insert"
		label="Insert"
		trigger={insertBtn}
		onclose={() => (insertAt = null)}
	/>
{/if}

{#if tableAt}
	<TablePicker
		at={tableAt}
		sheet={tableAt.sheet}
		trigger={tableAt.toggle ? tableAt.anchor : null}
		onpick={(cols, rows) => editor && insertTable(editor.view, cols, rows)}
		onclose={() => (tableAt = null)}
	/>
{/if}

{#if highlightPick?.open}
	<HighlightPicker
		at={highlightPick.at}
		above={highlightPick.above}
		current={highlightPick.color}
		any={highlightPick.any}
		focus={!app.touch}
		trigger={highlightPick.toggle ? highlightPick.anchor : null}
		onpick={pickHighlight}
		onclose={() => highlightPick && (highlightPick.open = false)}
	/>
{/if}

{#if moreAt}
	<ActionMenu
		items={[...moreItems, customize]}
		at={moreAt}
		sheet={compact}
		title={activeMeta?.title ?? 'Note'}
		label="Note actions"
		trigger={moreBtn}
		onclose={() => (moreAt = null)}
	/>
{/if}

{#if barMenu}
	<ActionMenu
		items={barMenuItems}
		at={barMenu.at}
		label="Toolbar"
		onclose={() => (barMenu = null)}
	/>
{/if}

<style>
	.editor-pane {
		flex: 1;
		min-width: 0;
		height: 100%;
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--bg-editor);
		border-radius: 12px;
		box-shadow: var(--shadow-pane);
		overflow: hidden;
	}
	.editor-pane.compact {
		border-radius: 0;
		box-shadow: none;
	}

	/* --- header: its own strip, so scrolled text never runs under the buttons */
	.editor-head {
		flex: 0 0 auto;
		position: relative;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		padding: 6px 12px 6px 22px;
		background: var(--bg-editor);
		transition: box-shadow var(--dur-pane) ease;
	}
	.compact .editor-head {
		min-height: 52px;
		padding: 4px 6px 4px 10px;
	}
	.editor-head.scrolled {
		box-shadow: 0 1px 0 var(--bg-hover);
	}
	.crumb {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 5px;
		font-size: 12px;
		color: var(--text-faint);
		white-space: nowrap;
		overflow: hidden;
	}
	.crumb-btn {
		flex: 0 1 auto;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 5px;
		margin: -3px -6px;
		padding: 3px 6px;
		border-radius: 6px;
		font-size: inherit;
		color: inherit;
		transition: background var(--dur-fast) ease;
	}
	.crumb-btn:hover,
	.crumb-btn.on {
		background: var(--bg-hover);
	}
	.caret-down {
		align-self: center;
		transform: rotate(90deg);
		opacity: 0;
		transition: opacity var(--dur-fast) ease;
	}
	.crumb-btn:hover .caret-down,
	.crumb-btn:focus-visible .caret-down,
	.crumb-btn.on .caret-down {
		opacity: 1;
	}
	.state.shield {
		color: var(--accent);
		background: var(--accent-soft);
	}
	.cdir {
		flex: 0 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cname {
		flex: 0 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-muted);
		font-weight: 500;
	}
	.state {
		flex: 0 0 auto;
		align-self: center;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		margin-inline-start: 4px;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--bg-hover);
		font-size: 10.5px;
		font-weight: 600;
		color: var(--text-muted);
	}
	.editor-actions {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 4px;
		margin-inline-start: auto;
	}

	.editor-body {
		flex: 1;
		min-height: 0;
		position: relative;
	}
	.scroll {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		padding: 4px 40px 0;
	}
	.compact .scroll {
		padding: 2px 18px 0;
	}
	.viewing .scroll {
		cursor: default;
	}
	.viewing :global(.ProseMirror) {
		caret-color: transparent;
	}

	.act {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		height: 30px;
		min-width: 30px;
		border-radius: 8px;
		color: var(--text-faint);
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .act {
		height: 44px;
		min-width: 44px;
	}
	.act:active:not(:disabled) {
		transform: scale(0.94);
	}
	.act.pin.on {
		color: #e0a520;
	}
	.act.lock.on {
		color: var(--accent);
	}
	.act.dot::after {
		content: '';
		position: absolute;
		top: 5px;
		right: 5px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}
	:global(html[data-touch]) .act.dot::after {
		top: 10px;
		right: 10px;
	}
	.act:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.act:disabled:hover {
		background: none;
		color: var(--text-faint);
	}
	.act.ai {
		padding: 0 8px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.act.ai.on,
	.act.icon.on {
		color: var(--accent);
	}
	.act.dir {
		padding: 0 9px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.03em;
	}
	.act.mode {
		padding: 0 8px;
		font-size: 13px;
		font-weight: 600;
	}
	.act.mode.edit {
		padding: 0 12px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	:global(html[data-touch]) .act.mode {
		padding: 0 14px;
		font-size: 15px;
	}
	.act:hover:not(:disabled) {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.vim-badge {
		position: absolute;
		bottom: 12px;
		left: 16px;
		z-index: 5;
		padding: 3px 9px;
		border-radius: 6px;
		font-family: var(--font-mono);
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: #fff;
		background: var(--text-muted);
	}
	.vim-badge.insert {
		background: var(--accent);
	}
	.vim-badge.visual {
		background: #7c6ff0;
	}
	.file-input {
		display: none;
	}
	.placeholder-screen {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}
	.cta {
		margin-top: 14px;
		padding: 9px 18px;
		border-radius: 9px;
		background: var(--accent);
		color: #fff;
		font-size: 13.5px;
		font-weight: 600;
		transition:
			filter var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .cta {
		min-height: 44px;
		font-size: 15px;
	}
	.cta:hover {
		filter: brightness(1.05);
	}
	.cta:active {
		transform: scale(0.97);
	}
</style>
