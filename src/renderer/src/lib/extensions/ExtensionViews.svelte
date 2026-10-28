<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { getAppState } from '../stores/app.svelte';
	import { extensions } from './registry';

	let { children }: { children: Snippet } = $props();
	const app = getAppState();
	let revision = $state(0);
	let selected = $state('');
	onMount(() => extensions.subscribe(() => revision++));
	const document = $derived.by(() => {
		void revision;
		return extensions.document(app.activeId ?? '', app.activeContent);
	});
	const tabs = $derived(app.activeId ? extensions.tabs(document) : []);
	const active = $derived(tabs.find((tab) => tab.id === selected));
	async function select(id: string): Promise<void> {
		const noteId = app.activeId;
		await app.flush();
		if (app.activeId === noteId) selected = id;
	}
	$effect(() => {
		void app.activeId;
		selected = '';
	});
</script>

<div class="extension-views">
	{#if tabs.length}
		<nav aria-label="Note views">
			<button aria-pressed={!active} onclick={() => select('')}>Note</button>
			{#each tabs as tab (tab.id)}
				<button aria-pressed={active?.id === tab.id} onclick={() => select(tab.id)}
					>{tab.label}</button
				>
			{/each}
		</nav>
	{/if}
	<div class="standard" hidden={!!active} inert={!!active}>
		{@render children()}
	</div>
	{#if active}
		<div class="custom">
			{#key `${app.activeId}:${active.id}`}
				<svelte:boundary>
					<active.component {document} />
					{#snippet failed(error, reset)}
						<p role="alert">
							This extension view could not open: {error instanceof Error
								? error.message
								: 'Unknown error'}
						</p>
						<button onclick={reset}>Try again</button>
					{/snippet}
				</svelte:boundary>
			{/key}
		</div>
	{/if}
</div>

<style>
	.extension-views {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	nav {
		display: flex;
		gap: 4px;
		padding: 8px;
		overflow-x: auto;
		border-bottom: 1px solid var(--rule);
	}
	button {
		font: inherit;
		color: var(--text);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 6px 10px;
		min-height: 44px;
		min-width: 44px;
		cursor: pointer;
		white-space: nowrap;
	}
	button:hover,
	button[aria-pressed='true'] {
		background: var(--bg-hover);
	}
	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.standard {
		display: flex;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.standard[hidden] {
		display: none;
	}
	.custom {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 16px;
	}
</style>
