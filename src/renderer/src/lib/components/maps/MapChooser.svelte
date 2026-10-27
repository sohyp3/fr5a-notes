<script lang="ts">
	import { cleanMapName } from '../../maps/canvas';
	import {
		createMap,
		duplicateMap,
		freeName,
		listMaps,
		removeMap,
		renameMap
	} from '../../maps/files';
	import { getAppState } from '../../stores/app.svelte';
	import ActionMenu, { type MenuItem } from '../ActionMenu.svelte';
	import Icon from '../Icon.svelte';

	const app = getAppState();
	/** Map names, newest first; null while the first listing runs. */
	let maps = $state.raw<string[] | null>(null);
	let menu = $state<{ name: string; at: { x: number; y: number } } | null>(null);
	let trigger = $state<HTMLElement | null>(null);

	async function reload(): Promise<void> {
		maps = await listMaps();
	}
	void reload();
	$effect(() => {
		if (app.mapSyncVersion) void reload();
	});

	/** Why `value` can't name a map (`except`: the map being renamed). */
	function nameError(value: string, except?: string): string | null {
		const name = cleanMapName(value);
		if (!name) return 'Give the map a name.';
		// `activeMindMap = 'all'` is the automatic graph.
		if (name === 'all') return 'That name is taken by the graph. Try another.';
		const taken = (maps ?? []).some(
			(m) => m.toLowerCase() === name.toLowerCase() && m.toLowerCase() !== except?.toLowerCase()
		);
		return taken ? 'There’s a map with that name already.' : null;
	}

	async function create(): Promise<void> {
		const value = await app.prompt({
			title: 'New mind map',
			label: 'Name',
			value: '',
			confirm: 'Create',
			check: (v) => nameError(v)
		});
		if (value === null) return;
		const name = cleanMapName(value);
		try {
			await createMap(name);
			app.openMindMap(name);
		} catch (err) {
			app.notify('error', `Couldn’t create the map: ${err instanceof Error ? err.message : err}`);
		}
	}

	async function rename(from: string): Promise<void> {
		const value = await app.prompt({
			title: 'Rename map',
			label: 'Name',
			value: from,
			confirm: 'Rename',
			check: (v) => nameError(v, from)
		});
		if (value === null) return;
		const to = cleanMapName(value);
		if (to === from) return;
		try {
			await renameMap(from, to);
			app.renamedMindMap(from, to);
		} catch (err) {
			app.notify('error', `Couldn’t rename the map: ${err instanceof Error ? err.message : err}`);
			return;
		}
		if (app.activeMindMap === from) app.openMindMap(null);
		await reload();
	}

	async function duplicate(from: string): Promise<void> {
		try {
			await duplicateMap(from, freeName(`${from} copy`, maps ?? []));
		} catch (err) {
			app.notify(
				'error',
				`Couldn’t duplicate the map: ${err instanceof Error ? err.message : err}`
			);
		}
		await reload();
	}

	async function remove(name: string): Promise<void> {
		const ok = await app.confirm({
			title: `Delete “${name}”?`,
			body: 'The map goes, the notes and tags on it stay as they are. A synced copy stays in the repository’s history.',
			confirm: 'Delete',
			danger: true
		});
		if (!ok) return;
		try {
			await removeMap(name);
			app.forgotMindMap(name);
		} catch (err) {
			app.notify('error', `Couldn’t delete the map: ${err instanceof Error ? err.message : err}`);
			return;
		}
		await reload();
	}

	const items = (name: string): MenuItem[] => [
		{ label: 'Rename…', icon: 'rename', action: () => void rename(name) },
		{ label: 'Duplicate', icon: 'copy', action: () => void duplicate(name) },
		{
			label: 'Delete…',
			icon: 'trash',
			danger: true,
			divider: true,
			action: () => void remove(name)
		}
	];

	function openMenu(e: MouseEvent, name: string): void {
		const el = e.currentTarget as HTMLElement;
		const r = el.getBoundingClientRect();
		trigger = el;
		menu = { name, at: { x: r.right - 200, y: r.bottom + 4 } };
	}
</script>

