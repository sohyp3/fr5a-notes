<script lang="ts">
	import { onMount } from 'svelte';
	import { getAppState } from '../stores/app.svelte';
	import { platform } from '../platform';
	import { parentOf } from '../../../../shared/paths';
	import { buildNoteGraph, connectedIds, type GraphNode, type NoteGraph } from '../linkedNotes';
	import EmptyState from './EmptyState.svelte';
	import Icon from './Icon.svelte';
	import mascotNew from '$lib/assets/fr5a-new.png';

	const app = getAppState();
	const EMPTY: NoteGraph = { nodes: [], edges: [] };
	let graph = $state.raw<NoteGraph>(EMPTY);
	let loading = $state(true);
	let error = $state('');
	let query = $state('');
	let selectedId = $state(app.activeId ?? '');
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let loadRun = 0;
	let searchEl = $state<HTMLInputElement>();

	const phone = $derived(app.layout === 'phone');
	// Wide touch tablets keep the graph's tablet topology even though the app
	// shell has enough room for its usual three-pane layout.
	const tablet = $derived(app.layout === 'tablet' || (app.touch && app.layout === 'desktop'));
	const nodeById = $derived(new Map(graph.nodes.map((node) => [node.id, node])));
	const selected = $derived(nodeById.get(selectedId));
	const limit = $derived(tablet ? 260 : 500);
	const connected = $derived(selectedId ? connectedIds(graph, selectedId) : new Set<string>());
	const displayIds = $derived.by(() => {
		if (phone && selectedId) return connected;
		const ids = graph.nodes.slice(0, limit).map((node) => node.id);
		return new Set(selectedId ? [...ids, selectedId] : ids);
	});
	const displayNodes = $derived(graph.nodes.filter((node) => displayIds.has(node.id)));
	const displayEdges = $derived(
		graph.edges.filter((edge) => displayIds.has(edge.from) && displayIds.has(edge.to))
	);
	const outgoing = $derived(
		graph.edges.filter((edge) => edge.from === selectedId).map((edge) => nodeById.get(edge.to)!)
	);
	const incoming = $derived(
		graph.edges.filter((edge) => edge.to === selectedId).map((edge) => nodeById.get(edge.from)!)
	);
	const noteCount = $derived(graph.nodes.filter((node) => !node.missing).length);
	const unlinked = $derived(
		graph.nodes.filter((node) => !node.missing && node.degree === 0).length
	);
	const normalizedQuery = $derived(query.trim().toLocaleLowerCase());
	const hiddenCount = $derived(Math.max(0, graph.nodes.length - displayNodes.length));

	// Phones show the selected note with its neighbours on one or two rings.
	const phonePoints = $derived.by(
		() =>
			new Map<string, { x: number; y: number }>(
				selectedId
					? [
							[selectedId, { x: 500, y: 340 }],
							...displayNodes
								.filter((node) => node.id !== selectedId)
								.map((node, index, neighbors) => {
									const angle = (index / Math.max(neighbors.length, 1)) * Math.PI * 2 - Math.PI / 2;
									const ring = neighbors.length > 8 && index >= 8 ? 205 : 140;
									return [
										node.id,
										{ x: 500 + Math.cos(angle) * ring, y: 340 + Math.sin(angle) * ring }
									] as const;
								})
						]
					: []
			)
	);

	function point(node: GraphNode): { x: number; y: number } {
		return (phone ? phonePoints.get(node.id) : undefined) ?? { x: node.x, y: node.y };
	}

	/** Dot radius: busier notes read a little larger. */
	const radius = (node: GraphNode) => 6 + Math.min(node.degree, 7) * 0.8;
	/** Phone labels sit under their dot, so long titles are shortened (the full one is the node's name). */
	const label = (node: GraphNode) =>
		phone && node.title.length > 18 ? `${node.title.slice(0, 17).trimEnd()}…` : node.title;

	// The base frame of the layout, grown to take in every dot and (roughly) its
	// label, so nothing sits outside the map.
	const view = $derived.by(() => {
		let x0 = phone ? 300 : 0;
		let y0 = phone ? 100 : 0;
		let x1 = phone ? 700 : 1000;
		let y1 = phone ? 580 : 700;
		for (const node of displayNodes) {
			const at = point(node);
			const r = radius(node);
			const text = label(node).length * 6.6;
			x0 = Math.min(x0, at.x - (phone ? text / 2 : r) - 16);
			x1 = Math.max(x1, at.x + (phone ? text / 2 : r + 8 + text) + 16);
			y0 = Math.min(y0, at.y - r - 16);
			y1 = Math.max(y1, at.y + (phone ? r + 30 : r) + 16);
		}
		return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
	});

	function matches(node: GraphNode): boolean {
		return (
			!normalizedQuery || `${node.title} ${node.id}`.toLocaleLowerCase().includes(normalizedQuery)
		);
	}

	/** The note's folder, for the second line of a link row. */
	function folderOf(node: GraphNode): string {
		if (node.missing) return 'Not created yet';
		const dir = parentOf(node.id);
		return dir ? `${dir}/` : '';
	}

	const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
	const summary = $derived.by(() => {
		if (loading) return 'Reading links…';
		if (error) return 'The map couldn’t be built';
		const counts = [plural(noteCount, 'note'), plural(graph.edges.length, 'link')];
		if (graph.edges.length) counts.push(`${unlinked} unlinked`);
		return counts.join(' · ');
	});

	async function load(): Promise<void> {
		const run = ++loadRun;
		loading = true;
		error = '';
		try {
			// Hidden notes stay hidden. Locked encrypted notes have no readable body and
			// remain metadata-only until their vault is unlocked.
			const notes = app.listedNotes.filter((note) => !note.encrypted || app.vault?.unlocked);
			const rows = await Promise.all(
				notes.map(async (note) => {
					try {
						return [note.id, await platform.readNote(note.id)] as const;
					} catch {
						return [note.id, ''] as const;
					}
				})
			);
			if (run !== loadRun) return;
			graph = buildNoteGraph(notes, new Map(rows));
			if (!graph.nodes.some((node) => node.id === selectedId))
				selectedId = graph.nodes.find((node) => node.degree > 0)?.id ?? graph.nodes[0]?.id ?? '';
		} catch (cause) {
			if (run === loadRun) error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (run === loadRun) loading = false;
		}
	}

	onMount(() => {
		void load();
		return () => {
			loadRun++;
			graph = EMPTY;
		};
	});

	function select(node: GraphNode): void {
		selectedId = node.id;
	}

	function open(node = selected): void {
		if (!node || node.missing) return;
		void app.openNote(node.id);
	}

	function findFirst(): void {
		if (!normalizedQuery) return;
		const hit = graph.nodes.find(matches);
		if (hit) selectedId = hit.id;
	}

	function changeZoom(delta: number): void {
		zoom = Math.min(2.2, Math.max(0.65, zoom + delta));
	}

	function resetView(): void {
		zoom = 1;
		panX = 0;
		panY = 0;
	}

	let drag = $state<{ x: number; y: number; panX: number; panY: number; id: number } | null>(null);
	function panStart(event: PointerEvent): void {
		if (event.button !== 0) return;
		const svg = event.currentTarget as SVGSVGElement;
		svg.setPointerCapture(event.pointerId);
		drag = { x: event.clientX, y: event.clientY, panX, panY, id: event.pointerId };
	}
	function panMove(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.id) return;
		const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
		// The map is fitted whole ("meet"), so one screen pixel is this many map units.
		const unit = Math.max(view.w / Math.max(box.width, 1), view.h / Math.max(box.height, 1));
		panX = drag.panX + (event.clientX - drag.x) * unit;
		panY = drag.panY + (event.clientY - drag.y) * unit;
	}
	function panEnd(event: PointerEvent): void {
		if (drag?.id === event.pointerId) drag = null;
	}
	function wheel(event: WheelEvent): void {
		event.preventDefault();
		changeZoom(event.deltaY > 0 ? -0.1 : 0.1);
	}
