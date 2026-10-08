<script lang="ts">
	import { slide } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import type { TagNode } from '../../../../shared/types';
	import Icon from './Icon.svelte';
	import Self from './TagTree.svelte';

	let { node, depth = 0 }: { node: TagNode; depth?: number } = $props();

	const app = getAppState();
	// Expansion lives in the app's persisted sidebar state (survives relaunch).
	const expanded = $derived(app.isTagExpanded(node.path, depth));

	const hasChildren = $derived(node.children.length > 0);
	const selected = $derived(app.selectedTag === node.path);
</script>

<div class={['tag-row', { selected }]} style:padding-left="{8 + depth * 14}px">
	<button
		class={['twist', { hidden: !hasChildren }]}
		aria-label="Expand"
		onclick={(e) => {
			e.stopPropagation();
			app.toggleTagExpanded(node.path, depth);
		}}
	>
		<span class={['chev', { open: expanded }]}><Icon name="chevron" size={12} stroke={2.4} /></span>
	</button>

	<button class="label" onclick={() => app.selectTag(node.path)}>
		<span class="hash">#</span><span class="name">{node.name}</span>
		<span class="count">{node.count}</span>
	</button>
</div>

{#if hasChildren && expanded}
	<div transition:slide={{ duration: app.touch ? 0 : 160 }}>
		{#each node.children as child (child.path)}
			<Self node={child} depth={depth + 1} />
		{/each}
	</div>
{/if}

<style>
	.tag-row {
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
	.tag-row:hover {
		background: var(--bg-hover);
	}
	.tag-row.selected {
		background: var(--accent-soft);
	}
	.tag-row.selected .name,
	.tag-row.selected .hash {
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
	.chev {
		display: grid;
		transition: transform 140ms var(--ease-spring);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.label {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 13.5px;
		min-width: 0;
	}
	.hash {
		color: var(--text-faint);
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
