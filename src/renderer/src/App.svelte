<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { Spring } from 'svelte/motion';
	import { getAppState, PANE_WIDTHS, type Pane, type PaneName } from './lib/stores/app.svelte';
	import TitleBar from './lib/components/TitleBar.svelte';
	import Sidebar from './lib/components/Sidebar.svelte';
	import NoteList from './lib/components/NoteList.svelte';
	import Editor from './lib/components/Editor.svelte';
	import Settings from './lib/components/Settings.svelte';
	import Changes from './lib/components/Changes.svelte';
	import CheatSheet from './lib/components/CheatSheet.svelte';
	import NoteContextMenu from './lib/components/NoteContextMenu.svelte';
	import ConfirmDialog from './lib/components/ConfirmDialog.svelte';
	import FolderContextMenu from './lib/components/FolderContextMenu.svelte';
	import PromptDialog from './lib/components/PromptDialog.svelte';
	import MoveDialog from './lib/components/MoveDialog.svelte';
	import Notice from './lib/components/Notice.svelte';
	import ConflictWindow from './lib/components/ConflictWindow.svelte';
	import Resizer from './lib/components/Resizer.svelte';
	import { platform } from './lib/platform';
	import { layoutFor } from './lib/layout';
	import { reducedMotion } from './lib/portal';

	const app = getAppState();
	const dur = reducedMotion() ? 0 : 1;
	/** Narrowest the editor may get while panes are dragged wider. */
	const EDITOR_MIN = 320;

	// The harness pane's code is loaded on first open, then stays mounted.
	const harnessModule = $derived(
		app.harnessLoaded && app.settings.ai
			? import('./lib/components/harness/HarnessPane.svelte')
			: null
	);

	// Spring-driven widths so toggling/Zen feels physical, not linear.
	const sidebarWidth = new Spring(app.widths.sidebar, { stiffness: 0.16, damping: 0.72 });
	const listWidth = new Spring(app.widths.list, { stiffness: 0.16, damping: 0.74 });
	const harnessWidth = new Spring(0, { stiffness: 0.16, damping: 0.74 });

	const desktop = $derived(app.layout === 'desktop');
	const tablet = $derived(app.layout === 'tablet');
	const phone = $derived(app.layout === 'phone');

	// In Zen mode the sidebar and note list animate away, centring the editor.
	const showSidebar = $derived(app.sidebarOpen && !app.zen);
	const showList = $derived(app.listOpen && !app.zen);

	let winW = $state(window.innerWidth);
	/**
	 * Desktop widths actually used. With the AI pane open on a narrow window (a
	 * landscape tablet) the editor keeps EDITOR_MIN: the sidebar steps aside
	 * first, then the AI pane narrows toward its minimum, then the list steps
	 * aside. Nothing is persisted — closing the AI pane brings them back.
	 */
	const fit = $derived.by(() => {
		let side = showSidebar ? app.widths.sidebar : 0;
		let list = showList ? app.widths.list : 0;
		let ai = app.widths.harness;
		if (!desktop || !app.harnessOpen) return { side, list, ai };
		const room = winW - EDITOR_MIN - 40;
		if (side + list + ai > room) side = 0;
		if (list + ai > room) ai = Math.max(PANE_WIDTHS.harness.min, room - list);
		if (list + ai > room) list = 0;
		return { side, list, ai };
	});
	const overlay = $derived(app.view !== 'editor');

	// Which panes are on screen for the current layout. Every pane stays mounted
	// across layouts (only CSS changes), so rotating keeps the editor + caret.
	const sidebarShown = $derived(
		desktop ? fit.side > 0 : tablet ? app.drawerOpen : app.pane === 'nav'
	);
	const listShown = $derived(phone ? app.pane === 'list' : fit.list > 0);
	const editorShown = $derived(phone ? app.pane === 'editor' : true);
	const harnessShown = $derived(phone ? app.pane === 'harness' : app.harnessOpen);

	// Phones: panes sit side by side in this order and slide; the one on
	// screen is "current", earlier ones wait to the left, later to the right.
	const ORDER: Record<Pane, number> = { nav: 0, list: 1, editor: 2, harness: 3 };
	function pos(p: Pane): 'before' | 'current' | 'after' | undefined {
		if (!phone) return undefined;
		const d = ORDER[p] - ORDER[app.pane];
		return d < 0 ? 'before' : d > 0 ? 'after' : 'current';
	}

	function follow(spring: Spring<number>, w: number): void {
		// While an edge is dragged the pane tracks the pointer exactly.
		if (app.resizing) void spring.set(w, { instant: true });
		else spring.target = w;
	}
	$effect(() => follow(sidebarWidth, fit.side));
	$effect(() => follow(listWidth, fit.list));
	$effect(() => follow(harnessWidth, app.harnessOpen ? fit.ai : 0));

	/** Resize one pane, keeping at least EDITOR_MIN for the editor. */
	function resize(pane: PaneName, px: number): void {
		const others =
			(pane !== 'sidebar' && showSidebar ? app.widths.sidebar : 0) +
			(pane !== 'list' && showList ? app.widths.list : 0) +
			(pane !== 'harness' && app.harnessOpen && desktop ? app.widths.harness : 0);
		const room = window.innerWidth - others - EDITOR_MIN - 40;
		app.setWidth(pane, Math.min(px, Math.max(PANE_WIDTHS[pane].min, room)));
	}

	// --- tablet AI sheet: drag the handle between half and full height -------
	let sheetEl = $state<HTMLDivElement | null>(null);
	let sheetDrag: { y: number; h: number; id: number; moved: boolean } | null = null;
	let sheetH = $state<number | null>(null);

	function sheetDown(e: PointerEvent): void {
		if (!sheetEl) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		sheetDrag = { y: e.clientY, h: sheetEl.offsetHeight, id: e.pointerId, moved: false };
	}
	function sheetMove(e: PointerEvent): void {
		if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
		const dy = e.clientY - sheetDrag.y;
		if (Math.abs(dy) > 6) sheetDrag.moved = true;
		if (sheetDrag.moved) sheetH = Math.max(120, sheetDrag.h - dy);
	}
	function sheetUp(e: PointerEvent): void {
		if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
		const parent = sheetEl?.parentElement?.offsetHeight ?? window.innerHeight;
		if (!sheetDrag.moved) app.sheetExpanded = !app.sheetExpanded;
		else if (sheetH !== null) {
			const frac = sheetH / parent;
			// Snap: closed below a third, else whichever height is nearer.
			if (frac < 0.33) app.closeHarness();
			else app.sheetExpanded = frac > 0.75;
		}
		sheetDrag = null;
		sheetH = null;
	}

	function onKeydown(e: KeyboardEvent): void {
		const mod = e.metaKey || e.ctrlKey;
		// Mod+/ toggles the shortcuts cheat sheet from anywhere.
		if (mod && e.key === '/') {
			e.preventDefault();
			app.toggleCheatSheet();
			return;
		}
		// Mod+N creates a new note.
		if (mod && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
			e.preventDefault();
			app.createNote();
			return;
		}
		// Tabs: Mod+W closes the current one (never the window), Ctrl+Tab steps through them.
		if (app.settings.tabs && mod && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
			e.preventDefault();
			if (app.tabIndex >= 0) void app.closeTab(app.tabIndex);
			return;
		}
		if (app.settings.tabs && e.ctrlKey && e.key === 'Tab') {
			e.preventDefault();
			app.cycleTab(e.shiftKey ? -1 : 1);
			return;
		}
		// Mod+P pins / unpins the active note.
		if (mod && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
			if (!app.activeId) return;
			e.preventDefault();
			app.togglePin(app.activeId);
			return;
		}
		// Mod+J toggles the AI harness pane.
		if (mod && !e.shiftKey && (e.key === 'j' || e.key === 'J') && app.settings.ai) {
			e.preventDefault();
			app.toggleHarness();
			return;
		}
		// Mod+Shift+L shows / hides the note list.
		if (mod && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
			e.preventDefault();
			app.toggleList();
			return;
		}
		// Mod+Shift+E switches the open note between view and edit mode.
		if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
			if (!app.activeId && !app.draft) return;
			e.preventDefault();
			app.toggleEditing();
			if (app.editing) app.editor?.commands.focus();
			return;
		}
		// Mod+Shift+K locks encrypted notes.
		if (mod && e.shiftKey && (e.key === 'k' || e.key === 'K') && app.vault?.unlocked) {
			e.preventDefault();
			app.lockVault();
			return;
		}
		// Mod+\ toggles Zen mode.
		if (mod && e.key === '\\') {
			e.preventDefault();
			app.toggleZen();
			return;
		}
		// Mod+, opens/closes Settings.
		if (mod && e.key === ',') {
			e.preventDefault();
			app.toggleSettings();
			return;
		}
		// Escape closes the cheat sheet first, then leaves Settings / Changes / Zen.
		if (e.key === 'Escape') {
			if (app.cheatSheetOpen) app.toggleCheatSheet();
			else if (app.swipeOpen) app.swipeOpen = null;
			else if (app.view !== 'editor') app.setView('editor');
			else if (app.zen) app.toggleZen();
		}
	}

	// Layout follows width + input type: touch devices (Android, coarse pointer)
	// get phone / tablet layouts; mouse windows stay desktop at any width.
	$effect(() => {
		const coarse = matchMedia('(pointer: coarse)');
		const update = () => {
			const touch = platform.platform === 'android' || coarse.matches;
			winW = window.innerWidth;
			app.setLayout(layoutFor(window.innerWidth, touch), touch);
		};
		update();
		window.addEventListener('resize', update);
		coarse.addEventListener('change', update);
		return () => {
			window.removeEventListener('resize', update);
			coarse.removeEventListener('change', update);
		};
	});

	app.init();
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app" class:zen={app.zen} class:resizing={app.resizing}>
	<TitleBar />
	<!-- The body renders only once init() has restored the workspace, settings
	     and last-open note, then fades in — no flash from empty to full. -->
	{#if app.booted}
		<div
			class="body layout-{app.layout}"
			class:drawer-open={app.drawerOpen}
			class:harness-open={app.harnessOpen}
			class:sheet-expanded={app.sheetExpanded}
			class:overlay
			data-layout={app.layout}
			data-pane={phone ? (overlay ? app.view : app.pane) : undefined}
			style:--sidebar-w="{app.widths.sidebar}px"
			style:--list-w="{app.widths.list}px"
			style:--harness-w="{fit.ai}px"
			in:fade={{ duration: 220 * dur }}
		>
			<div
				class="sidebar-wrap"
				data-pos={pos('nav')}
				style:width={desktop ? `${sidebarWidth.current}px` : null}
				aria-hidden={!sidebarShown}
				inert={!sidebarShown || (phone && overlay)}
			>
				<Sidebar />
			</div>
			{#if desktop && fit.side > 0}
				<Resizer
					value={app.widths.sidebar}
					min={PANE_WIDTHS.sidebar.min}
					max={PANE_WIDTHS.sidebar.max}
					label="Resize sidebar"
					onresize={(px) => resize('sidebar', px)}
					onreset={() => app.resetWidth('sidebar')}
				/>
			{/if}
			{#if tablet && app.drawerOpen}
				<button
					class="scrim"
					aria-label="Close folders"
					onclick={() => app.toggleDrawer()}
					transition:fade={{ duration: 200 * dur }}
				></button>
			{/if}
			<main class="content">
				<div
					class="list-wrap"
					data-pos={pos('list')}
					style:width={phone ? null : `${listWidth.current}px`}
					aria-hidden={!listShown || overlay}
					inert={!listShown || overlay}
				>
					<NoteList />
				</div>
				{#if !phone && fit.list > 0}
					<Resizer
						value={app.widths.list}
						min={PANE_WIDTHS.list.min}
						max={PANE_WIDTHS.list.max}
						label="Resize note list"
						onresize={(px) => resize('list', px)}
						onreset={() => app.resetWidth('list')}
					/>
				{/if}
				<div
					class="editor-wrap"
					data-pos={pos('editor')}
					aria-hidden={!editorShown || overlay}
					inert={!editorShown || overlay}
				>
					<Editor />
				</div>
				{#if overlay}
					<div
						class="view-overlay"
						in:fly={phone
							? { x: 48, duration: 200 * dur, opacity: 0 }
							: { y: 8, duration: 180 * dur }}
						out:fade={{ duration: 120 * dur }}
					>
						{#if app.view === 'settings'}
							<Settings />
						{:else}
							<Changes />
						{/if}
					</div>
				{/if}
			</main>
			{#if tablet && app.harnessOpen}
				<button
					class="scrim sheet-scrim"
					aria-label="Close AI"
					onclick={() => app.closeHarness()}
					transition:fade={{ duration: 200 * dur }}
				></button>
			{/if}
			{#if desktop && app.harnessOpen}
				<Resizer
					value={app.widths.harness}
					min={PANE_WIDTHS.harness.min}
					max={PANE_WIDTHS.harness.max}
					edge="start"
					label="Resize AI pane"
					onresize={(px) => resize('harness', px)}
					onreset={() => app.resetWidth('harness')}
				/>
			{/if}
			<div
				bind:this={sheetEl}
				class="harness-wrap"
				class:dragging={sheetH !== null}
				data-pos={pos('harness')}
				style:width={desktop ? `${harnessWidth.current}px` : null}
				style:height={tablet && sheetH !== null ? `${sheetH}px` : null}
				aria-hidden={!harnessShown}
				inert={!harnessShown}
			>
				{#if tablet}
					<div
						class="sheet-handle"
						role="button"
						tabindex="0"
						aria-label={app.sheetExpanded ? 'Shrink AI sheet' : 'Expand AI sheet'}
						onpointerdown={sheetDown}
						onpointermove={sheetMove}
						onpointerup={sheetUp}
						onpointercancel={sheetUp}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								app.sheetExpanded = !app.sheetExpanded;
							}
						}}
					>
						<span></span>
					</div>
				{/if}
				{#if harnessModule}
					{#await harnessModule then m}
						<m.default />
					{/await}
				{/if}
			</div>
		</div>
	{:else}
		<div class="body"></div>
	{/if}

	{#if app.cheatSheetOpen}
		<CheatSheet />
	{/if}

	<NoteContextMenu />
	<FolderContextMenu />
	<MoveDialog />
	<PromptDialog />
	<ConfirmDialog />
	<Notice />

	{#if app.conflictOpen}
		<!-- Same resolver the desktop opens as a second window; closes on sync done. -->
		<div class="conflict-overlay" transition:fade={{ duration: 160 * dur }}>
			<ConflictWindow />
		</div>
	{/if}
</div>

<style>
	.conflict-overlay {
		position: fixed;
		inset: 0;
		z-index: 50;
		overflow: auto;
		background: var(--bg-primary);
	}
	.app {
		display: flex;
		flex-direction: column;
		height: 100%;
		/* Android edge-to-edge: keep the top bar clear of the status bar (0 on desktop). */
		padding-top: env(safe-area-inset-top, 0px);
	}
	.app.resizing {
		cursor: col-resize;
		user-select: none;
	}
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
		position: relative;
		/* Off-screen drawers / sheets (translated out of view) must never become
		   scroll offset: `clip` (unlike `hidden`) can't be scrolled by focus or
		   scrollIntoView. Chromium 90+, so fine for the oldest Android WebView. */
		overflow: hidden;
		overflow: clip;
	}
	.sidebar-wrap {
		flex: 0 0 auto;
		overflow: hidden;
		min-width: 0;
	}
	.content {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 10px;
		padding: 0 10px 10px;
	}
	/* A zero-width resizer between two flex items would double the gap. */
	.content > :global(.resizer) {
		margin: 0 -5px;
	}
	.list-wrap {
		flex: 0 0 auto;
		min-width: 0;
		overflow: hidden;
		display: flex;
	}
	.list-wrap > :global(.notelist) {
		flex: 0 0 auto;
	}
	.editor-wrap {
		flex: 1;
		min-width: 0;
		display: flex;
	}
	/* Settings / Changes cover the list + editor, which stay mounted beneath. */
	.view-overlay {
		position: absolute;
		top: 0;
		left: 10px;
		right: 10px;
		bottom: 10px;
		z-index: 8;
		display: flex;
	}
	/* Zen: the editor pane fills the whole window (its text stays centred via
	   the editor's own max-width), so it reaches edge to edge. */
	.app.zen .content {
		gap: 0;
		padding: 0;
	}
	.app.zen :global(.editor-pane) {
		border-radius: 0;
		box-shadow: none;
	}
	.app.zen .view-overlay {
		inset: 0;
	}

	/* --- tablet: list + editor; folders slide in as a drawer ------------- */
	.layout-tablet .sidebar-wrap {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		z-index: 20;
		width: min(320px, 80vw);
		background: var(--bg-primary);
		box-shadow: 8px 0 24px rgba(0, 0, 0, 0.12);
		transform: translateX(-105%);
		transition: transform var(--dur-sheet) var(--ease-out);
	}
	.layout-tablet.drawer-open .sidebar-wrap {
		transform: none;
	}
	/* The sidebar fills the drawer (its desktop width would leave a bare strip). */
	.layout-tablet .sidebar-wrap > :global(.sidebar) {
		width: 100%;
	}
	.layout-tablet .list-wrap {
		max-width: 50%;
	}
	.layout-tablet .list-wrap > :global(.notelist) {
		width: 100%;
		flex: 1 1 auto;
	}
	.scrim {
		position: absolute;
		inset: 0;
		z-index: 15;
		background: rgba(0, 0, 0, 0.22);
	}
	.sheet-scrim {
		z-index: 17;
		background: rgba(0, 0, 0, 0.14);
	}

	/* --- AI harness: side split / bottom sheet / own pane ----------------- */
	.harness-wrap {
		flex: 0 0 auto;
		min-width: 0;
		overflow: hidden;
	}
	.layout-desktop .harness-wrap {
		padding: 0 10px 10px 0;
	}
	.layout-desktop .harness-wrap > :global(.harness) {
		width: calc(var(--harness-w) - 10px);
	}
	.layout-tablet .harness-wrap {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 18;
		height: 58%;
		display: flex;
		flex-direction: column;
		padding: 0 8px;
		transform: translateY(105%);
		transition:
			transform var(--dur-sheet) var(--ease-out),
			height var(--dur-sheet) var(--ease-out);
	}
	.layout-tablet.sheet-expanded .harness-wrap {
		height: calc(100% - 12px);
	}
	.layout-tablet .harness-wrap.dragging {
		transition: none;
	}
	.layout-tablet.harness-open .harness-wrap {
		transform: none;
	}
	.layout-tablet .harness-wrap > :global(.harness) {
		flex: 1;
		min-height: 0;
		height: auto;
		border-radius: 0;
		box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.16);
	}
	.sheet-handle {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		height: 22px;
		border-radius: 16px 16px 0 0;
		background: var(--bg-editor);
		box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.12);
		touch-action: none;
		cursor: ns-resize;
	}
	.sheet-handle span {
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--text-faint);
	}

	/* --- phone: one pane on screen; the others wait off to the side -------- */
	/* `clip` as on `.body`: the off-screen panes must never become a scroll offset
	   (focusing a Settings field used to shift the whole UI sideways). */
	.layout-phone {
		overflow: hidden;
		overflow: clip;
	}
	.layout-phone .content {
		display: contents;
	}
	.layout-phone .sidebar-wrap,
	.layout-phone .list-wrap,
	.layout-phone .editor-wrap,
	.layout-phone .harness-wrap {
		position: absolute;
		inset: 0;
		display: flex;
		transition:
			transform var(--dur-pane) var(--ease-out),
			visibility 0s linear var(--dur-pane);
	}
	.layout-phone .sidebar-wrap {
		background: var(--bg-primary);
	}
	.layout-phone .sidebar-wrap > :global(.sidebar),
	.layout-phone .list-wrap > :global(.notelist),
	.layout-phone .harness-wrap > :global(.harness) {
		width: 100%;
		flex: 1 1 auto;
	}
	.layout-phone [data-pos='current'] {
		z-index: 2;
		transform: none;
		visibility: visible;
		transition:
			transform var(--dur-pane) var(--ease-out),
			visibility 0s linear 0s;
	}
	.layout-phone [data-pos='before'] {
		z-index: 1;
		transform: translateX(-28%);
		visibility: hidden;
	}
	.layout-phone [data-pos='after'] {
		z-index: 3;
		transform: translateX(100%);
		visibility: hidden;
		box-shadow: -10px 0 28px rgba(0, 0, 0, 0.12);
	}
	.layout-phone .view-overlay {
		inset: 0;
		z-index: 6;
	}
	.layout-phone .harness-wrap > :global(.harness) {
		border-radius: 0;
		box-shadow: none;
	}
</style>