</script>

{#snippet linkGroup(title: string, nodes: GraphNode[])}
	<section class="links">
		<h3>{title}</h3>
		<ul>
			{#each nodes as node (node.id)}
				{@const dir = folderOf(node)}
				<li>
					<button class={['link-row', { missing: node.missing }]} onclick={() => select(node)}>
						<span class="fname">
							<span class="name">{node.title}</span>
							{#if dir}<span class="dir">{dir}</span>{/if}
						</span>
						<Icon name="chevron" size={15} />
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

<section class={['linked-notes', { phone, tablet }]} aria-label="Linked notes">
	<header class="head">
		<div class="titles">
			<h1>Linked notes</h1>
			<p class="sub">{summary}</p>
		</div>
		<label class="search">
			<Icon name="search" size={14} />
			<input
				bind:this={searchEl}
				bind:value={query}
				placeholder={phone ? 'Find a note' : 'Find in the map'}
				aria-label="Find a note in the graph"
				spellcheck="false"
				onkeydown={(event) => {
					if (event.key === 'Enter') findFirst();
					else if (event.key === 'Escape' && query) {
						event.stopPropagation();
						query = '';
					}
				}}
			/>
			{#if query}
				<button
					class="clear"
					title="Clear search (Esc)"
					aria-label="Clear search"
					onmousedown={(event) => event.preventDefault()}
					onclick={() => {
						query = '';
						if (!app.touch) searchEl?.focus();
					}}
				>
					<Icon name="close" size={14} stroke={2} />
				</button>
			{/if}
		</label>
		<button
			class={['icon-btn', { spin: loading }]}
			title="Refresh links"
			aria-label="Refresh links"
			onclick={load}
		>
			<Icon name="retry" size={16} />
		</button>
		<button
			class="icon-btn"
			aria-label="Close linked notes"
			title="Close"
			onclick={() => app.setView('editor')}
		>
			<Icon name="close" size={17} />
		</button>
	</header>

	{#if loading}
		<div class="state" aria-live="polite">
			<p class="muted">Connecting your notes… Links are read on this device only.</p>
		</div>
	{:else if error}
		<div class="state" role="alert">
			<p class="error">{error}</p>
			<button class="btn" onclick={load}>Try again</button>
		</div>
	{:else if graph.edges.length === 0}
		<div class="state">
			<EmptyState
				src={mascotNew}
				title="Your first connection starts in a note"
				body="Type [[Note title]] in any note. The link stays plain Markdown and shows up here the next time you open the map."
			>
				{#snippet action()}
					<button class="cta" onclick={() => app.setView('editor')}>Back to your notes</button>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div class="workspace">
			<div class="canvas">
				<div class="map-tools" role="toolbar" aria-label="Map controls">
					<button aria-label="Zoom out" title="Zoom out" onclick={() => changeZoom(-0.15)}>
						<Icon name="minus" size={15} />
					</button>
					<button
						class="zoom-value"
						aria-label="Reset map view"
						title="Reset view"
						onclick={resetView}>{Math.round(zoom * 100)}%</button
					>
					<button aria-label="Zoom in" title="Zoom in" onclick={() => changeZoom(0.15)}>
						<Icon name="plus" size={15} />
					</button>
				</div>
				<svg
					class={{ dragging: !!drag }}
					viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
					role="group"
					aria-label="Map of linked notes. Select a note for its incoming and outgoing links."
					onpointerdown={panStart}
					onpointermove={panMove}
					onpointerup={panEnd}
					onpointercancel={panEnd}
					onwheel={wheel}
				>
					<g
						transform={`translate(${panX} ${panY}) translate(${view.x + view.w / 2} ${view.y + view.h / 2}) scale(${zoom}) translate(${-(view.x + view.w / 2)} ${-(view.y + view.h / 2)})`}
					>
						{#each displayEdges as edge (`${edge.from}:${edge.to}`)}
							{@const a = point(nodeById.get(edge.from)!)}
							{@const b = point(nodeById.get(edge.to)!)}
							<line
								x1={a.x}
								y1={a.y}
								x2={b.x}
								y2={b.y}
								class={{ active: edge.from === selectedId || edge.to === selectedId }}
							/>
						{/each}
						{#each displayNodes as node (node.id)}
							{@const at = point(node)}
							{@const r = radius(node)}
							<g
								class={[
									'node',
									{ selected: node.id === selectedId, missing: node.missing, dim: !matches(node) }
								]}
								transform={`translate(${at.x} ${at.y})`}
								role="button"
								tabindex="0"
								aria-label={`${node.title}, ${node.degree} ${node.degree === 1 ? 'connection' : 'connections'}${node.missing ? ', missing note' : ''}`}
								onpointerdown={(event) => event.stopPropagation()}
								onclick={() => select(node)}
								ondblclick={() => open(node)}
								onkeydown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault();
										select(node);
									}
								}}
							>
								{#if node.id === selectedId}<circle class="halo" r={r + 9} />{/if}
								<circle class="hit" r="28" />
								<circle class="dot" {r} />
								{#if phone}
									<text y={r + 17} text-anchor="middle">{label(node)}</text>
								{:else}
									<text x={r + 7} y="4">{node.title}</text>
								{/if}
								<title>{node.id}</title>
							</g>
						{/each}
					</g>
				</svg>
				<div class="map-foot">
					{#if phone}
						<p>Tap a note to bring its connections into focus</p>
					{:else}
						<p class="legend" aria-hidden="true">
							<span><i></i>Note</span><span><i class="broken"></i>Missing target</span>
						</p>
						{#if hiddenCount}
							<p>Showing the {displayNodes.length} most connected · {hiddenCount} more</p>
						{/if}
					{/if}
				</div>
			</div>

			{#if selected}
				<aside class="inspector" aria-label="Selected note details">
					<div class="detail-head">
						<div class="dtitle">
							<strong>{selected.title}</strong>
							<span
								>{selected.missing ? 'Linked, but no matching note exists yet' : selected.id} · {plural(
									selected.degree,
									'connection'
								)}</span
							>
						</div>
						{#if !selected.missing}
							<button class="btn primary" onclick={() => open()}>Open note</button>
						{/if}
					</div>
					{#if outgoing.length}{@render linkGroup('Links to', outgoing)}{/if}
					{#if incoming.length}{@render linkGroup('Linked from', incoming)}{/if}
					{#if selected.degree === 0}<p class="muted quiet">This note is not connected yet.</p>{/if}
				</aside>
			{/if}
		</div>
	{/if}
</section>

<style>
	.linked-notes {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-editor);
		border-radius: 12px;
		box-shadow: var(--shadow-pane);
		overflow: hidden;
	}
	.linked-notes.phone {
		border-radius: 0;
		box-shadow: none;
	}

	/* --- header (as in Changes) -------------------------------------------- */
	.head {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 18px 18px 12px 24px;
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	.phone .head {
		flex-wrap: wrap;
		padding: 10px 8px 10px 16px;
	}
	.titles {
		flex: 1;
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
		color: var(--text-strong);
	}
	.sub {
		margin: 2px 0 0;
		font-size: 12.5px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.icon-btn {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 9px;
		color: var(--text-muted);
		transition: background var(--dur-fast) ease;
	}
	:global(html[data-touch]) .icon-btn {
		width: 44px;
		height: 44px;
	}
	.icon-btn:hover,
	.icon-btn:active {
		background: var(--bg-hover);
		color: var(--text);
	}
	.icon-btn.spin :global(.icon) {
		animation: spin 800ms linear infinite;
	}

	/* --- search (as in the note list) -------------------------------------- */
	.search {
		flex: 0 1 280px;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		margin-inline-end: 4px;
		padding: 0 4px 0 10px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text-muted);
		transition: box-shadow var(--dur-fast) ease;
	}
	.phone .search {
		order: 1;
		flex: 1 1 100%;
		margin: 6px 8px 0 0;
	}
	.search:focus-within {
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.search input {
		flex: 1 1 auto;
		min-width: 0;
		width: 100%;
		height: 100%;
		border: none;
		background: none;
		outline: none;
		font-family: inherit;
		font-size: 13px;
		color: var(--text);
	}
	.search input::placeholder {
		color: var(--text-muted);
	}
	.clear {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		color: var(--text-faint);
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}
	.clear:hover,
	.clear:active {
		background: var(--bg-active);
		color: var(--text);
	}
	:global(html[data-touch]) .search {
		height: 44px;
		padding-inline-end: 0;
	}
	:global(html[data-touch]) .clear {
		width: 44px;
		height: 44px;
	}
	:global(html[data-touch]) .search input {
		font-size: 16px;
	}

	/* --- loading / error / empty ------------------------------------------- */
	.state {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 24px;
		overflow-y: auto;
		text-align: center;
		font-size: 13.5px;
		line-height: 1.6;
	}
	.state p {
		max-width: 420px;
		margin: 0;
	}
	.muted {
		color: var(--text-muted);
	}
	.error {
		color: var(--danger);
		overflow-wrap: anywhere;
	}
	.cta {
		margin-top: 14px;
		padding: 9px 18px;
		border-radius: 9px;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 13.5px;
		font-weight: 600;
		transition:
			filter var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .cta {
		min-height: 44px;
		font-size: 15px;
	}
	.cta:hover {
		filter: brightness(1.05);
	}
	.cta:active {
		transform: scale(0.97);
	}

	/* --- map ---------------------------------------------------------------- */
	.workspace {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 292px;
	}
	.tablet .workspace,
	.phone .workspace {
		display: flex;
		flex-direction: column;
	}
	.canvas {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: var(--bg-list);
		contain: strict;
	}
	.phone .canvas {
		min-height: 220px;
	}
	.canvas svg {
		width: 100%;
		height: 100%;
		display: block;
		touch-action: none;
		cursor: grab;
		user-select: none;
	}
	.canvas svg.dragging {
		cursor: grabbing;
	}
	.canvas line {
		stroke: var(--text-faint);
		stroke-width: 1;
		opacity: 0.55;
		vector-effect: non-scaling-stroke;
	}
	.canvas line.active {
		stroke: var(--accent);
		stroke-width: 1.6;
		opacity: 0.85;
	}
	.node {
		cursor: pointer;
		outline: none;
		transition: opacity var(--dur-fast) ease;
	}
	.node .hit {
		fill: transparent;
		pointer-events: all;
	}
	.node .dot {
		fill: var(--bg-editor);
		stroke: var(--text-muted);
		stroke-width: 1.8;
		vector-effect: non-scaling-stroke;
		transition:
			fill var(--dur-fast) ease,
			stroke var(--dur-fast) ease;
	}
	.node:hover .dot {
		stroke: var(--accent);
	}
	.node text {
		fill: var(--text);
		font: 500 12px var(--font-ui);
		paint-order: stroke;
		stroke: var(--bg-list);
		stroke-width: 4px;
		stroke-linejoin: round;
	}
	.phone .node text {
		font-size: 13px;
	}
	.node .halo {
		fill: var(--accent-soft);
	}
	.node.selected .dot {
		fill: var(--accent);
		stroke: var(--accent);
	}
	.node.selected text {
		fill: var(--text-strong);
		font-weight: 700;
	}
	.node.missing .dot {
		fill: transparent;
		stroke: var(--text-faint);
		stroke-dasharray: 3 3;
	}
	.node.missing text {
		fill: var(--text-muted);
		font-style: italic;
	}
	.node.dim {
		opacity: 0.15;
	}
	.node:focus-visible .dot {
		stroke: var(--accent);
		stroke-width: 3.5;
	}
	.node:focus-visible .hit {
		stroke: var(--accent);
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}

	/* Floating zoom control, the one raised surface on the map. */
	.map-tools {
		position: absolute;
		z-index: 2;
		top: 12px;
		inset-inline-start: 12px;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		border-radius: 10px;
		background: var(--bg-editor);
		box-shadow: var(--shadow-pane);
	}
	.map-tools button {
		display: grid;
		place-items: center;
		min-width: 30px;
		height: 30px;
		border-radius: 7px;
		color: var(--text-muted);
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}
	:global(html[data-touch]) .map-tools button {
		min-width: 44px;
		height: 44px;
	}
	.map-tools button:hover,
	.map-tools button:active {
		background: var(--bg-hover);
		color: var(--text);
	}
	.map-tools .zoom-value {
		min-width: 48px;
		padding: 0 4px;
		font-size: 11.5px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.map-foot {
		position: absolute;
		inset-inline: 16px;
		bottom: 12px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		pointer-events: none;
		font-size: 11px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.map-foot p {
		margin: 0;
	}
	.phone .map-foot {
		justify-content: center;
		bottom: 10px;
		color: var(--text-faint);
		text-align: center;
	}
	.legend {
		display: flex;
		gap: 14px;
	}
	.legend span {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.legend i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1.5px solid var(--text-muted);
		background: var(--bg-editor);
	}
	.legend i.broken {
		border-style: dashed;
		border-color: var(--text-faint);
		background: transparent;
	}

	/* --- inspector ---------------------------------------------------------- */
	.inspector {
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		padding: 6px 8px 16px;
		box-shadow: inset 1px 0 0 var(--bg-hover);
	}
	.tablet .inspector,
	.phone .inspector {
		flex: 0 0 auto;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		align-content: start;
		column-gap: 16px;
		max-height: 36%;
		padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));
		box-shadow: inset 0 1px 0 var(--bg-hover);
	}
	.phone .inspector {
		grid-template-columns: minmax(0, 1fr);
		max-height: 42%;
		padding: 2px 4px max(12px, env(safe-area-inset-bottom, 0px));
	}
	.detail-head {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		padding: 12px 10px 4px;
	}
	.dtitle {
		flex: 1 1 160px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.dtitle strong {
		font-size: 15px;
		font-weight: 700;
		line-height: 1.3;
		color: var(--text-strong);
		overflow-wrap: anywhere;
	}
	.dtitle span {
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--text-muted);
		overflow-wrap: anywhere;
		font-variant-numeric: tabular-nums;
	}
	.btn {
		flex: 0 0 auto;
		min-height: 32px;
		padding: 0 14px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text);
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		transition:
			background var(--dur-fast) ease,
			filter var(--dur-fast) ease;
	}
	:global(html[data-touch]) .btn {
		min-height: 44px;
	}
	.btn:hover,
	.btn:active {
		background: var(--bg-active);
	}
	.btn.primary {
		background: var(--accent);
		color: var(--on-accent);
	}
	.btn.primary:hover,
	.btn.primary:active {
		filter: brightness(1.08);
	}
	.links {
		min-width: 0;
	}
	.links h3 {
		margin: 0;
		padding: 14px 4px 4px 10px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.links ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.link-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 40px;
		padding: 6px 8px 6px 10px;
		border-radius: 8px;
		text-align: start;
		color: var(--text-faint);
		transition: background var(--dur-fast) ease;
	}
	:global(html[data-touch]) .link-row {
		min-height: 52px;
	}
	.link-row:hover {
		background: var(--bg-hover);
	}
	.link-row:active {
		background: var(--bg-active);
	}
	.link-row:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.fname {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.name {
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text-strong);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.link-row.missing .name {
		font-style: italic;
		color: var(--text-muted);
	}
	.dir {
		font-size: 11px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.quiet {
		margin: 8px 10px 0;
		font-size: 13px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
