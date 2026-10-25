<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { nodeColors, type CanvasNode } from '../../maps/canvas';
	import { getMapApi } from '../../maps/context';
	import NodeHandles from './NodeHandles.svelte';

	// Link and group nodes from other canvas apps: shown, moved, kept as they are.
	let { id, data, selected }: NodeProps & { data: { raw: CanvasNode } } = $props();
	const map = getMapApi();
	const colors = $derived(nodeColors(data.raw.color, map.theme));
	const group = $derived(data.raw.type === 'group');
	const label = $derived(
		group ? (data.raw.label ?? 'Group') : (data.raw.url ?? data.raw.label ?? data.raw.type)
	);
</script>

<div
	class={['map-node other', { selected, group }]}
	style:border-color={colors?.border}
	style:background={group ? undefined : colors?.fill}
	role="group"
	aria-label={label}
	{@attach map.press(id)}
>
	<span class="text" dir="auto">{label}</span>
	{#if !group}<NodeHandles />{/if}
</div>
