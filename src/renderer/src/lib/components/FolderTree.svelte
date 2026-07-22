<script lang="ts">
	import { slide } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import type { FolderNode } from '../folders';
	import Self from './FolderTree.svelte';

	let { node, depth = 0 }: { node: FolderNode; depth?: number } = $props();

	const app = getAppState();
	// Expansion lives in the app's persisted sidebar state, so it survives
	// relaunches and "collapse all" is just a store write.
	const expanded = $derived(app.isFolderExpanded(node.path, depth));

	const hasChildren = $derived(node.children.length > 0);
	const selected = $derived(app.selectedFolder === node.path);
</script>

<div class="folder-row" style="padding-left:{8 + depth * 14}px" class:selected>
	<button
		class="twist"
		class:hidden={!hasChildren}
		aria-label="Expand"
		onclick={(e) => {
			e.stopPropagation();
			app.toggleFolderExpanded(node.path, depth);
		}}
	>
		<svg width="9" height="9" viewBox="0 0 10 10" class:open={expanded}>
			<path d="M3 2l4 3-4 3z" fill="currentColor" />
		</svg>
	</button>

	<button class="label" onclick={() => app.selectFolder(node.path)}>
		<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none">
			<path
				d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
				stroke="currentColor"
				stroke-width="1.7"
				stroke-linejoin="round"
			/>
		</svg>
		<span class="name">{node.name}</span>
		<span class="count">{node.count}</span>
	</button>
</div>

{#if hasChildren && expanded}
	<div transition:slide={{ duration: 160 }}>
		{#each node.children as child (child.path)}
			<Self node={child} depth={depth + 1} />
		{/each}
	</div>
{/if}

<style>
	.folder-row {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 30px;
		border-radius: 8px;
		padding-right: 8px;
		margin: 1px 6px;
		color: var(--text);
		transition: background 110ms ease;
	}
	.folder-row:hover {
		background: var(--bg-hover);
	}
	.folder-row.selected {
		background: var(--accent-soft);
	}
	.folder-row.selected .name,
	.folder-row.selected .ico {
		color: var(--accent);
		font-weight: 600;
	}
	.twist {
		width: 16px;
		height: 16px;
		display: grid;
		place-items: center;
		color: var(--text-faint);
		flex: 0 0 auto;
	}
	.twist.hidden {
		visibility: hidden;
	}
	.twist svg {
		transition: transform 140ms var(--ease-spring);
	}
	.twist svg.open {
		transform: rotate(90deg);
	}
	.label {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 13.5px;
		min-width: 0;
	}
	.ico {
		flex: 0 0 auto;
		color: var(--text-muted);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		margin-left: auto;
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
</style>
