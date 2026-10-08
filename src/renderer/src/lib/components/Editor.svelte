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
	import { HighlightBehavior, toggleHighlight } from '../editor/HighlightBehavior';
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
	import FormatToolbar from './FormatToolbar.svelte';
	import ActionMenu, { type MenuItem } from './ActionMenu.svelte';
	import TablePicker from './TablePicker.svelte';
	import NoteTabs from './NoteTabs.svelte';
	import Icon from './Icon.svelte';
	import { platform } from '../platform';
	import { reducedMotion } from '../portal';
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
	let tableAt = $state<{ x: number; y: number; sheet: boolean } | null>(null);
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
	/**
	 * Too narrow for every header button (touch tablets: 44px targets beside
	 * the list): direction / lock / changes / trash fold into ⋯, so the crumb
	 * keeps room and nothing is clipped.
	 */
	const narrow = $derived(compact || (headW > 0 && headW < (app.touch ? 620 : 440)));
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
		if (highlights) extensions.push(HighlightBehavior);
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

	const moreItems = $derived.by((): MenuItem[] => [
		...fileItems,
		{
			label: dir === 'rtl' ? 'Left-to-right text' : 'Right-to-left text',
			icon: 'dir',
			hint: dir.toUpperCase(),
			disabled: locked,
			divider: fileItems.length > 0,
			action: toggleDir
		},
		{
			label: locked ? 'Unlock note' : 'Lock note',
			icon: locked ? 'unlock' : 'lock',
			disabled: !app.activeId,
			action: () => app.activeId && app.toggleLock(app.activeId)
		},
		{
			label: change ? 'Show changes' : 'Changes',
			icon: 'diff',
			hint: change ? 'modified' : undefined,
			action: () => app.showChanges(app.activeId)
		},
		{
			label: 'Move to Trash',
			icon: 'trash',
			danger: true,
			divider: true,
			disabled: locked || !activeMeta,
			action: () => void deleteNote()
		}
	]);

	// --- Insert: image, table, highlight -----------------------------------

	function pickImage(): void {
		imageInput?.click();
	}

	function onImagePicked(): void {
		const files = [...(imageInput?.files ?? [])];
		if (imageInput) imageInput.value = '';
		if (editor && files.length) void insertImages(editor.view, files, saveImage);
	}

	/** The table size picker: below the header's Insert button, or above the touch toolbar. */
	function openTable(): void {
		const sheet = app.layout === 'phone';
		const r = (app.touch ? scroller : insertBtn)?.getBoundingClientRect();
		if (!r) return;
		// The popover flips above `y` when it wouldn't fit below.
		tableAt = app.touch
			? { x: r.left + 12, y: r.bottom - 6, sheet }
			: { x: r.right - 210, y: r.bottom + 6, sheet };
	}

	const insertItems = $derived.by((): MenuItem[] => [
		...(platform.saveAsset ? [{ label: 'Image…', icon: 'image' as const, action: pickImage }] : []),
		{
			label: 'Table…',
			icon: 'table' as const,
			action: openTable
		}
	]);

	/** Header Insert menu (mouse): the touch toolbar has its own Highlight button. */
	const headerInsertItems = $derived.by((): MenuItem[] => [
		...insertItems,
		...(highlights
			? [
					{
						label: 'Highlight',
						icon: 'highlight' as const,
						hint: platform.platform === 'darwin' ? '⌘⇧H' : 'Ctrl+Shift+H',
						divider: true,
						action: () => {
							if (!editor) return;
							toggleHighlight(editor.state, editor.view.dispatch);
							editor.view.focus();
						}
					}
				]
			: [])
	]);

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
			<div class="editor-actions">
				{#if editable && !app.touch}
					<button
						bind:this={insertBtn}
						class={['act icon', { on: !!insertAt || !!tableAt }]}
						title="Insert image, table or highlight"
						aria-label="Insert"
						aria-haspopup="menu"
						aria-expanded={!!insertAt}
						onclick={openInsert}
					>
						<Icon name="plus" size={17} stroke={1.8} />
					</button>
				{/if}
				{#if !locked}
					{#if editable}
						<button
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
							class="act mode edit"
							title="Edit (Mod+Shift+E) · double-tap text to edit there"
							aria-label="Edit note"
							onclick={() => startEditing()}
						>
							<Icon name="edit" size={16} /><span>Edit</span>
						</button>
					{/if}
				{/if}
				{#if app.settings.ai}
					<button
						class={['act ai', { on: app.harnessOpen }]}
						title="AI harness (Mod+J)"
						aria-label="Toggle AI harness"
						onclick={() => app.toggleHarness()}
					>
						AI
					</button>
				{/if}
				<button
					class={['act icon pin', { on: activeMeta?.pinned }]}
					title={activeMeta?.pinned ? 'Unpin note' : 'Pin note'}
					aria-label="Toggle pin"
					aria-pressed={!!activeMeta?.pinned}
					onclick={() => app.activeId && app.togglePin(app.activeId)}
				>
					<Icon name="pin" size={16} stroke={1.7} />
				</button>
				{#if narrow}
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
				{:else}
					<button
						class="act dir"
						title="Text direction (LTR / RTL)"
						aria-label="Toggle text direction"
						disabled={locked}
						onclick={toggleDir}
					>
						{dir === 'rtl' ? 'RTL' : 'LTR'}
					</button>
					<button
						class={['act icon lock', { on: locked }]}
						title={locked ? 'Unlock note' : 'Lock note'}
						aria-label="Toggle lock"
						aria-pressed={locked}
						onclick={() => app.activeId && app.toggleLock(app.activeId)}
					>
						<Icon name={locked ? 'lock' : 'unlock'} size={16} stroke={1.7} />
					</button>
					<button
						class={['act icon', { dot: !!change }]}
						title={change ? 'Changed since the last sync — show diff' : 'Changes'}
						aria-label="Show changes"
						onclick={() => app.showChanges(app.activeId)}
					>
						<Icon name="diff" size={16} stroke={1.7} />
					</button>
					{#if activeMeta && !locked}
						<button
							class="act icon del"
							title="Delete note"
							aria-label="Delete note"
							onclick={deleteNote}
						>
							<Icon name="trash" size={16} stroke={1.7} />
						</button>
					{/if}
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
			<FormatToolbar {editor} insert={insertItems} />
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
		trigger={insertBtn}
		onpick={(cols, rows) => editor && insertTable(editor.view, cols, rows)}
		onclose={() => (tableAt = null)}
	/>
{/if}

{#if moreAt}
	<ActionMenu
		items={moreItems}
		at={moreAt}
		sheet={compact}
		title={activeMeta?.title ?? 'Note'}
		label="Note actions"
		trigger={moreBtn}
		onclose={() => (moreAt = null)}
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
