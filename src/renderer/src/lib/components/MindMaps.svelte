<script lang="ts">
	import { getAppState } from '../stores/app.svelte';
	import Icon from './Icon.svelte';

	const app = getAppState();
	// Each surface is its own chunk: the d3 graph and the Svelte Flow editor load
	// only when opened, so turning one feature on never loads the other's code.
	const graph = $derived(
		app.activeMindMap === 'all' && app.settings.linkedNotes ? import('./LinkedNotes.svelte') : null
	);
	const editor = $derived(
		app.activeMindMap && app.activeMindMap !== 'all' && app.settings.mindMaps
			? import('./maps/MapEditor.svelte')
			: null
	);
	const chooser = $derived(
		!graph && !editor && app.settings.mindMaps ? import('./maps/MapChooser.svelte') : null
	);
</script>

{#if graph}
	<div class="map-shell">
		{#if app.settings.mindMaps}
			<button class="chooser-back" onclick={() => app.openMindMap(null)}>
				<Icon name="back" size={17} /> Maps
			</button>
		{/if}
		{#await graph then m}<m.default />{/await}
	</div>
{:else if editor}
	{#await editor then m}
		{#key app.activeMindMap}<m.default name={app.activeMindMap as string} />{/key}
	{/await}
{:else if chooser}
	{#await chooser then m}<m.default />{/await}
{/if}

<style>
	.map-shell {
		position: relative;
		display: flex;
		flex: 1;
		min-width: 0;
	}
	.chooser-back {
		position: absolute;
		z-index: 4;
		left: 18px;
		bottom: 18px;
		min-height: 40px;
		padding: 0 13px;
		display: flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--bg-editor);
		color: var(--text-muted);
		box-shadow: var(--shadow-pane);
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
	}
	:global([data-touch]) .chooser-back {
		min-height: 48px;
	}
</style>
