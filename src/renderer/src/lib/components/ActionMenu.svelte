<script lang="ts" module>
	import type { IconName } from '../icons';

	export interface MenuItem {
		label: string;
		icon?: IconName;
		/** Small text after the label (shortcut, state). */
		hint?: string;
		danger?: boolean;
		disabled?: boolean;
		/** Draw a divider above this item. */
		divider?: boolean;
		action(): void;
	}
</script>

<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import Icon from './Icon.svelte';
	import { portal } from '../portal';
	import { dragToDismiss } from '../gesture';
	import { ms, popIn, scrimIn, scrimOut, sheetIn, sheetOut } from '../motion';
	import { getAppState } from '../stores/app.svelte';

	interface Props {
		items: MenuItem[];
		/** Screen point the menu hangs from (ignored as a sheet). */
		at: { x: number; y: number };
		/** Bottom action sheet (phones) instead of an anchored popover. */
		sheet?: boolean;
		/** Heading of the sheet. */
		title?: string;
		label: string;
		/** The button that toggles the menu: pressing it doesn't count as "outside". */
		trigger?: HTMLElement | null;
		onclose(): void;
	}

	let { items, at, sheet = false, title, label, trigger = null, onclose }: Props = $props();

	let el = $state<HTMLDivElement | null>(null);
	let w = $state(200);
	let h = $state(0);
	/** Closing: it fades out for a moment, deaf to input (Chromium 92 has no `inert`). */
	let leaving = false;
	/** Dragged off screen: it's already gone, so no outro. */
	let dismissed = $state(false);
	let scrimEl = $state<HTMLDivElement | null>(null);
	const dragOff = dragToDismiss(
		() => scrimEl,
		() => {
			dismissed = true;
			onclose();
		}
	);

	// Keep the popover inside the viewport (flip up / left when it would overflow).
	const pos = $derived({
		left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)),
		top: Math.max(8, at.y + h + 8 > window.innerHeight ? at.y - h : at.y)
	});
	// Grow from the corner it hangs from (it flips up / left near the edges).
	const origin = $derived(
		`${pos.left + 1 < at.x ? 'right' : 'left'} ${pos.top < at.y ? 'bottom' : 'top'}`
	);

	function leave(e: Event): void {
		leaving = true;
		const node = e.currentTarget as HTMLElement;
		node.style.pointerEvents = 'none';
		// Gone as far as anyone using it can tell (a new one may already be open).
		node.setAttribute('aria-hidden', 'true');
	}
	/** Reopened mid-fade, Svelte reverses the outro on this same instance: live again. */
	function arrive(e: Event): void {
		leaving = false;
		const node = e.currentTarget as HTMLElement;
		node.style.removeProperty('pointer-events');
		node.removeAttribute('aria-hidden');
	}

	function run(item: MenuItem): void {
		if (item.disabled) return;
		onclose();
		item.action();
	}

	function onKey(e: KeyboardEvent): void {
		if (leaving) return;
		// Tab leaves a menu (the menu pattern): close it, focus goes back.
		if (e.key === 'Tab') {
			e.preventDefault();
			onclose();
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onclose();
			return;
		}
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		const buttons = [
			...(el?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])
		];
		const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
		buttons[(next + buttons.length) % buttons.length]?.focus();
	}

	function outside(e: PointerEvent): void {
		const t = e.target as Node;
		if (leaving) return;
		if (el && !el.contains(t) && !trigger?.contains(t)) onclose();
	}

	function wheel(): void {
		if (!sheet && !leaving) onclose();
	}

	/**
	 * Focus the first item once the menu is on screen (after the portal moved
	 * it); when it goes, give focus back to what had it — unless the chosen item
	 * moved focus on purpose (a dialog, the editor).
	 */
	const focusFirst: Attachment<HTMLElement> = (node) => {
		const prev = document.activeElement as HTMLElement | null;
		void tick().then(() =>
			node
				.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')
				?.focus({ preventScroll: true })
		);
		return () => {
			const now = document.activeElement;
			if ((!now || now === document.body || node.contains(now)) && prev?.isConnected)
				prev.focus({ preventScroll: true });
		};
	};

	// Android back closes the menu (not the pane under it).
	$effect(() => getAppState().onDismiss(() => onclose()));
</script>

<svelte:window
	onpointerdowncapture={outside}
	onkeydowncapture={onKey}
	onresize={onclose}
	onwheelcapture={wheel}
/>

