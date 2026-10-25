<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';

	// Loose connection mode: every side is a source, and any handle takes a drop.
	const SIDES = [
		['top', Position.Top],
		['right', Position.Right],
		['bottom', Position.Bottom],
		['left', Position.Left]
	] as const;
</script>

{#each SIDES as [id, position] (id)}
	<Handle type="source" {id} {position} class="map-handle" />
{/each}
