<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { nodeColors, type CanvasNode } from '../../maps/canvas';
	import { getMapApi } from '../../maps/context';
	import NodeHandles from './NodeHandles.svelte';

	let { id, data, selected }: NodeProps & { data: { raw: CanvasNode } } = $props();
	const map = getMapApi();
	const colors = $derived(nodeColors(data.raw.color, map.theme));
	const tag = $derived(data.raw.fr5a?.tag ?? '');
	// Cheap: the committed canvas + the index's tags, no note bodies.
	const fresh = $derived(map.newFor(id).length);
</script>

<div
	class={['map-node tag', { selected }]}
	style:border-color={colors?.border}
	style:background={colors?.fill}
	role="group"
	aria-label={`Tag ${tag}`}
	{@attach map.press(id)}
>
	<span class="text" dir="auto">#{tag}</span>
	{#if fresh}
		<button
			class="mini nodrag"
			title={`Add ${fresh} newly tagged ${fresh === 1 ? 'note' : 'notes'}`}
			onclick={() => map.populate(id)}>+{fresh} new</button
		>
	{/if}
	<NodeHandles />
</div>
