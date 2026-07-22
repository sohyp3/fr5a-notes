<script lang="ts">
	import { slide } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import { buildFolderTree } from '../folders';
	import TagTree from './TagTree.svelte';
	import FolderTree from './FolderTree.svelte';
	import logo from '$lib/assets/logo.png';

	const app = getAppState();
	const noteCount = $derived(app.notes.length);
	const folders = $derived(buildFolderTree(app.notes, app.folders));
	const allSelected = $derived(app.selectedTag === null && app.selectedFolder === null);

	// Inline "new folder" input, revealed by the + button in the Folders header.
	let adding = $state(false);
	let newName = $state('');
	let input = $state<HTMLInputElement | null>(null);

	function startAdd(): void {
		adding = true;
		newName = '';
		queueMicrotask(() => input?.focus());
	}

	async function commitAdd(): Promise<void> {
		const name = newName.trim();
		adding = false;
		newName = '';
		if (name) await app.createFolder(name);
	}
</script>

<nav class="sidebar">
	<div class="brand"><img src={logo} alt="fr5a" /></div>

	<button class="all-notes" class:selected={allSelected} onclick={() => app.showAllNotes()}>
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
			<path
				d="M5 4h14M5 9h14M5 14h9M5 19h9"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
			/>
		</svg>
		<span>All Notes</span>
		<span class="count">{noteCount}</span>
	</button>

	<div class="scroll-area">
		<div class="section-label with-action">
			<button
				class="section-toggle"
				aria-expanded={app.sidebar.foldersOpen}
				onclick={() => app.toggleSection('folders')}
			>
				<svg
					class="chev"
					class:open={app.sidebar.foldersOpen}
					width="9"
					height="9"
					viewBox="0 0 10 10"
				>
					<path d="M3 2l4 3-4 3z" fill="currentColor" />
				</svg>
				<span>Folders</span>
			</button>
			<div class="actions">
				<button class="hdr-btn" title="New folder" aria-label="New folder" onclick={startAdd}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
						<path
							d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linejoin="round"
						/>
						<path
							d="M12 11v4M10 13h4"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
						/>
					</svg>
				</button>
				{#if folders.length > 0 && app.sidebar.foldersOpen}
					<button
						class="hdr-btn"
						title="Collapse all folders"
						aria-label="Collapse all folders"
						onclick={() => app.collapseFolders()}
					>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none">
							<path
								d="M8 4l4 4 4-4M8 20l4-4 4 4"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
				{/if}
			</div>
		</div>

		{#if adding}
			<div class="new-folder">
				<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none">
					<path
						d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linejoin="round"
					/>
				</svg>
				<input
					bind:this={input}
					bind:value={newName}
					placeholder={app.selectedFolder ? `New in ${app.selectedFolder}` : 'Folder name'}
					spellcheck="false"
					onkeydown={(e) => {
						if (e.key === 'Enter') commitAdd();
						else if (e.key === 'Escape') {
							adding = false;
							newName = '';
						}
					}}
					onblur={commitAdd}
				/>
			</div>
		{/if}

		{#if folders.length > 0 && app.sidebar.foldersOpen}
			<div class="tree" transition:slide={{ duration: 160 }}>
				{#each folders as node (node.path)}
					<FolderTree {node} />
				{/each}
			</div>
		{/if}

		<div class="section-label with-action">
			<button
				class="section-toggle"
				aria-expanded={app.sidebar.tagsOpen}
				onclick={() => app.toggleSection('tags')}
			>
				<svg
					class="chev"
					class:open={app.sidebar.tagsOpen}
					width="9"
					height="9"
					viewBox="0 0 10 10"
				>
					<path d="M3 2l4 3-4 3z" fill="currentColor" />
				</svg>
				<span>Tags</span>
			</button>
		</div>
		{#if app.sidebar.tagsOpen}
			<div class="tree" transition:slide={{ duration: 160 }}>
				{#if app.tags.length === 0}
					<p class="empty">No tags yet. Add <code>#tags</code> to your notes.</p>
				{:else}
					{#each app.tags as node (node.path)}
						<TagTree {node} />
					{/each}
				{/if}
			</div>
		{/if}
	</div>

	<footer class="foot">
		<button
			class="settings-btn"
			class:selected={app.trashOpen && app.view === 'editor'}
			title="Trash"
			onclick={() => app.openTrash()}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
				<path
					d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<span>Trash</span>
			{#if app.trashNotes.length}<span class="count">{app.trashNotes.length}</span>{/if}
		</button>
		<button
			class="settings-btn"
			class:selected={app.view === 'settings'}
			title="Settings"
			onclick={() => app.setView('settings')}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
				<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7" />
				<path
					d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
					stroke="currentColor"
					stroke-width="1.5"
				/>
			</svg>
			<span>Settings</span>
		</button>
	</footer>
</nav>

<style>
	.sidebar {
		width: 250px;
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 4px 6px 12px;
		overflow: hidden;
	}
	.brand {
		padding: 6px 12px 12px;
	}
	.brand img {
		display: block;
		height: 44px;
		width: auto;
		object-fit: contain;
	}
	.all-notes {
		display: flex;
		align-items: center;
		gap: 9px;
		height: 34px;
		margin: 0 6px 4px;
		padding: 0 10px;
		border-radius: 8px;
		font-size: 13.5px;
		font-weight: 500;
		color: var(--text);
		transition: background 110ms ease;
	}
	.all-notes:hover {
		background: var(--bg-hover);
	}
	.all-notes.selected {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.all-notes .count {
		margin-left: auto;
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.section-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		padding: 14px 16px 6px;
	}
	.section-label.with-action {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.section-toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		font: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		color: inherit;
		padding: 0;
		transition: color 110ms ease;
	}
	.section-toggle:hover {
		color: var(--text-muted);
	}
	.section-toggle .chev {
		flex: 0 0 auto;
		transition: transform 140ms var(--ease-spring);
	}
	.section-toggle .chev.open {
		transform: rotate(90deg);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 2px;
		margin: -4px -6px -4px 0;
	}
	.hdr-btn {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 6px;
		color: var(--text-faint);
		transition:
			background 110ms ease,
			color 110ms ease;
	}
	.hdr-btn:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.new-folder {
		display: flex;
		align-items: center;
		gap: 7px;
		height: 30px;
		margin: 1px 6px;
		padding: 0 10px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text-muted);
	}
	.new-folder .ico {
		flex: 0 0 auto;
	}
	.new-folder input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		outline: none;
		font-family: inherit;
		font-size: 13.5px;
		color: var(--text);
	}
	.scroll-area {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
	}
	.tree {
		display: flex;
		flex-direction: column;
	}
	.empty {
		font-size: 12.5px;
		color: var(--text-faint);
		line-height: 1.5;
		padding: 4px 16px;
	}
	.empty code {
		font-family: var(--font-mono);
		font-size: 0.92em;
	}
	.foot {
		flex: 0 0 auto;
		padding: 6px 6px 0;
	}
	.settings-btn {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		height: 36px;
		padding: 0 12px;
		border-radius: 8px;
		font-size: 13.5px;
		font-weight: 500;
		color: var(--text-muted);
		transition:
			background 110ms ease,
			color 110ms ease;
	}
	.settings-btn:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.settings-btn.selected {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.settings-btn svg {
		flex: 0 0 auto;
	}
	.settings-btn .count {
		margin-left: auto;
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
</style>
