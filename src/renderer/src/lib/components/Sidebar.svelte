<script lang="ts">
	import { slide } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import { buildFolderTree } from '../folders';
	import { dropFor, endDrag } from '../dnd';
	import TagTree from './TagTree.svelte';
	import FolderTree from './FolderTree.svelte';
	import Icon from './Icon.svelte';
	import logo from '$lib/assets/logo.png';

	const app = getAppState();
	// Hidden folders (Settings → General) stay out of the tree and the All Notes count.
	const noteCount = $derived(app.listedNotes.length);
	const folders = $derived(buildFolderTree(app.listedNotes, app.listedFolders));
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

	// "All Notes" doubles as the drop target for the workspace root.
	let rootOver = $state(false);
	function onRootDrop(e: DragEvent): void {
		rootOver = false;
		const item = dropFor(e, '');
		endDrag();
		if (!item) return;
		e.preventDefault();
		if (item.kind === 'note') void app.moveNoteTo(item.path, '');
		else void app.moveFolderTo(item.path, '');
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

	<button
		class="all-notes"
		class:selected={allSelected}
		class:over={rootOver}
		title={rootOver ? 'Move to the top level' : undefined}
		onclick={() => app.showAllNotes()}
		ondragover={(e) => {
			if (!dropFor(e, '')) return;
			e.preventDefault();
			rootOver = true;
		}}
		ondragleave={() => (rootOver = false)}
		ondrop={onRootDrop}
	>
		<Icon name="notes" size={16} />
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
				<span class="chev" class:open={app.sidebar.foldersOpen}
					><Icon name="chevron" size={11} stroke={2.4} /></span
				>
				<span>Folders</span>
			</button>
			<div class="actions">
				<button class="hdr-btn" title="New folder" aria-label="New folder" onclick={startAdd}>
					<Icon name="newFolder" size={14} />
				</button>
				{#if folders.length > 0 && app.sidebar.foldersOpen}
					<button
						class="hdr-btn"
						title="Collapse all folders"
						aria-label="Collapse all folders"
						onclick={() => app.collapseFolders()}
					>
						<Icon name="collapse" size={14} />
					</button>
				{/if}
			</div>
		</div>

		{#if adding}
			<div class="new-folder">
				<Icon name="folder" size={14} />
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
			<div class="tree" transition:slide={{ duration: app.touch ? 0 : 160 }}>
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
				<span class="chev" class:open={app.sidebar.tagsOpen}
					><Icon name="chevron" size={11} stroke={2.4} /></span
				>
				<span>Tags</span>
			</button>
		</div>
		{#if app.sidebar.tagsOpen}
			<div class="tree" transition:slide={{ duration: app.touch ? 0 : 160 }}>
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
			<Icon name="trash" size={16} />
			<span>Trash</span>
			{#if app.trashNotes.length}<span class="count">{app.trashNotes.length}</span>{/if}
		</button>
		{#if app.changes !== null}
			<button
				class="settings-btn"
				class:selected={app.view === 'changes'}
				title="Notes changed since the last sync (git status)"
				onclick={() => app.showChanges()}
			>
				<Icon name="diff" size={16} />
				<span>Changes</span>
				{#if app.changes.length}<span class="count">{app.changes.length}</span>{/if}
			</button>
		{/if}
		<button
			class="settings-btn"
			class:selected={app.view === 'settings'}
			title="Settings"
			onclick={() => app.openSettings()}
		>
			<Icon name="settings" size={16} />
			<span>Settings</span>
		</button>
	</footer>
</nav>

<style>
	.sidebar {
		width: var(--sidebar-w, 250px);
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
	.all-notes.over {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1.5px var(--accent);
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
		display: grid;
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
		min-height: 0;
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
	.settings-btn:active,
	.all-notes:active {
		background: var(--bg-active);
	}
	.settings-btn.selected {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.settings-btn .count {
		margin-left: auto;
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
</style>