<section class="chooser" aria-labelledby="map-heading">
	<header>
		<div>
			<h1 id="map-heading">Mind maps</h1>
			<p>
				Arrange ideas, notes and tags on a canvas. Maps are JSON Canvas files in
				<code>.fr5a/maps</code>, synced with your notes.
			</p>
		</div>
		<button
			class="close"
			title="Close mind maps"
			aria-label="Close mind maps"
			onclick={() => app.setView('editor')}
		>
			<Icon name="close" size={18} />
		</button>
	</header>

	<div class="actions">
		<button class="primary" onclick={() => void create()}>
			<Icon name="plus" size={17} /> New map
		</button>
	</div>

	<div class="map-list">
		{#if app.settings.linkedNotes}
			<button class="map-row all" onclick={() => app.openMindMap('all')}>
				<span class="map-mark"><Icon name="graph" size={18} /></span>
				<span
					><strong>Graph (automatic)</strong><small>Every note, its links and its tags</small></span
				>
				<Icon name="chevron" size={17} />
			</button>
		{/if}
		{#each maps ?? [] as name (name)}
			<div class="map-row-wrap">
				<button class="map-row" onclick={() => app.openMindMap(name)}>
					<span class="map-mark"><Icon name="concept" size={18} /></span>
					<span><strong dir="auto">{name}</strong><small>Mind map</small></span>
					<Icon name="chevron" size={17} />
				</button>
				<button
					class="more"
					aria-label={`Actions for ${name}`}
					title="Rename, duplicate, delete"
					onclick={(e) => openMenu(e, name)}><Icon name="more" size={18} /></button
				>
			</div>
		{/each}
		{#if maps && maps.length === 0}
			<p class="empty">No maps yet. Start one with New map.</p>
		{/if}
	</div>
</section>

{#if menu}
	<ActionMenu
		items={items(menu.name)}
		at={menu.at}
		sheet={app.layout === 'phone'}
		title={menu.name}
		label="Map actions"
		{trigger}
		onclose={() => (menu = null)}
	/>
{/if}

<style>
	button {
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
	}
	.chooser {
		flex: 1;
		min-width: 0;
		height: 100%;
		overflow: auto;
		background: var(--bg-editor);
		border-radius: 12px;
		box-shadow: var(--shadow-pane);
		padding: max(28px, env(safe-area-inset-top)) clamp(16px, 6vw, 72px)
			max(32px, env(safe-area-inset-bottom));
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		max-width: 780px;
		margin: 0 auto 26px;
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
	.close,
	.more {
		flex: none;
		width: var(--btn-h);
		height: var(--btn-h);
		display: grid;
		place-items: center;
		border-radius: var(--btn-radius);
		color: var(--text-muted);
		transition:
			background var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	.close:active,
	.more:active {
		transform: scale(var(--press-icon));
	}
	.actions {
		max-width: 780px;
		margin: 0 auto 18px;
		display: flex;
		gap: 10px;
	}
	.actions button {
		min-height: var(--btn-h);
		padding: 0 15px;
		display: flex;
		align-items: center;
		gap: 8px;
		border-radius: var(--btn-radius);
		font-weight: 600;
		transition: transform var(--dur-fast) ease;
	}
	.actions button:active {
		transform: scale(var(--press));
	}
	.actions .primary {
		background: var(--accent);
		color: var(--on-accent);
		transition:
			filter var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	@media (hover: hover) {
		.actions .primary:hover {
			filter: brightness(1.08);
		}
	}
	.map-list {
		max-width: 780px;
		margin: auto;
		border-top: 1px solid var(--rule);
	}
	.map-row-wrap {
		display: flex;
		align-items: center;
		border-bottom: 1px solid var(--rule);
	}
	.map-row {
		flex: 1;
		min-width: 0;
		min-height: 68px;
		padding: 12px 8px;
		display: grid;
		grid-template-columns: 42px minmax(0, 1fr) 24px;
		align-items: center;
		gap: 12px;
		text-align: start;
		color: var(--text);
		transition: background var(--dur-fast) ease;
	}
	.map-row.all {
		width: 100%;
		border-bottom: 1px solid var(--rule);
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
		background: var(--accent-soft);
		color: var(--accent-ink);
	}
	.all .map-mark {
		background: var(--bg-hover);
		color: var(--text-muted);
	}
	.more {
		margin: 0 4px;
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
		.actions button {
			flex: 1;
			justify-content: center;
		}
	}
	:global([data-touch]) .chooser .actions button {
		min-height: var(--btn-h-sheet);
	}
	:global([data-touch]) .close,
	:global([data-touch]) .more {
		width: 50px;
		height: 50px;
	}
	@media (hover: hover) and (pointer: fine) {
		.close:hover,
		.more:hover,
		.map-row:hover {
			background: var(--bg-hover);
		}
	}
</style>
