<script lang="ts">
	import { getAppState } from '../stores/app.svelte';

	interface Props {
		/** Current width of the pane this edge belongs to. */
		value: number;
		min: number;
		max: number;
		/** 'end': the pane is before the handle (drag right grows it); 'start': after (drag left grows). */
		edge?: 'end' | 'start';
		label: string;
		onresize(px: number): void;
		/** Double-click / double-tap: back to the default width. */
		onreset(): void;
	}

	let { value, min, max, edge = 'end', label, onresize, onreset }: Props = $props();
	const app = getAppState();

	let drag: { x: number; from: number; id: number } | null = null;
	let active = $state(false);
	const sign = $derived((edge === 'end' ? 1 : -1) * (document.dir === 'rtl' ? -1 : 1));

	function down(e: PointerEvent): void {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { x: e.clientX, from: value, id: e.pointerId };
		active = true;
		app.resizing = true;
	}

	function move(e: PointerEvent): void {
		if (!drag || e.pointerId !== drag.id) return;
		onresize(drag.from + (e.clientX - drag.x) * sign);
	}

	function up(e: PointerEvent): void {
		if (!drag || e.pointerId !== drag.id) return;
		drag = null;
		active = false;
		app.resizing = false;
	}

	function key(e: KeyboardEvent): void {
		const step = e.shiftKey ? 48 : 16;
		if (e.key === 'ArrowRight') onresize(value + step * sign);
		else if (e.key === 'ArrowLeft') onresize(value - step * sign);
		else if (e.key === 'Home') onresize(min);
		else if (e.key === 'End') onresize(max);
		else return;
		e.preventDefault();
	}
</script>

<!-- A focusable separator is the ARIA "splitter" pattern (arrow keys resize). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	class={['resizer', { active, start: edge === 'start' }]}
	role="separator"
	aria-orientation="vertical"
	aria-label={label}
	aria-valuenow={Math.round(value)}
	aria-valuemin={min}
	aria-valuemax={max}
	tabindex="0"
	title="Drag to resize · double-click to reset"
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	onlostpointercapture={up}
	ondblclick={onreset}
	onkeydown={key}
></div>

<style>
	.resizer {
		position: relative;
		flex: 0 0 0px;
		width: 0;
		z-index: 6;
		cursor: col-resize;
		touch-action: none;
		outline: none;
	}
	/* Generous invisible hit area straddling the gap between panes. */
	.resizer::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: -7px;
		width: 14px;
	}
	:global(html[data-touch]) .resizer::before {
		left: -11px;
		width: 22px;
	}
	/* The visible line: fades in on hover, focus and while dragging. */
	.resizer::after {
		content: '';
		position: absolute;
		top: 12px;
		bottom: 12px;
		left: -1.5px;
		width: 3px;
		border-radius: 2px;
		background: var(--accent);
		opacity: 0;
		transition: opacity var(--dur-fast) ease;
	}
	.resizer:hover::after {
		opacity: 0.35;
		transition-delay: 120ms;
	}
	.resizer.active::after,
	.resizer:focus-visible::after {
		opacity: 0.8;
		transition-delay: 0ms;
	}
</style>
