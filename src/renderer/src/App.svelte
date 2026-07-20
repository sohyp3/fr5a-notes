<script lang="ts">
	import { Spring } from 'svelte/motion';
	import { getAppState } from './lib/stores/app.svelte';
	import TitleBar from './lib/components/TitleBar.svelte';
	import Sidebar from './lib/components/Sidebar.svelte';
	import NoteList from './lib/components/NoteList.svelte';
	import Editor from './lib/components/Editor.svelte';
	import Settings from './lib/components/Settings.svelte';
	import CheatSheet from './lib/components/CheatSheet.svelte';
	import NoteContextMenu from './lib/components/NoteContextMenu.svelte';

	const app = getAppState();
	const SIDEBAR_W = 250;
	const LIST_W = 300;

	// Spring-driven widths so toggling/Zen feels physical, not linear.
	const sidebarWidth = new Spring(SIDEBAR_W, { stiffness: 0.16, damping: 0.72 });
	const listWidth = new Spring(LIST_W, { stiffness: 0.16, damping: 0.74 });

	// In Zen mode the sidebar and note list animate away, centring the editor.
	const showSidebar = $derived(app.sidebarOpen && !app.zen);
	const showList = $derived(!app.zen && app.view === 'editor');

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

	app.init();
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app" class:zen={app.zen}>
	<TitleBar />
	<div class="body">
		<div
			class="sidebar-wrap"
			style="width:{sidebarWidth.current}px"
			aria-hidden={!showSidebar}
			inert={!showSidebar}
		>
			<Sidebar />
		</div>
		<main class="content">
			{#if app.view === 'settings'}
				<Settings />
			{:else}
				<div
					class="list-wrap"
					style="width:{listWidth.current}px"
					aria-hidden={!showList}
					inert={!showList}
				>
					<NoteList />
				</div>
				<Editor />
			{/if}
		</main>
	</div>

	{#if app.cheatSheetOpen}
		<CheatSheet />
	{/if}

	<NoteContextMenu />
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
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
