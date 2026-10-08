<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { tick } from 'svelte';
	import { portal, reducedMotion } from '../portal';
	import { getAppState } from '../stores/app.svelte';

	/**
	 * Insert → Table: pick a size on a grid (click a cell, or arrows + Enter).
	 * Rows count the header. A popover at `at`, or on phones a bottom sheet
	 * with bigger cells, where a tap sizes and Insert confirms.
	 */
	interface Props {
		at: { x: number; y: number };
		sheet?: boolean;
		/** The button that opened it: pressing it doesn't count as "outside". */
		trigger?: HTMLElement | null;
		onpick(cols: number, rows: number): void;
		onclose(): void;
	}

	let { at, sheet = false, trigger = null, onpick, onclose }: Props = $props();

	const max = $derived(sheet ? { cols: 6, rows: 6 } : { cols: 8, rows: 8 });
	let cols = $state(3);
	let rows = $state(3);
	let el = $state<HTMLDivElement | null>(null);
	let grid = $state<HTMLDivElement | null>(null);
	let w = $state(240);
	let h = $state(0);
	const dur = reducedMotion() ? 0 : 1;

	const pos = $derived({
		left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)),
		top: Math.max(8, at.y + h + 8 > window.innerHeight ? at.y - h : at.y)
	});
	const label = $derived(
		`${cols} ${cols === 1 ? 'column' : 'columns'} × ${rows} ${rows === 1 ? 'row' : 'rows'}`
	);

	function pick(c = cols, r = rows): void {
		onclose();
		onpick(c, r);
	}

	const clamp = (n: number, hi: number) => Math.max(1, Math.min(hi, n));

	function onGridKey(e: KeyboardEvent): void {
		const rtl = grid ? getComputedStyle(grid).direction === 'rtl' : false;
		const step: Record<string, [number, number]> = {
			ArrowRight: [rtl ? -1 : 1, 0],
			ArrowLeft: [rtl ? 1 : -1, 0],
			ArrowDown: [0, 1],
			ArrowUp: [0, -1]
		};
		const d = step[e.key];
		if (!d) return;
		e.preventDefault();
		cols = clamp(cols + d[0], max.cols);
		rows = clamp(rows + d[1], max.rows);
		void focusCorner();
	}

	/** Roving focus: the cell at the table's far corner holds it. */
	async function focusCorner(): Promise<void> {
		await tick();
		grid
			?.querySelector<HTMLButtonElement>(`[data-cell="${cols - 1}:${rows - 1}"]`)
			?.focus({ preventScroll: true });
	}

	$effect(() => {
		void focusCorner();
		const outside = (e: PointerEvent) => {
			const t = e.target as Node;
			if (el && !el.contains(t) && !trigger?.contains(t)) onclose();
		};
		const key = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			onclose();
		};
		const undismiss = getAppState().onDismiss(() => onclose());
		window.addEventListener('pointerdown', outside, true);
		window.addEventListener('keydown', key, true);
		window.addEventListener('resize', onclose);
		return () => {
			undismiss();
			window.removeEventListener('pointerdown', outside, true);
			window.removeEventListener('keydown', key, true);
			window.removeEventListener('resize', onclose);
		};
	});
</script>

{#snippet body()}
	<div class="head">
		<span class="title">Insert table</span>
		<span class="size" aria-live="polite">{label}</span>
	</div>
	<div bind:this={grid} class="grid" style:--cols={max.cols} role="group" aria-label="Table size">
		{#each { length: max.rows }, r (r)}
			{#each { length: max.cols }, c (c)}
				<button
					class="cell"
					class:on={c < cols && r < rows}
					class:hdr={r === 0}
					data-cell="{c}:{r}"
					tabindex={c === cols - 1 && r === rows - 1 ? 0 : -1}
					aria-label="{c + 1} {c ? 'columns' : 'column'} × {r + 1} {r ? 'rows' : 'row'}"
					onkeydown={onGridKey}
					onpointerenter={() => {
						cols = c + 1;
						rows = r + 1;
					}}
					onclick={() => {
						// A tap on a phone only sizes (cells are close together): Insert confirms.
						if (sheet) {
							cols = c + 1;
							rows = r + 1;
						} else pick(c + 1, r + 1);
					}}
				></button>
			{/each}
		{/each}
	</div>
	<p class="hint">The first row is the header · Tab moves between cells</p>
{/snippet}

{#if sheet}
	<div use:portal class="sheet-root">
		<div class="scrim" transition:fade={{ duration: 180 * dur }}></div>
		<div
			bind:this={el}
			class="picker sheet"
			role="dialog"
			aria-label="Insert table"
			transition:fly={{ y: 60, duration: 240 * dur, opacity: 0 }}
		>
			<div class="grip" aria-hidden="true"></div>
			{@render body()}
			<button class="insert" onclick={() => pick()}>Insert {cols} × {rows}</button>
			<button class="cancel" onclick={onclose}>Cancel</button>
		</div>
	</div>
{:else}
	<div
		use:portal
		bind:this={el}
		bind:offsetWidth={w}
		bind:offsetHeight={h}
		class="picker pop"
		style:left="{pos.left}px"
		style:top="{pos.top}px"
		role="dialog"
		aria-label="Insert table"
		transition:fly={{ y: -4, duration: 120 * dur }}
	>
		{@render body()}
	</div>
{/if}

<style>
	.picker {
		--cell: 20px;
		--gap: 3px;
		background: var(--bg-editor);
	}
	.pop {
		position: fixed;
		z-index: 120;
		padding: 10px 12px 8px;
		border-radius: 11px;
		box-shadow:
			0 0 0 1px var(--bg-active),
			0 12px 32px rgba(0, 0, 0, 0.18);
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
		font-size: 12px;
	}
	.title {
		font-weight: 600;
		color: var(--text);
	}
	.size {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(var(--cols), var(--cell));
		gap: var(--gap);
		width: max-content;
		margin: 0 auto;
		padding: 2px;
	}
	.cell:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.cell {
		width: var(--cell);
		height: var(--cell);
		padding: 0;
		border-radius: 4px;
		box-shadow: inset 0 0 0 1px var(--table-line);
		background: transparent;
		transition: background var(--dur-fast) ease;
		touch-action: manipulation;
	}
	.cell.on {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.cell.on.hdr {
		background: var(--accent);
		opacity: 0.55;
	}
	.hint {
		margin: 8px 0 0;
		font-size: 11px;
		color: var(--text-faint);
		text-align: center;
	}

	/* --- phones: a bottom sheet with finger-sized cells -------------------- */
	.sheet-root {
		position: fixed;
		inset: 0;
		z-index: 120;
	}
	.scrim {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.32);
	}
	.sheet {
		--cell: 40px;
		--gap: 6px;
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 6px 16px calc(10px + env(safe-area-inset-bottom, 0px));
		border-radius: 18px 18px 0 0;
		box-shadow: 0 -10px 34px rgba(0, 0, 0, 0.2);
	}
	.sheet .head {
		font-size: 14px;
		padding: 0 4px;
	}
	.grip {
		width: 38px;
		height: 4px;
		margin: 4px auto 10px;
		border-radius: 2px;
		background: var(--bg-active);
	}
	.insert,
	.cancel {
		width: 100%;
		min-height: 50px;
		margin-top: 8px;
		border-radius: 12px;
		font-size: 16px;
		font-weight: 600;
	}
	.insert {
		background: var(--accent);
		color: #fff;
	}
	.cancel {
		margin-top: 6px;
		background: var(--bg-hover);
		color: var(--text);
	}
	.insert:active,
	.cancel:active {
		filter: brightness(0.95);
	}
</style>