{#snippet rows()}
	{#each items as item (item.label)}
		{#if item.divider}<div class="sep" role="separator"></div>{/if}
		<button
			class={['item', { danger: item.danger }]}
			role="menuitem"
			disabled={item.disabled}
			onclick={() => run(item)}
		>
			{#if item.icon}<Icon name={item.icon} size={sheet ? 18 : 15} stroke={1.7} />{/if}
			<span class="lbl">{item.label}</span>
			{#if item.hint}<span class="hint">{item.hint}</span>{/if}
		</button>
	{/each}
{/snippet}

{#if sheet}
	<div {@attach portal} class="sheet-root">
		<div
			class="scrim"
			bind:this={scrimEl}
			in:fade|global={scrimIn}
			out:fade|global={dismissed ? { duration: 0 } : scrimOut}
			onoutrostart={leave}
			onintrostart={arrive}
		></div>
		<div
			bind:this={el}
			{@attach focusFirst}
			class="sheet"
			role="menu"
			aria-label={label}
			tabindex="-1"
			{@attach dragOff}
			in:fly|global={sheetIn}
			out:fly|global={dismissed ? { duration: 0 } : sheetOut}
			onoutrostart={leave}
			onintrostart={arrive}
		>
			<div class="grip" aria-hidden="true"></div>
			{#if title}<div class="sheet-title">{title}</div>{/if}
			{@render rows()}
			<button class="cancel" onclick={onclose}>Cancel</button>
		</div>
	</div>
{:else}
	<div
		{@attach portal}
		{@attach focusFirst}
		bind:this={el}
		bind:offsetWidth={w}
		bind:offsetHeight={h}
		class="menu"
		style:left="{pos.left}px"
		style:top="{pos.top}px"
		style:transform-origin={origin}
		role="menu"
		aria-label={label}
		tabindex="-1"
		in:scale|global={popIn}
		out:fade|global={{ duration: ms.out }}
		onoutrostart={leave}
		onintrostart={arrive}
	>
		{@render rows()}
	</div>
{/if}

<style>
	.menu {
		position: fixed;
		z-index: 120;
		min-width: 190px;
		max-width: min(320px, calc(100vw - 16px));
		padding: 5px;
		border-radius: 11px;
		background: var(--bg-elevated);
		box-shadow:
			0 0 0 1px var(--bg-active),
			0 12px 32px rgba(0, 0, 0, 0.18);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 7px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text);
		text-align: start;
		transition: background var(--dur-fast) ease;
	}
	.item :global(.icon) {
		color: var(--text-muted);
	}
	.item:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.item:focus-visible {
		background: var(--bg-hover);
		outline: none;
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.item:active:not(:disabled) {
		background: var(--bg-active);
	}
	.item.danger {
		color: var(--danger);
	}
	.item.danger :global(.icon) {
		color: var(--danger);
	}
	.item.danger:hover:not(:disabled) {
		background: var(--danger-soft);
	}
	.item.danger:focus-visible {
		background: var(--danger-soft);
		box-shadow: inset 0 0 0 1.5px var(--danger);
	}
	.item:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.lbl {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		font-size: 11px;
		color: var(--text-faint);
	}
	.sep {
		height: 1px;
		margin: 4px 6px;
		background: var(--bg-active);
	}

	/* --- bottom action sheet (phones) ------------------------------------- */
	.sheet-root {
		position: fixed;
		inset: 0;
		z-index: 120;
		/* Only the scrim and sheet take taps (they let go while leaving). */
		pointer-events: none;
	}
	.sheet-root > * {
		pointer-events: auto;
	}
	.scrim {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.32);
	}
	.sheet {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 80vh;
		overflow-y: auto;
		padding: 6px 10px calc(10px + env(safe-area-inset-bottom, 0px));
		border-radius: 18px 18px 0 0;
		background: var(--bg-elevated);
		box-shadow: 0 -10px 34px rgba(0, 0, 0, 0.2);
	}
	.grip {
		touch-action: none;
		width: 38px;
		height: 4px;
		margin: 4px auto 8px;
		border-radius: 2px;
		background: var(--rule);
	}
	.sheet-title {
		touch-action: none;
		padding: 2px 12px 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sheet .item {
		min-height: 52px;
		font-size: 16px;
		gap: 14px;
		padding: 0 14px;
		border-radius: 12px;
	}
	.cancel {
		width: 100%;
		min-height: 50px;
		margin-top: 6px;
		border-radius: 12px;
		background: var(--bg-hover);
		font-size: 16px;
		font-weight: 600;
		color: var(--text);
	}
	.cancel:active {
		background: var(--bg-active);
	}
</style>
