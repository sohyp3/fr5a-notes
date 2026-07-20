<script lang="ts">
	import { flip } from 'svelte/animate';
	import { getAppState } from '../stores/app.svelte';
	import NoteCard from './NoteCard.svelte';
	import EmptyState from './EmptyState.svelte';
	import mascotSleep from '$lib/assets/fr5a-sleep.png';
	import mascotSearch from '$lib/assets/fr5a-search.png';

	const app = getAppState();

	// Breadcrumb crumbs for the active filter, so it's always clear what's showing.
	// Each ancestor is a jump target; the final crumb is the current scope.
	interface Crumb {
		label: string;
		onclick?: () => void;
	}

	const crumbs = $derived.by((): Crumb[] => {
		if (app.trashOpen) return [{ label: 'Trash' }];
		if (app.selectedFolder) {
			const segs = app.selectedFolder.split('/');
			return [
				{ label: 'All Notes', onclick: () => app.showAllNotes() },
				...segs.map((name, i) => {
					const path = segs.slice(0, i + 1).join('/');
					const isLast = i === segs.length - 1;
					return { label: name, onclick: isLast ? undefined : () => app.selectFolder(path) };
				})
			];
		}
		if (app.selectedTag) {
			const segs = app.selectedTag.split('/');
			return [
				{ label: 'All Notes', onclick: () => app.showAllNotes() },
				...segs.map((name, i) => {
					const path = segs.slice(0, i + 1).join('/');
					const isLast = i === segs.length - 1;
					return {
						label: `#${name}`,
						onclick: isLast ? undefined : () => app.selectTag(path)
					};
				})
			];
		}
		return [{ label: 'All Notes' }];
	});
</script>

<section class="notelist">
	<div class="toolbar">
		<div class="search">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
				<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" />
				<line
					x1="16"
					y1="16"
					x2="20.5"
					y2="20.5"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/>
			</svg>
			<input placeholder="Search" bind:value={app.search} spellcheck="false" />
		</div>
		<button class="new" title="New note" aria-label="New note" onclick={() => app.createNote()}>
			<svg width="17" height="17" viewBox="0 0 24 24" fill="none">
				<line
					x1="12"
					y1="5"
					x2="12"
					y2="19"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				/>
				<line
					x1="5"
					y1="12"
					x2="19"
					y2="12"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	</div>

	<nav
		class="scope"
		class:trash={app.trashOpen}
		title={app.trashOpen
			? 'Swipe right to restore · left to delete forever'
			: 'Swipe a card right to pin · left to delete'}
	>
		{#each crumbs as crumb, i (i)}
			{#if i > 0}<span class="sep">›</span>{/if}
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
				<div animate:flip={{ duration: 260 }}>
					<NoteCard {note} trash={app.trashOpen} />
				</div>
			{/each}
		{/if}
	</div>
</section>

<style>
	.notelist {
		width: 300px;
		flex: 0 0 300px;
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
	.search {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		padding: 0 10px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text-muted);
	}
	.search input {
		flex: 1;
		border: none;
		background: none;
		outline: none;
		font-family: inherit;
		font-size: 13px;
		color: var(--text);
	}
	.new {
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
	.new:hover {
		background: var(--accent-soft);
		color: var(--accent);
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
		color: var(--text-faint);
		flex: 0 0 auto;
	}
	.scope.trash .crumb.current {
		color: var(--text-muted);
	}
	.list {
		flex: 1;
		overflow-y: auto;
		padding: 0 8px 10px;
	}
</style>
