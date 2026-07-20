<script lang="ts">
	import { Spring } from 'svelte/motion';
	import { getAppState } from '../stores/app.svelte';
	import type { NoteMeta } from '../../../../shared/types';

	let { note, trash = false }: { note: NoteMeta; trash?: boolean } = $props();

	const app = getAppState();

	// --- Swipe "physics" ---------------------------------------------------
	// A horizontal trackpad gesture (deltaX) accumulates into `raw`. `raw` is fed
	// through a rubber-band curve so the card resists further the harder you pull,
	// and a Spring smooths the visual position so it never feels twitchy. The
	// Pin/Delete action only fires past 35% of the card width; anything short
	// springs back to rest.
	const THRESHOLD_FRAC = 0.35; // fraction of card width that arms an action
	const MAX_FRAC = 0.6; // rubber-band asymptote
	const SENSITIVITY = 0.65; // gesture → travel, before resistance

	let cardWidth = $state(280);
	let raw = 0; // accumulated gesture, pre-resistance
	let settleTimer: ReturnType<typeof setTimeout> | null = null;
	const offset = new Spring(0, { stiffness: 0.16, damping: 0.74 });

	const threshold = $derived(cardWidth * THRESHOLD_FRAC);
	const active = $derived(note.id === app.activeId);

	// How far each side is pulled, 0→1 as it approaches the trigger threshold.
	const rightProgress = $derived(Math.min(1, Math.max(0, offset.current / threshold)));
	const leftProgress = $derived(Math.min(1, Math.max(0, -offset.current / threshold)));

	// Rubber band: near 0 the slope is ~SENSITIVITY; it then bends and saturates
	// toward `max`, so the further you go the harder each pixel of pull becomes.
	function resist(x: number, max: number): number {
		const s = Math.sign(x);
		const a = Math.abs(x) * SENSITIVITY;
		return (s * (max * a)) / (a + max);
	}

	function relTime(ms: number): string {
		const diff = Date.now() - ms;
		const m = Math.floor(diff / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h`;
		const d = Math.floor(h / 24);
		if (d < 7) return `${d}d`;
		return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function onWheel(e: WheelEvent): void {
		// Only hijack clearly-horizontal gestures; leave vertical scroll alone.
		if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
		e.preventDefault();
		raw -= e.deltaX;
		offset.target = resist(raw, cardWidth * MAX_FRAC);
		if (settleTimer) clearTimeout(settleTimer);
		settleTimer = setTimeout(settle, 150);
	}

	function fireRight(): void {
		const id = note.id;
		if (trash) {
			offset.target = cardWidth; // slide out, then restore
			app.restoreNote(id);
		} else {
			springBack(); // pin snaps back into place
			app.togglePin(id);
		}
	}

	function fireLeft(): void {
		const id = note.id;
		// A locked note can't be swipe-deleted — bounce back instead.
		if (!trash && note.locked) {
			springBack();
			return;
		}
		offset.target = -cardWidth; // slide out either way
		if (trash) app.permanentDelete(id);
		else app.deleteNote(id);
	}

	function onContextMenu(e: MouseEvent): void {
		if (trash) return; // trash cards have their own swipe actions only
		e.preventDefault();
		app.openContextMenu(e.clientX, e.clientY, note);
	}

	function springBack(): void {
		raw = 0;
		offset.target = 0;
	}

	function settle(): void {
		const val = offset.current;
		if (val >= threshold) fireRight();
		else if (val <= -threshold) fireLeft();
		else springBack();
	}

	function reset(): void {
		if (settleTimer) clearTimeout(settleTimer);
		springBack();
	}
</script>

<div
	class="swipe"
	role="listitem"
	bind:clientWidth={cardWidth}
	onwheelcapture={onWheel}
	onmouseleave={reset}
	class:revealing={Math.abs(offset.current) > 0.5}
>
	<!-- Right-swipe action revealed beneath the card. -->
	<div class="action right" class:armed={rightProgress >= 1} style="opacity:{rightProgress}">
		<span class="ico" style="transform:scale({0.55 + rightProgress * 0.6})">
			{#if trash}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
					<path
						d="M4 12a8 8 0 1 1 2.3 5.6M4 12V7m0 5h5"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			{:else}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
					<path
						d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z M12 15v5"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			{/if}
		</span>
		<span class="lbl">{trash ? 'Restore' : note.pinned ? 'Unpin' : 'Pin'}</span>
	</div>

	<!-- Left-swipe action revealed beneath the card. -->
	<div
		class="action left"
		class:danger={trash}
		class:armed={leftProgress >= 1}
		style="opacity:{leftProgress}"
	>
		<span class="lbl">{trash ? 'Delete forever' : note.locked ? 'Locked' : 'Delete'}</span>
		<span class="ico" style="transform:scale({0.55 + leftProgress * 0.6})">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
				<path
					d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</span>
	</div>

	<button
		class="card"
		class:active
		class:readonly={trash}
		style="transform:translateX({offset.current}px)"
		onclick={() => !trash && Math.abs(offset.current) < 1 && app.openNote(note.id)}
		oncontextmenu={onContextMenu}
	>
		<div class="row">
			<span class="title">
				{#if note.pinned && !trash}<span class="pindot" title="Pinned">📌</span>{/if}
				{#if note.locked && !trash}<span class="pindot" title="Locked">🔒</span>{/if}
				{note.title}
			</span>
			<span class="time">{relTime(note.mtime)}</span>
		</div>
		<div class="snippet">{note.snippet || 'No additional text'}</div>
		{#if note.tags.length}
			<div class="tags">
				{#each note.tags.slice(0, 4) as t (t)}
					<span class="chip">#{t}</span>
				{/each}
			</div>
		{/if}
	</button>
</div>

<style>
	.swipe {
		position: relative;
		border-radius: 9px;
		overflow: hidden;
		margin-bottom: 2px;
	}
	.action {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 18px;
		font-size: 12px;
		font-weight: 600;
		color: #fff;
	}
	.action.right {
		justify-content: flex-start;
		background: #f5bd4f;
	}
	.action.left {
		justify-content: flex-end;
		background: var(--accent);
	}
	/* Permanent-delete gets a hard red to signal it's irreversible. */
	.action.left.danger {
		background: #e5484d;
	}
	/* Past the trigger threshold the panel brightens — a clear "release now" cue. */
	.action.armed {
		filter: brightness(1.12) saturate(1.1);
	}
	.ico {
		display: inline-grid;
		place-items: center;
		transition: transform 60ms linear;
	}
	.card {
		position: relative;
		display: block;
		width: 100%;
		text-align: left;
		padding: 10px 12px;
		border-radius: 9px;
		background: var(--bg-list);
	}
	.card:hover {
		background: var(--bg-hover);
	}
	.card.active {
		background: var(--bg-active);
	}
	/* Trashed notes are swipe-only (restore / delete) — not editable. */
	.card.readonly {
		cursor: default;
	}
	.card.readonly:hover {
		background: var(--bg-list);
	}
	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}
	.title {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-strong);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pindot {
		font-size: 11px;
		margin-right: 2px;
	}
	.time {
		flex: 0 0 auto;
		font-size: 11px;
		color: var(--text-faint);
	}
	.snippet {
		font-size: 12.5px;
		color: var(--text-muted);
		margin-top: 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 6px;
	}
	.chip {
		font-size: 10.5px;
		color: var(--accent);
		background: var(--accent-soft);
		padding: 1px 6px;
		border-radius: 5px;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
