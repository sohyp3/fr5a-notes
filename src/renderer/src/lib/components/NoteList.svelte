<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { reducedMotion } from '../portal';
	import { getAppState } from '../stores/app.svelte';
	import NoteCard from './NoteCard.svelte';
	import EmptyState from './EmptyState.svelte';
	import Icon from './Icon.svelte';
	import mascotSleep from '$lib/assets/fr5a-sleep.png';
	import mascotSearch from '$lib/assets/fr5a-search.png';

	const app = getAppState();
	const dur = reducedMotion() ? 0 : 1;
	let searchEl = $state<HTMLInputElement | null>(null);

	// Breadcrumb crumbs for the active filter, so it's always clear what's showing.
	// Each ancestor is a jump target; the final crumb is the current scope.
	interface Crumb {
		/** The folder / tag path it stands for ('' = All Notes): its key. */
		path: string;
		label: string;
		onclick?: () => void;
	}

	const crumbs = $derived.by((): Crumb[] => {
		if (app.trashOpen) return [{ path: '', label: 'Trash' }];
		if (app.selectedFolder) {
			const segs = app.selectedFolder.split('/');
			return [
				{ path: '', label: 'All Notes', onclick: () => app.showAllNotes() },
				...segs.map((name, i) => {
					const path = segs.slice(0, i + 1).join('/');
					const isLast = i === segs.length - 1;
					return { path, label: name, onclick: isLast ? undefined : () => app.selectFolder(path) };
				})
			];
		}
		if (app.selectedTag) {
			const segs = app.selectedTag.split('/');
			return [
				{ path: '', label: 'All Notes', onclick: () => app.showAllNotes() },
				...segs.map((name, i) => {
					const path = segs.slice(0, i + 1).join('/');
					const isLast = i === segs.length - 1;
					return {
						path,
						label: `#${name}`,
						onclick: isLast ? undefined : () => app.selectTag(path)
					};
				})
			];
		}
		return [{ path: '', label: 'All Notes' }];
	});
</script>

<section class="notelist">
	<div class="toolbar">
		<div class="search">
			<Icon name="search" size={14} />
			<input
				bind:this={searchEl}
				placeholder="Search"
				aria-label="Search notes"
				bind:value={app.search}
				spellcheck="false"
				onkeydown={(e) => {
					if (e.key === 'Escape' && app.search) {
						e.stopPropagation();
						app.search = '';
					}
				}}
			/>
			{#if app.search}
				<button
					class="clear"
					title="Clear search (Esc)"
					aria-label="Clear search"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => {
						app.search = '';
						if (!app.touch) searchEl?.focus();
					}}
				>
					<Icon name="close" size={14} stroke={2} />
				</button>
			{/if}
		</div>
		<button
			class="new"
			title="New note (Mod+N)"
			aria-label="New note"
			onclick={() => app.createNote()}
		>
			<Icon name="plus" size={18} stroke={2} />
		</button>
	</div>

	<nav
		class={['scope', { trash: app.trashOpen }]}
		title={app.trashOpen
			? 'Swipe right to restore · left to delete forever (or right-click / long-press)'
			: 'Swipe a card right to pin · left to trash (or right-click / long-press)'}
	>
		{#each crumbs as crumb, i (crumb.path)}
			{#if i > 0}<span class="sep" aria-hidden="true"
					><Icon name="chevron" size={11} stroke={2.2} /></span
				>{/if}
			{#if crumb.onclick}
				<button class="crumb link" onclick={crumb.onclick}>{crumb.label}</button>
			{:else}
				<span class="crumb current">{crumb.label}</span>
			{/if}
		{/each}
	</nav>

	<div class="list" role="list">
		{#if app.filtered.length === 0}
			{#if app.search.trim()}
				<EmptyState
					compact
					src={mascotSearch}
					title="No matches"
					body={`Nothing found for “${app.search.trim()}”.`}
				/>
			{:else if app.trashOpen}
				<EmptyState compact src={mascotSleep} title="Trash is empty" />
			{:else}
				<EmptyState
					compact
					src={mascotSleep}
					title="No notes here yet"
					body="Create one to get started."
				/>
			{/if}
		{:else}
			{#each app.filtered as note (note.id)}
				<div animate:flip={{ duration: 220 * dur }} in:fade={{ duration: 180 * dur }}>
					<NoteCard {note} trash={app.trashOpen} />
				</div>
			{/each}
		{/if}
	</div>
</section>

<style>
	.notelist {
		width: var(--list-w, 300px);
		flex: 0 0 var(--list-w, 300px);
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-list);
		border-radius: 12px;
		overflow: hidden;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 12px 12px;
	}
	/* The search field shrinks with the list; the New note button never does. */
	.search {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		padding: 0 4px 0 10px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text-muted);
	}
	.search input {
		flex: 1 1 auto;
		min-width: 0;
		width: 100%;
		height: 100%;
		border: none;
		background: none;
		outline: none;
		font-family: inherit;
		font-size: 13px;
		color: var(--text);
	}
	.clear {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		color: var(--text-faint);
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}
	.clear:hover,
	.clear:active {
		background: var(--bg-active);
		color: var(--text);
	}
	.new {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		color: var(--text-muted);
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.new:hover,
	.new:active {
		background: var(--accent-soft);
		color: var(--accent);
	}
	:global(html[data-touch]) .new {
		width: 44px;
		height: 44px;
	}
	:global(html[data-touch]) .search {
		height: 44px;
		padding-inline-end: 0;
	}
	:global(html[data-touch]) .clear {
		width: 44px;
		height: 44px;
	}
	:global(html[data-touch]) .search input {
		font-size: 16px;
	}
	.scope {
		display: flex;
		align-items: center;
		flex-wrap: nowrap;
		gap: 3px;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 14px 8px;
		overflow: hidden;
		white-space: nowrap;
	}
	.crumb {
		font-size: 11px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 130px;
		white-space: nowrap;
	}
	.crumb.current {
		color: var(--accent);
		flex: 0 1 auto;
	}
	.crumb.link {
		color: var(--text-faint);
		flex: 0 0 auto;
		transition: color 110ms ease;
	}
	.crumb.link:hover {
		color: var(--text);
	}
	.sep {
		display: grid;
		color: var(--text-faint);
		flex: 0 0 auto;
	}
	.scope.trash .crumb.current {
		color: var(--text-muted);
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 8px 10px;
	}
</style>
