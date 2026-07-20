<script lang="ts">
	import { getAppState } from '../stores/app.svelte';

	const app = getAppState();

	let menuEl = $state<HTMLDivElement | null>(null);

	// The open menu, or null. Reading it here keeps everything below reactive.
	const menu = $derived(app.contextMenu);

	// Keep the menu inside the viewport (flip when it would overflow the edges).
	const pos = $derived.by(() => {
		if (!menu) return { left: 0, top: 0 };
		const W = 190;
		const H = 132;
		const left = Math.min(menu.x, window.innerWidth - W - 8);
		const top = Math.min(menu.y, window.innerHeight - H - 8);
		return { left: Math.max(8, left), top: Math.max(8, top) };
	});

	function close(): void {
		app.closeContextMenu();
	}

	async function pin(): Promise<void> {
		if (!menu) return;
		const id = menu.note.id;
		close();
		await app.togglePin(id);
	}

	async function lock(): Promise<void> {
		if (!menu) return;
		const id = menu.note.id;
		close();
		await app.toggleLock(id);
	}

	async function del(): Promise<void> {
		if (!menu || menu.note.locked) return;
		const id = menu.note.id;
		close();
		await app.deleteNote(id);
	}

	// Dismiss on outside pointer, scroll, resize or Escape while open.
	$effect(() => {
		if (!menu) return;
		const onPointer = (e: PointerEvent) => {
			if (menuEl && !menuEl.contains(e.target as Node)) close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close();
		};
		// `capture` so we beat other handlers; a microtask delay avoids catching the
		// same contextmenu event that opened us.
		window.addEventListener('pointerdown', onPointer, true);
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('resize', close);
		window.addEventListener('wheel', close, true);
		return () => {
			window.removeEventListener('pointerdown', onPointer, true);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('resize', close);
			window.removeEventListener('wheel', close, true);
		};
	});
</script>

{#if menu}
	<div
		bind:this={menuEl}
		class="menu"
		style="left:{pos.left}px; top:{pos.top}px"
		role="menu"
		tabindex="-1"
	>
		<button class="item" role="menuitem" onclick={pin}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
				<path
					d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z M12 15v5"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<span>{menu.note.pinned ? 'Unpin' : 'Pin'}</span>
		</button>

		<button class="item" role="menuitem" onclick={lock}>
			{#if menu.note.locked}
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
					<rect
						x="5"
						y="11"
						width="14"
						height="9"
						rx="2"
						stroke="currentColor"
						stroke-width="1.7"
					/>
					<path
						d="M8 11V8a4 4 0 0 1 7-2.6"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linecap="round"
					/>
				</svg>
				<span>Unlock</span>
			{:else}
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
					<rect
						x="5"
						y="11"
						width="14"
						height="9"
						rx="2"
						stroke="currentColor"
						stroke-width="1.7"
					/>
					<path
						d="M8 11V8a4 4 0 0 1 8 0v3"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linecap="round"
					/>
				</svg>
				<span>Lock</span>
			{/if}
		</button>

		<div class="sep"></div>

		<button
			class="item danger"
			role="menuitem"
			disabled={menu.note.locked}
			title={menu.note.locked ? 'Unlock the note first' : 'Delete note'}
			onclick={del}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
				<path
					d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<span>Delete</span>
		</button>
	</div>
{/if}

<style>
	.menu {
		position: fixed;
		z-index: 100;
		min-width: 176px;
		padding: 5px;
		border-radius: 10px;
		background: var(--bg-editor);
		border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
		box-shadow: var(--shadow-pane, 0 12px 32px rgba(0, 0, 0, 0.18));
	}
	.item {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		height: 32px;
		padding: 0 10px;
		border-radius: 7px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text);
		text-align: left;
		transition: background 100ms ease;
	}
	.item svg {
		flex: 0 0 auto;
		color: var(--text-muted);
	}
	.item:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.item.danger:hover:not(:disabled) {
		background: color-mix(in srgb, #e5484d 14%, transparent);
		color: #e5484d;
	}
	.item.danger:hover:not(:disabled) svg {
		color: #e5484d;
	}
	.item:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.sep {
		height: 1px;
		margin: 4px 6px;
		background: var(--border, rgba(0, 0, 0, 0.08));
	}
</style>
