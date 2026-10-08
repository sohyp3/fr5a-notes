<script lang="ts">
	import { scale } from 'svelte/transition';
	import { tick } from 'svelte';
	import { portal, reducedMotion } from '../portal';
	import { getAppState } from '../stores/app.svelte';
	import { HIGHLIGHT_COLORS, type HighlightColor } from '../editor/highlights';
	import Icon from './Icon.svelte';

	/**
	 * Highlight colors: a row of swatches and an eraser, centred on `at.x`.
	 * The selection's color shows pressed, and pressing it again clears the
	 * highlight. Presses never take focus from the editor (the touch keyboard
	 * stays up); `focus` moves it in for keyboard use (opened from a menu).
	 */
	interface Props {
		at: { x: number; y: number };
		/** Open above `at.y` (over the touch toolbar) rather than below it. */
		above?: boolean;
		/** The color all of the selection has, if one does. */
		current: HighlightColor | null;
		/** Some of the selection is highlighted: the eraser has work to do. */
		any: boolean;
		focus?: boolean;
		/** The button that opened it: pressing it doesn't count as "outside". */
		trigger?: HTMLElement | null;
		/** A color to paint, or null to clear. */
		onpick(color: HighlightColor | null): void;
		onclose(): void;
	}

	let {
		at,
		above = false,
		current,
		any,
		focus = false,
		trigger = null,
		onpick,
		onclose
	}: Props = $props();

	let el = $state<HTMLDivElement | null>(null);
	let w = $state(220);
	let h = $state(0);
	const dur = reducedMotion() ? 0 : 1;

	const pos = $derived({
		left: Math.max(8, Math.min(at.x - w / 2, window.innerWidth - w - 8)),
		top: Math.max(8, above || at.y + h + 8 > window.innerHeight ? at.y - h : at.y)
	});

	const label = (c: HighlightColor) => c[0].toUpperCase() + c.slice(1);

	function pick(color: HighlightColor | null): void {
		onclose();
		onpick(color);
	}

	function onKey(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onclose();
			return;
		}
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const buttons = [...(el?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
		const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (i === -1) return;
		e.preventDefault();
		const rtl = getComputedStyle(el!).direction === 'rtl';
		const step = (e.key === 'ArrowRight') !== rtl ? 1 : -1;
		buttons[(i + step + buttons.length) % buttons.length].focus();
	}

	function outside(e: PointerEvent): void {
		const t = e.target as Node;
		if (el && !el.contains(t) && !trigger?.contains(t)) onclose();
	}

	/** Keyboard use: focus the selection's color (else the first) once on screen. */
	function focusCurrent(node: HTMLElement): void {
		if (!focus) return;
		void tick().then(() =>
			node
				.querySelector<HTMLButtonElement>(`[data-color="${current ?? HIGHLIGHT_COLORS[0]}"]`)
				?.focus({ preventScroll: true })
		);
	}

	// Android back closes the picker (not the pane under it).
	$effect(() => getAppState().onDismiss(() => onclose()));
</script>

<svelte:window onpointerdowncapture={outside} onkeydowncapture={onKey} onresize={onclose} />

<div
	{@attach portal}
	{@attach focusCurrent}
	bind:this={el}
	bind:offsetWidth={w}
	bind:offsetHeight={h}
	class="picker"
	style:left="{pos.left}px"
	style:top="{pos.top}px"
	role="toolbar"
	aria-label="Highlight color"
	transition:scale={{ start: 0.96, duration: 120 * dur }}
>
	{#each HIGHLIGHT_COLORS as c (c)}
		<button
			class="swatch"
			data-color={c}
			style:--swatch="var(--mark-{c})"
			aria-label={label(c)}
			aria-pressed={current === c}
			title={current === c ? `${label(c)} — press again to remove` : label(c)}
			onpointerdown={(e) => e.preventDefault()}
			onclick={() => pick(current === c ? null : c)}
		>
			<span class="dot">
				{#if current === c}<Icon name="check" size={13} stroke={2.6} />{/if}
			</span>
		</button>
	{/each}
	<span class="sep" aria-hidden="true"></span>
	<button
		class="erase"
		aria-label="Remove highlight"
		title="Remove highlight"
		disabled={!any}
		onpointerdown={(e) => e.preventDefault()}
		onclick={() => pick(null)}
	>
		<Icon name="eraser" size={16} stroke={1.8} />
	</button>
</div>

<style>
	.picker {
		--size: 30px;
		--dot: 20px;
		position: fixed;
		z-index: 120;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 5px;
		border-radius: 12px;
		background: var(--bg-editor);
		box-shadow:
			0 0 0 1px var(--bg-active),
			0 12px 32px rgba(0, 0, 0, 0.18);
	}
	:global(html[data-touch]) .picker {
		--size: 44px;
		--dot: 28px;
	}
	.swatch,
	.erase {
		width: var(--size);
		height: var(--size);
		display: grid;
		place-items: center;
		border-radius: 8px;
		touch-action: manipulation;
	}
	.swatch:hover,
	.erase:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.swatch:focus-visible,
	.erase:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	/* The swatch is the highlight itself, on the editor's surface. */
	.dot {
		width: var(--dot);
		height: var(--dot);
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--swatch);
		box-shadow: inset 0 0 0 1px var(--table-line);
		color: var(--text-strong);
	}
	.swatch[aria-pressed='true'] .dot {
		box-shadow:
			inset 0 0 0 1px var(--table-line),
			0 0 0 2px var(--bg-editor),
			0 0 0 3.5px var(--text-muted);
	}
	.sep {
		width: 1px;
		height: calc(var(--size) - 12px);
		margin: 0 3px;
		background: var(--bg-active);
	}
	.erase {
		color: var(--text-muted);
	}
	.erase:disabled {
		opacity: 0.35;
	}
</style>
