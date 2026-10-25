<script lang="ts">
	import { onMount } from 'svelte';
	import { getAppState } from '../stores/app.svelte';
	import { platform } from '../platform';
	import { reducedMotion } from '../portal';
	import { parentOf } from '../../../../shared/paths';
	import {
		buildNoteGraph,
		connectedIds,
		layoutGraph,
		nodeRadius,
		tagPillWidth,
		type GraphEdge,
		type GraphNode,
		type NoteGraph
	} from '../linkedNotes';
	import EmptyState from './EmptyState.svelte';
	import Icon from './Icon.svelte';
	import mascotNew from '$lib/assets/fr5a-new.png';

	const app = getAppState();
	const EMPTY: NoteGraph = { nodes: [], edges: [] };
	let graph = $state.raw<NoteGraph>(EMPTY);
	let loading = $state(true);
	let error = $state('');
	let query = $state('');
	let selectedId = $state('');
	/** Notes visited through the panel, for its Back button. */
	let trail = $state<string[]>([]);
	let showTags = $state(true);
	let showLinks = $state(true);
	let showLoose = $state(false);
	let loadRun = 0;
	let searchEl = $state<HTMLInputElement>();
	let svgEl = $state<SVGSVGElement>();
	let width = $state(0);
	let height = $state(0);
	/** Camera: a map point p is drawn at p·k + (x, y). */
	let cam = $state({ x: 0, y: 0, k: 1 });

	const phone = $derived(app.layout === 'phone');
	// Wide touch tablets keep the stacked map + panel: the panel's rows need
	// the finger-sized room a side column can't give.
	const stacked = $derived(app.layout !== 'desktop' || app.touch);
	const nodeById = $derived(new Map(graph.nodes.map((node) => [node.id, node])));
	const selected = $derived(nodeById.get(selectedId));

	const edgeShown = (edge: GraphEdge) => (edge.kind === 'link' ? showLinks : showTags);
	const shownEdges = $derived(graph.edges.filter(edgeShown));
	/** Nodes on the map: tags and broken links with their toggles, notes while something joins them. */
	const shownIds = $derived(
		new Set([
			...shownEdges.flatMap((edge) => [edge.from, edge.to]),
			...(showLoose
				? graph.nodes.filter((node) => node.kind === 'note').map((node) => node.id)
				: []),
			...(nodeById.has(selectedId) ? [selectedId] : [])
		])
	);
	const displayNodes = $derived(graph.nodes.filter((node) => shownIds.has(node.id)));
	const displayEdges = $derived(
		shownEdges.filter((edge) => shownIds.has(edge.from) && shownIds.has(edge.to))
	);
	/** The selected node and its neighbours stay lit; the rest of the map steps back. */
	const focus = $derived(
		selectedId ? connectedIds({ nodes: [], edges: displayEdges }, selectedId) : null
	);

	const notes = $derived(graph.nodes.filter((node) => node.kind === 'note'));
	const tagCount = $derived(graph.nodes.filter((node) => node.kind === 'tag').length);
	const linkCount = $derived(graph.edges.filter((edge) => edge.kind === 'link').length);
	const looseCount = $derived(notes.filter((node) => node.degree === 0).length);
	const normalizedQuery = $derived(query.trim().toLocaleLowerCase());
	const matches = (node: GraphNode) =>
		!normalizedQuery || `${node.title} ${node.id}`.toLocaleLowerCase().includes(normalizedQuery);

	const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
	const summary = $derived.by(() => {
		if (loading) return 'Reading your notes…';
		if (error) return 'The map couldn’t be built';
		return [plural(notes.length, 'note'), plural(tagCount, 'tag'), plural(linkCount, 'link')].join(
			' · '
		);
	});

	// --- what the panel lists ---------------------------------------------------

	const neighbours = (id: string, pick: (edge: GraphEdge) => string | null): GraphNode[] =>
		graph.edges
			.map(pick)
			.filter((other): other is string => !!other)
			.map((other) => nodeById.get(other)!)
			.sort((a, b) => a.title.localeCompare(b.title));
	const linksTo = $derived(
		neighbours(selectedId, (e) => (e.kind === 'link' && e.from === selectedId ? e.to : null))
	);
	const linkedFrom = $derived(
		neighbours(selectedId, (e) => (e.kind === 'link' && e.to === selectedId ? e.from : null))
	);
	const noteTags = $derived(
		neighbours(selectedId, (e) => (e.kind === 'tag' && e.from === selectedId ? e.to : null))
	);
	const tagNotes = $derived(
		neighbours(selectedId, (e) => (e.kind === 'tag' && e.to === selectedId ? e.from : null))
	);
	const parentTag = $derived(
		neighbours(selectedId, (e) => (e.kind === 'nest' && e.from === selectedId ? e.to : null))
	);
	const childTags = $derived(
		neighbours(selectedId, (e) => (e.kind === 'nest' && e.to === selectedId ? e.from : null))
	);

	// --- drawing ------------------------------------------------------------------

	const tagLabel = (node: GraphNode) => `#${node.title}`;
	const noteLabel = (node: GraphNode) =>
		node.title.length > 26 ? `${node.title.slice(0, 25).trimEnd()}…` : node.title;
	/**
	 * Dots and labels grow slower than the map (√k), so zooming out still leaves
	 * them legible and zooming in spreads them apart.
	 */
	const glyph = $derived(Math.min(1.5, Math.max(0.6, Math.sqrt(cam.k))) / cam.k);
	/** Note titles show once there's room for them; tags always do. */
	const labelsOn = $derived(cam.k >= 0.6);

	// --- loading --------------------------------------------------------------------

	async function load(): Promise<void> {
		const run = ++loadRun;
		loading = true;
		error = '';
		try {
			// Hidden notes stay hidden. Locked encrypted notes have no readable body and
			// remain metadata-only until their vault is unlocked.
			const listed = app.listedNotes.filter((note) => !note.encrypted || app.vault?.unlocked);
			const rows = await Promise.all(
				listed.map(async (note) => {
					try {
						return [note.id, await platform.readNote(note.id)] as const;
					} catch {
						return [note.id, ''] as const;
					}
				})
			);
			if (run !== loadRun) return;
			const next = buildNoteGraph(listed, new Map(rows));
			await layoutGraph(next, () => run !== loadRun);
			if (run !== loadRun) return;
			graph = next;
			if (!next.nodes.some((node) => node.id === selectedId)) selectedId = '';
			trail = [];
			fit(false);
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
			stopFlight();
			graph = EMPTY;
		};
	});

	// --- camera -----------------------------------------------------------------------

	const K_MIN = 0.12;
	const K_MAX = 4;
	const clampK = (k: number) => Math.min(K_MAX, Math.max(K_MIN, k));
	let flight = 0;

	function stopFlight(): void {
		cancelAnimationFrame(flight);
		flight = 0;
	}

	/** Glide the camera to `to` (a jump when motion is off). */
	function fly(to: { x: number; y: number; k: number }, animate = true): void {
		stopFlight();
		if (!animate || reducedMotion()) {
			cam = to;
			return;
		}
		const from = { ...cam };
		const start = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / 360);
			const e = 1 - Math.pow(1 - t, 3);
			// Zoom in log space so a big change in scale feels even.
			const k = from.k * Math.pow(to.k / from.k, e);
			cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k };
			flight = t < 1 ? requestAnimationFrame(step) : 0;
		};
		flight = requestAnimationFrame(step);
	}

	/** The whole (shown) map in view. */
	function fit(animate = true): void {
		if (!width || !height || displayNodes.length === 0) return;
		let x0 = Infinity;
		let y0 = Infinity;
		let x1 = -Infinity;
		let y1 = -Infinity;
		for (const node of displayNodes) {
			x0 = Math.min(x0, node.x - 60);
			x1 = Math.max(x1, node.x + 60);
			y0 = Math.min(y0, node.y - 30);
			y1 = Math.max(y1, node.y + 40);
		}
		// Leave the floating controls their strips at the top and bottom.
		const top = 56;
		const bottom = 36;
		const k = clampK(Math.min(1.4, width / (x1 - x0), (height - top - bottom) / (y1 - y0)));
		fly(
			{
				k,
				x: width / 2 - ((x0 + x1) / 2) * k,
				y: top + (height - top - bottom) / 2 - ((y0 + y1) / 2) * k
			},
			animate
		);
	}

	/** Bring a node to the middle, close enough to read its neighbourhood. */
	function centerOn(node: GraphNode): void {
		const k = Math.min(Math.max(cam.k, 0.9), 1.8);
		fly({ k, x: width / 2 - node.x * k, y: height / 2 - node.y * k });
	}

	/** Scale by `factor` keeping the map point under (px, py) — canvas pixels — in place. */
	function zoomAt(factor: number, px = width / 2, py = height / 2, animate = false): void {
		const k = clampK(cam.k * factor);
		const wx = (px - cam.x) / cam.k;
		const wy = (py - cam.y) / cam.k;
		fly({ k, x: px - wx * k, y: py - wy * k }, animate);
	}

	// --- selection ------------------------------------------------------------------

	function select(id: string, from: 'map' | 'panel' = 'map'): void {
		const node = nodeById.get(id);
		if (!node) return;
		if (from === 'panel' && selectedId) trail = [...trail, selectedId];
		else if (from === 'map') trail = [];
		selectedId = id;
		centerOn(node);
	}

	function back(): void {
		const prev = trail.at(-1);
		if (!prev) return;
		trail = trail.slice(0, -1);
		selectedId = prev;
		const node = nodeById.get(prev);
		if (node) centerOn(node);
	}

	function clearSelection(): void {
		selectedId = '';
		trail = [];
	}

	function open(node: GraphNode | undefined = selected): void {
		if (!node || node.kind !== 'note') return;
		void app.openNote(node.id);
	}

	function findFirst(): void {
		if (!normalizedQuery) return;
		const hit = displayNodes.find(matches) ?? graph.nodes.find(matches);
		if (hit) select(hit.id);
	}

	// --- gestures: drag to pan, pinch / wheel to zoom, tap to select --------------

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- gesture bookkeeping, never drawn
	const pointers = new Map<number, { x: number; y: number }>();
	let gesture: {
		/** The node under a one-finger press, for a tap. */
		node: string;
		moved: boolean;
		x: number;
		y: number;
		cam: { x: number; y: number; k: number };
		/** Pinch: start distance and midpoint. */
		dist?: number;
		mx?: number;
		my?: number;
	} | null = null;
	let dragging = $state(false);
	let lastTap = { id: '', at: 0 };
	/**
	 * A tap acts on pointerup, and the panel it opens can land under the finger:
	 * that tap's click must not press whatever is there now.
	 */
	let swallowClickUntil = 0;
	function swallowClick(event: MouseEvent): void {
		if (performance.now() > swallowClickUntil) return;
		swallowClickUntil = 0;
		event.preventDefault();
		event.stopPropagation();
	}

	function local(event: PointerEvent): { x: number; y: number } {
		const box = svgEl!.getBoundingClientRect();
		return { x: event.clientX - box.left, y: event.clientY - box.top };
	}

	function startGesture(node: string): void {
		const pts = [...pointers.values()];
		if (pts.length >= 2) {
			const [a, b] = pts;
			gesture = {
				node: '',
				moved: true,
				x: 0,
				y: 0,
				cam: { ...cam },
				dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
				mx: (a.x + b.x) / 2,
				my: (a.y + b.y) / 2
			};
		} else if (pts.length === 1)
			gesture = { node, moved: gesture?.moved ?? false, ...pts[0], cam: { ...cam } };
	}

	function pointerDown(event: PointerEvent): void {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		stopFlight();
		svgEl!.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, local(event));
		const hit = (event.target as Element).closest<SVGGElement>('[data-id]');
		if (pointers.size === 1) gesture = null;
		startGesture(hit?.dataset.id ?? '');
	}

	function pointerMove(event: PointerEvent): void {
		if (!pointers.has(event.pointerId) || !gesture) return;
		pointers.set(event.pointerId, local(event));
		const pts = [...pointers.values()];
		if (pts.length >= 2 && gesture.dist) {
			const [a, b] = pts;
			const k = clampK(gesture.cam.k * (Math.hypot(b.x - a.x, b.y - a.y) / gesture.dist));
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			const wx = (gesture.mx! - gesture.cam.x) / gesture.cam.k;
			const wy = (gesture.my! - gesture.cam.y) / gesture.cam.k;
			cam = { k, x: mx - wx * k, y: my - wy * k };
			return;
		}
		const p = pts[0];
		const dx = p.x - gesture.x;
		const dy = p.y - gesture.y;
		if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
		gesture.moved = true;
		dragging = true;
		cam = { ...gesture.cam, x: gesture.cam.x + dx, y: gesture.cam.y + dy };
	}

	function pointerUp(event: PointerEvent): void {
		if (!pointers.delete(event.pointerId)) return;
		const ended = gesture;
		if (pointers.size > 0) {
			// One finger of a pinch lifted: the other pans on from here.
			startGesture('');
			return;
		}
		gesture = null;
		dragging = false;
		if (!ended || ended.moved || event.type === 'pointercancel') return;
		swallowClickUntil = performance.now() + 500;
		// A tap: on a node selects it (a second tap on it opens a note); on the
		// empty map lets go of the selection.
		if (!ended.node) return clearSelection();
		const now = performance.now();
		if (lastTap.id === ended.node && now - lastTap.at < 400 && ended.node === selectedId) {
			lastTap = { id: '', at: 0 };
			return open(nodeById.get(ended.node));
		}
		lastTap = { id: ended.node, at: now };
		select(ended.node);
	}

	/** Wheel / trackpad: zoom at the pointer (non-passive, so the page never scrolls). */
	function wheelZoom(svg: SVGSVGElement): () => void {
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rate = event.deltaMode === 1 ? 0.05 : event.ctrlKey ? 0.01 : 0.002;
			const box = svg.getBoundingClientRect();
			zoomAt(Math.exp(-event.deltaY * rate), event.clientX - box.left, event.clientY - box.top);
		};
		svg.addEventListener('wheel', onWheel, { passive: false });
		return () => svg.removeEventListener('wheel', onWheel);
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && selectedId) {
			event.stopPropagation();
			clearSelection();
		}
	}
