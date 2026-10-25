<script lang="ts" module>
	export interface PickItem {
		id: string;
		label: string;
		hint?: string;
	}
</script>

<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { ms, easeOut, popIn, sheetIn, sheetOut } from '../../motion';
	import { portal } from '../../portal';
	import { getAppState } from '../../stores/app.svelte';

	interface Props {
		title: string;
		placeholder: string;
		items: PickItem[];
		/** Offer the typed text itself (a tag that no note has yet). */
		free?: (text: string) => PickItem | null;
		onpick(item: PickItem): void;
		onclose(): void;
	}

	let { title, placeholder, items, free, onpick, onclose }: Props = $props();

	const app = getAppState();
	const sheet = $derived(app.layout === 'phone');
	let query = $state('');
	let active = $state(0);
	let scrimPressed = false;

	const LIMIT = 60;
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const hits = q
			? items.filter((i) => i.label.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q))
			: items;
		const extra = free?.(query.trim()) ?? null;
		const list = hits.slice(0, LIMIT);
		return extra && !list.some((i) => i.id === extra.id) ? [extra, ...list] : list;
	});

	function key(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const n = shown.length;
			if (n) active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const item = shown[Math.min(active, shown.length - 1)];
			if (item) onpick(item);
		}
	}
</script>

<div class={['root', { sheet }]} {@attach portal}>
	<button
		class="scrim"
		aria-label="Cancel"
		tabindex="-1"
		onpointerdown={() => (scrimPressed = true)}
		onclick={() => {
			if (scrimPressed) onclose();
			scrimPressed = false;
		}}
		in:fade|global={{ duration: ms.pop, easing: easeOut }}
		out:fade|global={{ duration: ms.out }}
	></button>
	<div
		class="dialog"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		in:fly|global={sheet ? sheetIn : { y: 0, duration: 0 }}
		out:fly|global={sheet ? sheetOut : { y: 0, opacity: 0, duration: ms.out }}
	>
		<div class="inner" in:scale|global={sheet ? { duration: 0 } : popIn}>
			<h2>{title}</h2>
			<input
				{@attach (el) => {
					if (!app.touch) el.focus();
				}}
				bind:value={query}
				oninput={() => (active = 0)}
				onkeydown={key}
				{placeholder}
				aria-label={placeholder}
				spellcheck="false"
				autocomplete="off"
				dir="auto"
			/>
			<ul role="listbox" aria-label={title}>
				{#each shown as item, i (item.id)}
					<li>
						<button
							role="option"
							aria-selected={i === active}
							class={['row', { active: i === active }]}
							onclick={() => onpick(item)}
						>
							<span class="label" dir="auto">{item.label}</span>
							{#if item.hint}<span class="hint" dir="auto">{item.hint}</span>{/if}
						</button>
					</li>
				{:else}
					<li class="empty">Nothing matches</li>
				{/each}
			</ul>
			<div class="actions">
				<button class="btn" onclick={onclose}>Cancel</button>
			</div>
		</div>
	</div>
</div>

<style>
	.root {
		position: fixed;
		inset: 0;
		z-index: 140;
		display: grid;
		place-items: center;
		padding: 16px;
	}
	.root.sheet {
		place-items: end stretch;
		padding: 0;
	}
	.scrim {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.34);
		cursor: default;
	}
	.dialog {
		position: relative;
		width: min(440px, 100%);
		padding: 18px 18px 14px;
		border-radius: var(--dialog-radius);
		background: var(--bg-editor);
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
	}
	.sheet .dialog {
		width: 100%;
		border-radius: var(--sheet-radius) var(--sheet-radius) 0 0;
		padding: 20px 16px calc(14px + env(safe-area-inset-bottom, 0px));
	}
	h2 {
		margin: 0 0 10px;
		font-size: 16px;
		font-weight: 700;
		color: var(--text-strong);
	}
	input {
		width: 100%;
		min-height: 36px;
		padding: 0 12px;
		border: 1px solid var(--rule);
		border-radius: 9px;
		background: var(--bg-secondary);
		color: var(--text);
		font: inherit;
		font-size: 14px;
	}
	input:focus {
		outline: 2px solid var(--focus-ring);
		outline-offset: -1px;
	}
	.sheet input {
		min-height: 50px;
		font-size: 16px;
	}
	ul {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		max-height: min(46vh, 360px);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.row {
		width: 100%;
		min-height: 40px;
		padding: 6px 10px;
		display: flex;
		align-items: baseline;
		gap: 10px;
		border-radius: 8px;
		text-align: start;
		color: var(--text);
		font-size: 14px;
	}
	.sheet .row {
		min-height: 50px;
		font-size: 16px;
	}
	.row.active,
	.row:hover {
		background: var(--bg-hover);
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		flex: none;
		max-width: 45%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-faint);
		font-size: 12px;
	}
	.empty {
		padding: 12px 10px;
		color: var(--text-muted);
		font-size: 13.5px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 12px;
	}
	.btn {
		min-height: var(--btn-h);
		padding: 0 16px;
		border-radius: var(--btn-radius);
		background: var(--bg-hover);
		color: var(--text);
		font-size: 13.5px;
		font-weight: 600;
		transition:
			background var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	.sheet .btn {
		flex: 1;
		min-height: var(--btn-h-sheet);
		font-size: 16px;
	}
	.btn:hover {
		background: var(--bg-active);
	}
	.btn:active {
		transform: scale(var(--press));
	}
</style>
