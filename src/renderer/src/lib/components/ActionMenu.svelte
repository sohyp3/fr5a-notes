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
	import { fade, fly } from 'svelte/transition';
	import { tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import Icon from './Icon.svelte';
	import { portal, reducedMotion } from '../portal';
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
	const dur = reducedMotion() ? 0 : 1;

	// Keep the popover inside the viewport (flip up / left when it would overflow).
	const pos = $derived({
		left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)),
		top: Math.max(8, at.y + h + 8 > window.innerHeight ? at.y - h : at.y)
	});

	function run(item: MenuItem): void {
		if (item.disabled) return;
		onclose();
		item.action();
	}

	function onKey(e: KeyboardEvent): void {
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
		if (el && !el.contains(t) && !trigger?.contains(t)) onclose();
	}

	function wheel(): void {
		if (!sheet) onclose();
	}

	/** Focus the first item once the menu is on screen (after the portal moved it). */
	const focusFirst: Attachment<HTMLElement> = (node) => {
		void tick().then(() =>
			node
				.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')
				?.focus({ preventScroll: true })
		);
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
		<div class="scrim" transition:fade={{ duration: 180 * dur }}></div>
		<div
			bind:this={el}
			{@attach focusFirst}
			class="sheet"
			role="menu"
			aria-label={label}
			tabindex="-1"
			transition:fly={{ y: 60, duration: 240 * dur, opacity: 0 }}
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
		role="menu"
		aria-label={label}
		tabindex="-1"
		transition:fly={{ y: -4, duration: 120 * dur }}
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
		background: var(--bg-editor);
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
	.item:hover:not(:disabled),
	.item:focus-visible {
		background: var(--bg-hover);
		outline: none;
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
		background: var(--bg-editor);
		box-shadow: 0 -10px 34px rgba(0, 0, 0, 0.2);
	}
	.grip {
		width: 38px;
		height: 4px;
		margin: 4px auto 8px;
		border-radius: 2px;
		background: var(--bg-active);
	}
	.sheet-title {
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
