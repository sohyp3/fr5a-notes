<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Spring } from 'svelte/motion';
	import { getAppState } from './lib/stores/app.svelte';
	import TitleBar from './lib/components/TitleBar.svelte';
	import Sidebar from './lib/components/Sidebar.svelte';
	import NoteList from './lib/components/NoteList.svelte';
	import Editor from './lib/components/Editor.svelte';
	import Settings from './lib/components/Settings.svelte';
	import CheatSheet from './lib/components/CheatSheet.svelte';
	import NoteContextMenu from './lib/components/NoteContextMenu.svelte';
	import ConflictWindow from './lib/components/ConflictWindow.svelte';
	import { platform } from './lib/platform';
	import { layoutFor } from './lib/layout';

	const app = getAppState();
	const SIDEBAR_W = 250;
	const LIST_W = 300;

	// Spring-driven widths so toggling/Zen feels physical, not linear.
	const sidebarWidth = new Spring(SIDEBAR_W, { stiffness: 0.16, damping: 0.72 });
	const listWidth = new Spring(LIST_W, { stiffness: 0.16, damping: 0.74 });

	// In Zen mode the sidebar and note list animate away, centring the editor.
	const showSidebar = $derived(app.sidebarOpen && !app.zen);
	const showList = $derived(!app.zen && app.view === 'editor');

	// Which panes are on screen for the current layout. Every pane stays mounted
	// across layouts (only CSS changes), so rotating keeps the editor + caret.
	const phonePane = $derived(app.view === 'settings' ? 'settings' : app.pane);
	const sidebarShown = $derived(
		app.layout === 'desktop'
			? showSidebar
			: app.layout === 'tablet'
				? app.drawerOpen
				: phonePane === 'nav'
	);
	const listShown = $derived(
		app.layout === 'desktop' ? showList : app.layout === 'tablet' ? !app.zen : phonePane === 'list'
	);

	$effect(() => {
		sidebarWidth.target = showSidebar ? SIDEBAR_W : 0;
	});
	$effect(() => {
		listWidth.target = showList ? LIST_W : 0;
	});

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
		// Mod+P pins / unpins the active note.
		if (mod && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
			if (!app.activeId) return;
			e.preventDefault();
			app.togglePin(app.activeId);
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
		// Escape closes the cheat sheet first, then leaves Settings / Zen.
		if (e.key === 'Escape') {
			if (app.cheatSheetOpen) app.toggleCheatSheet();
			else if (app.view === 'settings') app.setView('editor');
			else if (app.zen) app.toggleZen();
		}
	}

	// Layout follows width + input type: touch devices (Android, coarse pointer)
	// get phone / tablet layouts; mouse windows stay desktop at any width.
	$effect(() => {
		const coarse = matchMedia('(pointer: coarse)');
		const update = () => {
			const touch = platform.platform === 'android' || coarse.matches;
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

<div class="app" class:zen={app.zen}>
	<TitleBar />
	<!-- The body renders only once init() has restored the workspace, settings
	     and last-open note, then fades in — no flash from empty to full. -->
	{#if app.booted}
		<div
			class="body layout-{app.layout}"
			class:drawer-open={app.drawerOpen}
			data-layout={app.layout}
			data-pane={app.layout === 'phone' ? phonePane : undefined}
			in:fade={{ duration: 220 }}
		>
			<div
				class="sidebar-wrap"
				style:width={app.layout === 'desktop' ? `${sidebarWidth.current}px` : null}
				aria-hidden={!sidebarShown}
				inert={!sidebarShown}
			>
				<Sidebar />
			</div>
			{#if app.layout === 'tablet' && app.drawerOpen}
				<button
					class="scrim"
					aria-label="Close folders"
					onclick={() => app.toggleDrawer()}
					transition:fade={{ duration: 150 }}
				></button>
			{/if}
			<main class="content">
				{#if app.view === 'settings'}
					<Settings />
				{:else}
					<div
						class="list-wrap"
						style:width={app.layout === 'desktop' ? `${listWidth.current}px` : null}
						aria-hidden={!listShown}
						inert={!listShown}
					>
						<NoteList />
					</div>
					<Editor />
				{/if}
			</main>
		</div>
	{:else}
		<div class="body"></div>
	{/if}

	{#if app.cheatSheetOpen}
		<CheatSheet />
	{/if}

	<NoteContextMenu />

	{#if app.conflictOpen}
		<!-- Same resolver the desktop opens as a second window; closes on sync done. -->
		<div class="conflict-overlay" transition:fade={{ duration: 160 }}>
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
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	/* --- tablet: list + editor; folders slide in as a drawer ------------- */
	.layout-tablet {
		position: relative;
	}
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
		transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.layout-tablet.drawer-open .sidebar-wrap {
		transform: none;
	}
	.layout-tablet .list-wrap {
		width: clamp(260px, 38%, 340px);
	}
	.app.zen .layout-tablet .list-wrap {
		display: none;
	}
	.scrim {
		position: absolute;
		inset: 0;
		z-index: 15;
		background: rgba(0, 0, 0, 0.22);
	}

	/* --- phone: one pane at a time (data-pane), the rest hidden but mounted - */
	.layout-phone .sidebar-wrap {
		flex: 1;
	}
	.layout-phone:not([data-pane='nav']) .sidebar-wrap,
	.layout-phone[data-pane='nav'] .content {
		display: none;
	}
	.layout-phone .content {
		padding: 0;
		gap: 0;
	}
	.layout-phone .list-wrap {
		flex: 1;
	}
	.layout-phone[data-pane='editor'] .list-wrap,
	.layout-phone[data-pane='list'] .content > :global(.editor-pane) {
		display: none;
	}

	.layout-tablet .sidebar-wrap :global(.sidebar),
	.layout-phone .sidebar-wrap :global(.sidebar) {
		width: 100%;
	}
	.layout-tablet .list-wrap,
	.layout-phone .list-wrap {
		display: flex;
	}
	.layout-tablet .list-wrap > :global(.notelist),
	.layout-phone .list-wrap > :global(.notelist) {
		width: 100%;
		flex: 1 1 auto;
	}

	.sidebar-wrap {
		flex: 0 0 auto;
		overflow: hidden;
		min-width: 0;
	}
	.content {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 10px;
		padding: 0 10px 10px;
	}
	.list-wrap {
		flex: 0 0 auto;
		min-width: 0;
		overflow: hidden;
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
</style>