</script>

{#snippet rows(title: string, nodes: GraphNode[])}
	{#if nodes.length}
		<section class="links">
			<h3>{title}</h3>
			<ul>
				{#each nodes as node (node.id)}
					{@const dir = node.kind === 'note' ? parentOf(node.id) : ''}
					<li class="row">
						<button
							class={['link-row', node.kind]}
							title="Show on the map"
							onclick={() => select(node.id, 'panel')}
						>
							<span class={['mark', node.kind]} aria-hidden="true"></span>
							<span class="fname">
								<span class="name">{node.kind === 'tag' ? `#${node.id.slice(1)}` : node.title}</span
								>
								{#if node.kind === 'missing'}
									<span class="dir">Not created yet</span>
								{:else if dir}
									<span class="dir">{dir}/</span>
								{/if}
							</span>
						</button>
						{#if node.kind === 'note'}
							<button
								class="open-btn"
								title="Open note"
								aria-label={`Open ${node.title}`}
								onclick={() => open(node)}
							>
								<Icon name="note" size={16} />
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/snippet}

<svelte:window onkeydown={keydown} />

<section
	class={['linked-notes', { phone, stacked }]}
	aria-label="All notes map"
	onclickcapture={swallowClick}
>
	<header class="head">
		<div class="titles">
			<h1>All notes</h1>
			<p class="sub">{summary}</p>
		</div>
		<label class="search">
			<Icon name="search" size={14} />
			<input
				bind:this={searchEl}
				bind:value={query}
				placeholder="Find a note or tag"
				aria-label="Find a note or tag on the map"
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
			title="Read the notes again"
			aria-label="Refresh map"
			onclick={load}
		>
			<Icon name="retry" size={16} />
		</button>
		<button
			class="icon-btn"
			aria-label="Close all notes map"
			title="Close"
			onclick={() => app.setView('editor')}
		>
			<Icon name="close" size={17} />
		</button>
	</header>

	{#if error}
		<div class="state" role="alert">
			<p class="error">{error}</p>
			<button class="btn" onclick={load}>Try again</button>
		</div>
	{:else if !loading && graph.edges.length === 0}
		<div class="state">
			<EmptyState
				src={mascotNew}
				title="Nothing connects yet"
				body="Tag notes with #topic, or link one from another with Insert → Link to note. Notes that share a tag or a link gather here."
			>
				{#snippet action()}
					<button class="cta" onclick={() => app.setView('editor')}>Back to your notes</button>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div class="workspace">
			<div class="canvas" bind:clientWidth={width} bind:clientHeight={height}>
				<svg
					bind:this={svgEl}
					class={{ dragging, labels: labelsOn, focused: !!focus, searching: !!normalizedQuery }}
					style:--g={glyph}
					role="group"
					aria-label="Map of your notes and tags. Drag to move, pinch or scroll to zoom, select a note to see its connections."
					onpointerdown={pointerDown}
					onpointermove={pointerMove}
					onpointerup={pointerUp}
					onpointercancel={pointerUp}
					{@attach wheelZoom}
				>
					<g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
						{#each displayEdges as edge (`${edge.from}\0${edge.to}`)}
							{@const a = nodeById.get(edge.from)!}
							{@const b = nodeById.get(edge.to)!}
							<line
								x1={a.x}
								y1={a.y}
								x2={b.x}
								y2={b.y}
								class={[
									edge.kind,
									{ lit: !!focus && (edge.from === selectedId || edge.to === selectedId) }
								]}
							/>
						{/each}
						{#each displayNodes as node (node.id)}
							{@const r = nodeRadius(node)}
							<g
								class={[
									'node',
									node.kind,
									{
										selected: node.id === selectedId,
										near: !!focus?.has(node.id),
										current: node.id === app.activeId,
										match: !!normalizedQuery && matches(node)
									}
								]}
								data-id={node.id}
								transform={`translate(${node.x} ${node.y})`}
								role="button"
								tabindex="0"
								aria-label={node.kind === 'tag'
									? `Tag ${node.id.slice(1)}`
									: `${node.title}${node.kind === 'missing' ? ', missing note' : ''}`}
								onkeydown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault();
										if (node.id === selectedId) open(node);
										else select(node.id);
									}
								}}
							>
								<g class="glyph">
									{#if node.kind === 'tag'}
										{@const w = tagPillWidth(node)}
										<rect class="pill" x={-w / 2} y="-11" width={w} height="22" rx="11" />
										<text class="tag-label" y="4.5" text-anchor="middle">{tagLabel(node)}</text>
									{:else}
										{#if node.id === selectedId}<circle class="halo" r={r + 7} />{/if}
										<circle class="hit" r={Math.max(r + 6, 16)} />
										<circle class="dot" {r} />
										<text y={r + 14} text-anchor="middle">{noteLabel(node)}</text>
									{/if}
								</g>
								<title>{node.kind === 'tag' ? `#${node.id.slice(1)}` : node.id}</title>
							</g>
						{/each}
					</g>
				</svg>

				<div class="map-tools" role="toolbar" aria-label="Map view">
					<button
						aria-label="Zoom out"
						title="Zoom out"
						onclick={() => zoomAt(1 / 1.35, undefined, undefined, true)}
					>
						<Icon name="minus" size={15} />
					</button>
					<span class="zoom-value" aria-live="polite">{Math.round(cam.k * 100)}%</span>
					<button
						aria-label="Zoom in"
						title="Zoom in"
						onclick={() => zoomAt(1.35, undefined, undefined, true)}
					>
						<Icon name="plus" size={15} />
					</button>
					<span class="sep" aria-hidden="true"></span>
					<button class="fit" title="Fit the whole map" onclick={() => fit()}>
						<Icon name="zenOn" size={14} />
						<span>Fit</span>
					</button>
				</div>

				{#if !(phone && selected)}
					<div class="filters" role="group" aria-label="Show on the map">
						<button
							class={['chip', { on: showTags }]}
							aria-pressed={showTags}
							onclick={() => (showTags = !showTags)}
						>
							<span class="key tag" aria-hidden="true"></span>Tags
						</button>
						<button
							class={['chip', { on: showLinks }]}
							aria-pressed={showLinks}
							onclick={() => (showLinks = !showLinks)}
						>
							<span class="key link" aria-hidden="true"></span>Links
						</button>
						{#if looseCount}
							<button
								class={['chip', { on: showLoose }]}
								aria-pressed={showLoose}
								title="Notes with no tags or links"
								onclick={() => (showLoose = !showLoose)}
							>
								<span class="key loose" aria-hidden="true"></span>Unconnected {looseCount}
							</button>
						{/if}
					</div>
				{/if}

				{#if loading}
					<div class="busy" aria-live="polite">Laying out your notes…</div>
				{:else if !selected}
					<p class="hint">
						{app.touch
							? 'Tap a note or tag to see what it connects to · pinch to zoom'
							: 'Click a note or tag to see what it connects to · scroll to zoom, drag to move'}
					</p>
				{/if}
			</div>

			{#if selected}
				<aside class="inspector" aria-label="Selected on the map">
					<div class="detail-head">
						{#if trail.length}
							<button class="icon-btn small" title="Back" aria-label="Back" onclick={back}>
								<Icon name="back" size={18} />
							</button>
						{/if}
						<div class="dtitle">
							{#if selected.kind === 'tag'}
								<strong>#{selected.id.slice(1)}</strong>
								<span>{plural(tagNotes.length, 'note')} tagged here</span>
							{:else if selected.kind === 'missing'}
								<strong>{selected.title}</strong>
								<span>Linked to, but there’s no note with this name yet</span>
							{:else}
								<strong>{selected.title}</strong>
								<span>{selected.id}</span>
							{/if}
						</div>
						{#if selected.kind === 'note'}
							<button class="btn primary" onclick={() => open()}>Open note</button>
						{:else if selected.kind === 'tag'}
							<button class="btn" onclick={() => app.selectTag(selected.id.slice(1))}>
								Show in list
							</button>
						{/if}
						<button
							class="icon-btn small"
							title="Close (Esc)"
							aria-label="Close"
							onclick={clearSelection}
						>
							<Icon name="close" size={16} />
						</button>
					</div>
					<div class="lists">
						{#if selected.kind === 'note'}
							{#if noteTags.length}
								<div class="tags">
									{#each noteTags as tag (tag.id)}
										<button class="tag-chip" onclick={() => select(tag.id, 'panel')}>
											#{tag.id.slice(1)}
										</button>
									{/each}
								</div>
							{/if}
							{@render rows('Links to', linksTo)}
							{@render rows('Linked from', linkedFrom)}
							{#if selected.degree === 0}
								<p class="muted quiet">
									No tags or links yet. Add a #tag, or link it from another note.
								</p>
							{/if}
						{:else if selected.kind === 'tag'}
							{@render rows('Inside', parentTag)}
							{@render rows('Nested tags', childTags)}
							{@render rows('Notes', tagNotes)}
						{:else}
							{@render rows('Linked from', linkedFrom)}
						{/if}
					</div>
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
	.icon-btn.small {
		width: 32px;
		height: 32px;
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

	/* --- error / empty --------------------------------------------------------- */
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
		transform: var(--press);
	}

	/* --- map ---------------------------------------------------------------- */
	.workspace {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.stacked .workspace {
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
		min-height: 240px;
	}
	.canvas svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		touch-action: none;
		cursor: grab;
		user-select: none;
		-webkit-user-select: none;
	}
	.canvas svg.dragging {
		cursor: grabbing;
	}

	/* Edges: tags faint, nesting dashed, note links in the accent. */
	line {
		vector-effect: non-scaling-stroke;
		stroke: var(--text-faint);
		stroke-width: 1;
		opacity: 0.4;
		transition: opacity var(--dur-fast) ease;
	}
	line.nest {
		stroke-dasharray: 3 3;
		opacity: 0.5;
	}
	line.link {
		stroke: var(--accent);
		stroke-width: 1.6;
		opacity: 0.75;
	}
	.focused line {
		opacity: 0.08;
	}
	.focused line.lit {
		opacity: 0.95;
		stroke-width: 2;
	}

	.node {
		cursor: pointer;
		outline: none;
		transition: opacity var(--dur-fast) ease;
	}
	.glyph {
		transform: scale(var(--g));
	}
	.focused .node:not(.near),
	.searching .node:not(.match) {
		opacity: 0.18;
	}
	.node .hit {
		fill: transparent;
	}
	.node .dot {
		fill: var(--text-muted);
		stroke: var(--bg-list);
		stroke-width: 1.5;
		transition: fill var(--dur-fast) ease;
	}
	.node:hover .dot,
	.node:focus-visible .dot {
		fill: var(--accent);
	}
	.node.current .dot {
		stroke: var(--accent);
		stroke-width: 2.5;
	}
	.node.selected .dot {
		fill: var(--accent);
	}
	.node .halo {
		fill: var(--accent-soft);
	}
	.node.missing .dot {
		fill: var(--bg-list);
		stroke: var(--text-faint);
		stroke-dasharray: 2.5 2;
	}
	.node text {
		fill: var(--text);
		font: 500 11.5px var(--font-ui);
		paint-order: stroke;
		stroke: var(--bg-list);
		stroke-width: 3.5px;
		stroke-linejoin: round;
		pointer-events: none;
	}
	/* Zoomed far out, a note's title waits for hover, focus or a search hit. */
	svg:not(.labels) .node.note text,
	svg:not(.labels) .node.missing text {
		opacity: 0;
		transition: opacity var(--dur-fast) ease;
	}
	svg .node:hover text,
	svg .node.near text,
	svg .node.match text {
		opacity: 1;
	}
	.node.selected text {
		fill: var(--text-strong);
		font-weight: 700;
	}
	.node.missing text {
		fill: var(--text-muted);
		font-style: italic;
	}
	.node.tag .pill {
		fill: var(--accent-soft);
		stroke: var(--accent);
		stroke-width: 1;
		stroke-opacity: 0.35;
		transition: fill var(--dur-fast) ease;
	}
	.node.tag text.tag-label {
		fill: var(--accent-ink);
		font-weight: 650;
		font-size: 12px;
		stroke: none;
	}
	.node.tag:hover .pill,
	.node.tag:focus-visible .pill {
		stroke-opacity: 0.9;
	}
	.node.tag.selected .pill {
		fill: var(--accent);
		stroke-opacity: 1;
	}
	.node.tag.selected text.tag-label {
		fill: var(--on-accent);
	}
	.node:focus-visible .hit {
		stroke: var(--accent);
		stroke-width: 1.5;
	}

	/* Floating controls: zoom at the top left, filters at the top right. */
	.map-tools,
	.filters {
		position: absolute;
		z-index: 2;
		top: 12px;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		border-radius: 10px;
		background: var(--bg-editor);
		box-shadow: var(--shadow-pane);
	}
	.map-tools {
		inset-inline-start: 12px;
	}
	.filters {
		inset-inline-end: 12px;
		flex-wrap: wrap;
		justify-content: flex-end;
		max-width: calc(100% - 210px);
	}
	.phone .filters {
		top: auto;
		bottom: 12px;
		inset-inline: 12px auto;
		max-width: calc(100% - 24px);
	}
	.map-tools button,
	.chip {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 30px;
		height: 30px;
		border-radius: 7px;
		color: var(--text-muted);
		font-size: 12.5px;
		font-weight: 600;
		white-space: nowrap;
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .map-tools button,
	:global(html[data-touch]) .chip {
		min-width: 44px;
		height: 44px;
	}
	.map-tools button:hover,
	.chip:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.map-tools button:active,
	.chip:active {
		transform: var(--press);
	}
	.map-tools .fit {
		padding-inline: 10px;
	}
	.zoom-value {
		min-width: 44px;
		text-align: center;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.sep {
		width: 1px;
		height: 18px;
		margin-inline: 2px;
		background: var(--bg-hover);
	}
	.chip {
		padding-inline: 10px;
		color: var(--text-faint);
	}
	.chip.on {
		color: var(--text);
	}
	.chip:not(.on) .key {
		opacity: 0.35;
	}
	.key {
		flex: 0 0 auto;
		display: inline-block;
	}
	.key.tag {
		width: 14px;
		height: 9px;
		border-radius: 5px;
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.key.link {
		width: 14px;
		height: 2px;
		border-radius: 1px;
		background: var(--accent);
	}
	.key.loose {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
	}

	.hint,
	.busy {
		position: absolute;
		inset-inline: 16px;
		bottom: 14px;
		margin: 0;
		pointer-events: none;
		text-align: center;
		font-size: 12px;
		color: var(--text-muted);
	}
	.phone .hint {
		bottom: 72px;
	}
	.busy {
		top: 50%;
		bottom: auto;
		font-size: 13px;
	}

	/* --- panel ---------------------------------------------------------------- */
	.inspector {
		width: 300px;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		box-shadow: inset 1px 0 0 var(--bg-hover);
	}
	.stacked .inspector {
		width: auto;
		flex: 0 0 auto;
		max-height: 42%;
		box-shadow:
			inset 0 1px 0 var(--bg-hover),
			0 -6px 18px rgba(0, 0, 0, 0.06);
	}
	.detail-head {
		flex: 0 0 auto;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 12px 8px 6px 12px;
	}
	/* Back, title and close keep one line; the action wraps below when it can't fit. */
	.detail-head > .btn {
		order: 1;
	}
	.stacked .detail-head > .btn {
		order: 0;
	}
	.dtitle {
		flex: 1 1 140px;
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
	}
	.lists {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 0 8px max(12px, env(safe-area-inset-bottom, 0px));
	}
	.stacked .lists {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		align-content: start;
		column-gap: 16px;
	}
	.stacked .lists > .tags,
	.stacked .lists > .quiet {
		grid-column: 1 / -1;
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
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 4px 4px 2px;
	}
	.tag-chip {
		height: 26px;
		padding: 0 10px;
		border-radius: 13px;
		background: var(--accent-soft);
		color: var(--accent-ink);
		font-size: 12.5px;
		font-weight: 600;
		transition: transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .tag-chip {
		height: 36px;
		padding: 0 14px;
		border-radius: 18px;
	}
	.tag-chip:active {
		transform: var(--press);
	}
	.links {
		min-width: 0;
	}
	.links h3 {
		margin: 0;
		padding: 14px 4px 4px 6px;
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
	.row {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.link-row {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		padding: 6px 8px;
		border-radius: 8px;
		text-align: start;
		transition: background var(--dur-fast) ease;
	}
	:global(html[data-touch]) .link-row {
		min-height: 52px;
	}
	.link-row:hover,
	.open-btn:hover {
		background: var(--bg-hover);
	}
	.link-row:active,
	.open-btn:active {
		background: var(--bg-active);
	}
	.link-row:focus-visible,
	.open-btn:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.open-btn {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		color: var(--text-muted);
	}
	:global(html[data-touch]) .open-btn {
		width: 48px;
		height: 48px;
	}
	.mark {
		flex: 0 0 auto;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
	}
	.mark.tag {
		width: 12px;
		height: 8px;
		border-radius: 4px;
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.mark.missing {
		background: none;
		box-shadow: inset 0 0 0 1.5px var(--text-faint);
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
	.link-row.tag .name {
		color: var(--accent-ink);
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
		margin: 8px 6px 0;
		font-size: 13px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
