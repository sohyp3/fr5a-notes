<script lang="ts">
	import { getAppState } from '../stores/app.svelte';
	import Icon from './Icon.svelte';
	import CuratedMindMap from './CuratedMindMap.svelte';
	import AllNotesMap from './LinkedNotes.svelte';

	const app = getAppState();
	const maps = $derived(
		app.listedNotes.filter(
			(note) => note.mindMapVersion !== null && (!note.encrypted || app.vault?.unlocked)
		)
	);
	$effect(() => {
		const id = app.activeMindMap;
		if (
			id &&
			id !== 'all' &&
			!app.listedNotes.some((note) => note.id === id && (!note.encrypted || app.vault?.unlocked))
		)
			app.openMindMap(null);
	});
</script>

{#if app.activeMindMap === 'all'}
	<div class="map-shell">
		<button class="chooser-back" onclick={() => app.openMindMap(null)}>
			<Icon name="back" size={17} /> Maps
		</button>
		<AllNotesMap />
	</div>
{:else if app.activeMindMap}
	{#key app.activeMindMap}<CuratedMindMap mapId={app.activeMindMap} />{/key}
{:else}
	<section class="chooser" aria-labelledby="map-heading">
		<header>
			<div>
				<h1 id="map-heading">Mind maps</h1>
				<p>Curated maps live in ordinary Markdown notes and travel with your workspace.</p>
			</div>
			<button class="close" aria-label="Close mind maps" onclick={() => app.setView('editor')}>
				<Icon name="close" size={18} />
			</button>
		</header>

		<div class="actions">
			<button class="primary" onclick={() => app.createMindMap(false)}>
				<Icon name="plus" size={17} /> Create mind map
			</button>
			{#if app.activeId}
				<button onclick={() => app.createMindMap(true)}>Create from this note</button>
			{/if}
		</div>

		<div class="map-list">
			<button class="map-row all" onclick={() => app.openMindMap('all')}>
				<span class="map-mark"><Icon name="graph" size={18} /></span>
				<span
					><strong>All notes</strong><small>Automatic links and tags across the workspace</small
					></span
				>
				<Icon name="next" size={17} />
			</button>
			{#each maps as map (map.id)}
				<button class="map-row" onclick={() => app.openMindMap(map.id)}>
					<span class="map-mark"><Icon name="graph" size={18} /></span>
					<span
						><strong>{map.title}</strong><small
							>{map.locked ? `View only · ${map.id}` : map.id}</small
						></span
					>
					<Icon name="next" size={17} />
				</button>
			{/each}
			{#if maps.length === 0}
				<p class="empty">
					No curated maps yet. Start with a central idea or turn the open note into a root.
				</p>
			{/if}
		</div>
	</section>
{/if}

<style>
	.map-shell {
		position: relative;
		display: flex;
		flex: 1;
		min-width: 0;
	}
	button {
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
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
	}
	.chooser {
		flex: 1;
		min-width: 0;
		height: 100%;
		overflow: auto;
		background: var(--bg-editor);
		border-radius: 12px;
		box-shadow: var(--shadow-pane);
		padding: max(28px, env(safe-area-inset-top)) clamp(20px, 6vw, 72px)
			max(32px, env(safe-area-inset-bottom));
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		max-width: 780px;
		margin: 0 auto 30px;
	}
	h1 {
		margin: 0 0 7px;
		font-size: 28px;
		letter-spacing: -0.025em;
	}
	header p {
		margin: 0;
		max-width: 58ch;
		color: var(--text-muted);
		line-height: 1.55;
	}
	.close {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: var(--text-muted);
	}
	.actions {
		max-width: 780px;
		margin: 0 auto 20px;
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.actions button {
		min-height: 44px;
		padding: 0 15px;
		display: flex;
		align-items: center;
		gap: 8px;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--bg-editor);
		color: var(--text);
		font-weight: 600;
	}
	.actions .primary {
		border-color: transparent;
		background: var(--accent);
		color: var(--on-accent);
	}
	.map-list {
		max-width: 780px;
		margin: auto;
		border-top: 1px solid var(--rule);
	}
	.map-row {
		width: 100%;
		min-height: 72px;
		padding: 12px 8px;
		display: grid;
		grid-template-columns: 42px minmax(0, 1fr) 24px;
		align-items: center;
		gap: 12px;
		text-align: start;
		border: 0;
		border-bottom: 1px solid var(--rule);
		background: transparent;
		color: var(--text);
	}
	.map-row > span:nth-child(2) {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.map-row strong,
	.map-row small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.map-row small {
		color: var(--text-muted);
		font-size: 12px;
	}
	.map-mark {
		width: 38px;
		height: 38px;
		display: grid;
		place-items: center;
		border-radius: 12px;
		background: color-mix(in srgb, var(--accent) 11%, transparent);
		color: var(--accent);
	}
	.all .map-mark {
		background: var(--bg-hover);
		color: var(--text-muted);
	}
	.empty {
		margin: 24px 8px;
		color: var(--text-muted);
		line-height: 1.55;
	}
	@media (max-width: 599px) {
		.chooser {
			border-radius: 0;
			box-shadow: none;
		}
		header {
			margin-bottom: 22px;
		}
		.actions {
			flex-direction: column;
		}
		.actions button {
			justify-content: center;
		}
	}
	:global([data-touch]) .chooser-back,
	:global([data-touch]) .actions button,
	:global([data-touch]) .close {
		min-height: 48px;
	}
	@media (hover: hover) and (pointer: fine) {
		.close:hover,
		.map-row:hover {
			background: var(--bg-hover);
		}
	}
</style>
