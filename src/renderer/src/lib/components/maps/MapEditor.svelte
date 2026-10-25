<script lang="ts">
	// The map chunk: Svelte Flow and the node components. Imported only when a map
	// opens (MindMaps.svelte), never while mind maps are off.
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import MapCanvas from './MapCanvas.svelte';

	let { name }: { name: string } = $props();
</script>

<SvelteFlowProvider>
	<MapCanvas {name} />
</SvelteFlowProvider>
