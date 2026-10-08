<script lang="ts">
	import { getAppState } from '../stores/app.svelte';
	import Icon from './Icon.svelte';

	/**
	 * Note tabs above the editor (Settings → Editor → Tabs). A click switches,
	 * the × or a middle-click closes, + starts a new note in a new tab.
	 */

	const app = getAppState();
	const current = $derived(app.tabIndex);
	let strip = $state<HTMLDivElement | null>(null);

	function title(id: string | null): string {
		if (id === null) return 'New note';
		return (
			app.noteMeta(id)?.title ??
			id
				.split('/')
				.pop()!
				.replace(/\.(md|markdown|txt)$/i, '')
		);
	}

	// Keep the current tab in sight. Not scrollIntoView: that can shift the whole UI.
	$effect(() => {
		const el = strip?.children[current] as HTMLElement | undefined;
		if (!strip || !el) return;
		const { offsetLeft: x, offsetWidth: w } = el;
		if (x < strip.scrollLeft) strip.scrollLeft = x;
		else if (x + w > strip.scrollLeft + strip.clientWidth)
			strip.scrollLeft = x + w - strip.clientWidth;
	});

	function onAux(e: MouseEvent, i: number): void {
		if (e.button !== 1) return;
		e.preventDefault();
		void app.closeTab(i);
	}
</script>

<div class="note-tabs">
	<div class="strip" role="tablist" aria-label="Open notes" bind:this={strip}>
		{#each app.tabs as id, i (id ?? '\u0000draft')}
			{@const meta = id === null ? undefined : app.noteMeta(id)}
			<div class="tab" class:on={i === current}>
				<button
					class="name"
					role="tab"
					aria-selected={i === current}
					title={id ?? 'New note'}
					onclick={() => id && app.openNote(id)}
					onauxclick={(e) => onAux(e, i)}
					onmousedown={(e) => e.button === 1 && e.preventDefault()}
				>
					{#if meta?.encrypted}<Icon name="key" size={11} stroke={2.2} />{/if}<span
						>{title(id)}</span
					>
				</button>
				<button
					class="x"
					aria-label="Close {title(id)}"
					title="Close tab (Mod+W)"
					onclick={() => app.closeTab(i)}
				>
					<Icon name="close" size={12} stroke={2} />
				</button>
			</div>
		{/each}
	</div>
	<button
		class="new"
		aria-label="New note in a new tab"
		title="New note (Mod+N)"
		onclick={() => app.createNote()}
	>
		<Icon name="plus" size={15} stroke={1.8} />
	</button>
</div>

<style>
	.note-tabs {
		flex: 0 0 auto;
		position: relative;
		z-index: 6; /* above the "Nothing open" placeholder, which fills the pane */
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 6px 8px 0 14px;
		background: var(--bg-editor);
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	:global(.app.zen) .note-tabs {
		display: none;
	}
	.strip {
		flex: 0 1 auto;
		min-width: 0;
		display: flex;
		gap: 2px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.strip::-webkit-scrollbar {
		display: none;
	}
	.tab {
		flex: 0 1 180px;
		min-width: 90px;
		display: flex;
		align-items: center;
		border-radius: 8px 8px 0 0;
		color: var(--text-muted);
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}
	.tab:hover {
		background: var(--bg-hover);
	}
	.tab.on {
		background: var(--bg-active);
		color: var(--text-strong);
	}
	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 5px;
		height: 30px;
		padding: 0 4px 0 12px;
		font: 500 12.5px/1 var(--font-ui);
		color: inherit;
		text-align: start;
	}
	.name span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.x,
	.new {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		border-radius: 6px;
		color: var(--text-faint);
	}
	.x {
		width: 22px;
		height: 22px;
		margin-inline-end: 4px;
		opacity: 0;
	}
	.tab:hover .x,
	.tab.on .x,
	.x:focus-visible {
		opacity: 1;
	}
	.new {
		width: 28px;
		height: 28px;
	}
	.x:hover,
	.new:hover {
		background: var(--bg-active);
		color: var(--text);
	}
	/* Touch: no hover, so every tab shows its ×; finger-sized targets. */
	:global(html[data-touch]) .name {
		height: 40px;
	}
	:global(html[data-touch]) .x {
		width: 32px;
		height: 32px;
		opacity: 1;
	}
	:global(html[data-touch]) .new {
		width: 40px;
		height: 40px;
	}
</style>
