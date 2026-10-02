<script lang="ts">
	import { Spring } from 'svelte/motion';
	import { getAppState } from '../stores/app.svelte';
	import { haptic, reducedMotion } from '../portal';
	import Icon from './Icon.svelte';
	import type { NoteMeta } from '../../../../shared/types';

	let { note, trash = false }: { note: NoteMeta; trash?: boolean } = $props();

	const app = getAppState();

	// --- Swipe ------------------------------------------------------------------
	// A horizontal drag (touch / pen) or trackpad swipe slides the card and
	// reveals one action underneath. Releasing past half the action's width
	// snaps it open; the action only runs when that revealed button is tapped.
	// Tapping elsewhere, scrolling or swiping back closes it.
	const ACTION_W = 96; // revealed width (the button is ≥ 44px tall)
	const LOCK_PX = 8; // movement before deciding horizontal vs vertical
	const OVERSHOOT = 56; // rubber-band room past the open position

	let el = $state<HTMLDivElement | null>(null);
	let cardWidth = $state(280);
	const offset = new Spring(0, { stiffness: 0.2, damping: 0.8 });
	const active = $derived(note.id === app.activeId);
	const open = $derived(app.swipeOpen === note.id);
	const side = $derived(offset.current > 0.5 ? 'right' : offset.current < -0.5 ? 'left' : null);
	// The left action can't trash a locked note: it only says so.
	const leftLocked = $derived(!trash && note.locked);

	/** Past the open position the card resists, asymptotically. */
	function band(x: number): number {
		const s = Math.sign(x);
		const a = Math.abs(x);
		if (a <= ACTION_W) return x;
		const over = a - ACTION_W;
		return s * (ACTION_W + (OVERSHOOT * over) / (over + OVERSHOOT));
	}

	function setNow(x: number): void {
		void offset.set(x, { instant: true });
	}

	function snap(to: number): void {
		if (reducedMotion()) setNow(to);
		else offset.target = to;
	}

	function close(): void {
		snap(0);
		if (app.swipeOpen === note.id) app.swipeOpen = null;
	}

	function openSide(dir: 1 | -1): void {
		snap(dir * ACTION_W);
		app.swipeOpen = note.id;
		haptic(8);
	}

	/** Settle after a drag: open past half the action, else back to rest. */
	function settle(x: number): void {
		if (x > ACTION_W / 2) openSide(1);
		else if (x < -ACTION_W / 2) openSide(-1);
		else close();
	}

	// Another card opened (or navigation cleared it): this one closes — unless
	// it is sliding out after its action ran.
	let wasOpen = false;
	let leaving = false;
	$effect(() => {
		const o = open;
		if (wasOpen && !o && !leaving) snap(0);
		wasOpen = o;
	});

	// While open: tapping outside or scrolling the list closes it.
	$effect(() => {
		if (!open) return;
		const outside = (e: PointerEvent) => {
			if (el && !el.contains(e.target as Node)) close();
		};
		const scroll = (e: Event) => {
			if (e.target instanceof Node && e.target.contains(el)) close();
		};
		window.addEventListener('pointerdown', outside, true);
		window.addEventListener('scroll', scroll, true);
		return () => {
			window.removeEventListener('pointerdown', outside, true);
			window.removeEventListener('scroll', scroll, true);
		};
	});

	// --- pointer drag (touch / pen) --------------------------------------------
	let drag: {
		id: number;
		x: number;
		y: number;
		from: number;
		axis: 'x' | 'y' | null;
	} | null = null;
	/** The release that ended a swipe must not also open the note. */
	let swallowClick = false;

	function onPointerDown(e: PointerEvent): void {
		// A new touch: whatever the last swipe left behind no longer applies.
		swallowClick = false;
		if (e.pointerType === 'mouse') return;
		drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: offset.current, axis: null };
		startPress(e);
	}

	function onPointerMove(e: PointerEvent): void {
		if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE)
			cancelPress();
		if (!drag || e.pointerId !== drag.id) return;
		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		if (!drag.axis) {
			if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
			drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
			if (drag.axis === 'y') {
				// A vertical scroll: let the list have it.
				if (open) close();
				drag = null;
				return;
			}
			cancelPress();
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		}
		setNow(band(drag.from + dx));
	}

	function onPointerUp(e: PointerEvent): void {
		cancelPress();
		if (!drag || e.pointerId !== drag.id) return;
		const swiped = drag.axis === 'x';
		drag = null;
		if (swiped) {
			swallowClick = true;
			settle(offset.current);
		}
	}

	// --- trackpad (horizontal wheel) -------------------------------------------
	let wheelRaw = 0;
	let wheelTimer: ReturnType<typeof setTimeout> | null = null;

	function onWheel(e: WheelEvent): void {
		// Only hijack clearly-horizontal gestures; leave vertical scroll alone.
		if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
		e.preventDefault();
		if (!wheelTimer) wheelRaw = offset.current;
		wheelRaw -= e.deltaX;
		setNow(band(wheelRaw));
		if (wheelTimer) clearTimeout(wheelTimer);
		wheelTimer = setTimeout(() => {
			wheelTimer = null;
			settle(offset.current);
		}, 140);
	}

	// --- actions (run only from the revealed button) ---------------------------
	// Committed on a clean pointer release, not `click`: right after a swipe,
	// Chrome may treat the next tap as stopping a fling and drop its click.
	let actPress: { id: number; x: number; y: number } | null = null;
	let actDone = false;

	function actDown(e: PointerEvent): void {
		actDone = false;
		actPress = { id: e.pointerId, x: e.clientX, y: e.clientY };
	}

	function actUp(e: PointerEvent, run: () => void): void {
		const p = actPress;
		actPress = null;
		if (!p || p.id !== e.pointerId || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
		actDone = true;
		run();
	}

	/** Keyboard (Enter / Space) still arrives as a click. */
	function actClick(run: () => void): void {
		if (actDone) {
			actDone = false;
			return;
		}
		run();
	}

	function slideOut(dir: 1 | -1): void {
		leaving = true;
		snap(dir * cardWidth);
		app.swipeOpen = null;
	}

	function rightAction(): void {
		haptic(14);
		if (trash) {
			slideOut(1);
			void app.restoreNote(note.id);
		} else {
			close();
			void app.togglePin(note.id);
		}
	}

	async function leftAction(): Promise<void> {
		if (leftLocked) {
			close();
			return;
		}
		haptic(14);
		if (!trash) {
			slideOut(-1);
			void app.deleteNote(note.id);
			return;
		}
		const ok = await app.confirm({
			title: 'Delete forever?',
			body: `“${note.title}” will be erased from disk. This can't be undone.`,
			confirm: 'Delete forever',
			danger: true
		});
		if (!ok) {
			close();
			return;
		}
		slideOut(-1);
		void app.permanentDelete(note.id);
	}

	// --- long-press (touch) / right-click → note menu ---------------------------
	const LONG_PRESS_MS = 500;
	const MOVE_TOLERANCE = 10;
	let press: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
	let longPressed = false;

	function startPress(e: PointerEvent): void {
		longPressed = false;
		const x = e.clientX;
		const y = e.clientY;
		press = {
			x,
			y,
			timer: setTimeout(() => {
				press = null;
				longPressed = true;
				haptic(8);
				app.openContextMenu(x, y, note);
			}, LONG_PRESS_MS)
		};
	}

	function cancelPress(): void {
		if (press) clearTimeout(press.timer);
		press = null;
	}

	function onContextMenu(e: MouseEvent): void {
		e.preventDefault();
		// A touch press in progress: the browser's own long-press got there
		// first — open once, at the finger, and swallow the release click.
		if (press) {
			const { x, y } = press;
			cancelPress();
			longPressed = true;
			app.openContextMenu(x, y, note);
			return;
		}
		if (longPressed) return;
		app.openContextMenu(e.clientX, e.clientY, note);
	}

	function onClick(): void {
		// The release after a long-press or a swipe must not also open the note.
		if (longPressed || swallowClick) {
			longPressed = false;
			swallowClick = false;
			return;
		}
		if (open || Math.abs(offset.current) > 1) {
			close();
			return;
		}
		if (!trash) app.openNote(note.id);
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

	const progress = $derived(Math.min(1, Math.abs(offset.current) / ACTION_W));
</script>

<div
	class="swipe"
	class:open
	role="listitem"
	bind:this={el}
	bind:clientWidth={cardWidth}
	onwheelcapture={onWheel}
>
	{#if side === 'right'}
		<!-- Revealed by swiping right: pin / unpin, or restore from trash. -->
		<button
			class="action right"
			class:restore={trash}
			style:width="{Math.max(ACTION_W, offset.current)}px"
			tabindex={open ? 0 : -1}
			aria-hidden={!open}
			onpointerdown={actDown}
			onpointerup={(e) => actUp(e, rightAction)}
			onclick={() => actClick(rightAction)}
		>
			<span class="ico" style:transform="scale({0.7 + progress * 0.3})">
				<Icon name={trash ? 'restore' : 'pin'} size={19} />
			</span>
			<span class="lbl">{trash ? 'Restore' : note.pinned ? 'Unpin' : 'Pin'}</span>
		</button>
	{:else if side === 'left'}
		<!-- Revealed by swiping left: trash, delete forever, or "locked". -->
		<button
			class="action left"
			class:danger={trash}
			class:locked={leftLocked}
			style:width="{Math.max(ACTION_W, -offset.current)}px"
			tabindex={open ? 0 : -1}
			aria-hidden={!open}
			onpointerdown={actDown}
			onpointerup={(e) => actUp(e, () => void leftAction())}
			onclick={() => actClick(() => void leftAction())}
		>
			<span class="ico" style:transform="scale({0.7 + progress * 0.3})">
				<Icon name={leftLocked ? 'lock' : 'trash'} size={19} />
			</span>
			<span class="lbl">{trash ? 'Delete forever' : leftLocked ? 'Locked' : 'Trash'}</span>
		</button>
	{/if}

	<button
		class="card"
		class:active
		class:readonly={trash}
		style:transform="translateX({offset.current}px)"
		onclick={onClick}
		oncontextmenu={onContextMenu}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
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
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		min-height: 44px;
		font-size: 11.5px;
		font-weight: 600;
		color: #fff;
		touch-action: manipulation;
	}
	.action:active {
		filter: brightness(0.92);
	}
	.action.right {
		left: 0;
		background: #e0a520;
	}
	.action.right.restore {
		background: var(--ok);
	}
	.action.left {
		right: 0;
		background: var(--accent);
	}
	/* Permanent delete gets a hard red: it's irreversible. */
	.action.left.danger {
		background: var(--danger);
	}
	.action.left.locked {
		background: var(--text-muted);
	}
	.ico {
		display: grid;
		place-items: center;
	}
	.card {
		position: relative;
		display: block;
		width: 100%;
		text-align: left;
		padding: 10px 12px;
		border-radius: 9px;
		background: var(--bg-list);
		/* Vertical scrolling stays native; horizontal moves come to us. */
		touch-action: pan-y;
		transition: background var(--dur-fast) ease;
	}
	.card:hover {
		background: var(--bg-hover);
	}
	.swipe.open .card {
		box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12);
	}
	.card.active {
		background: var(--bg-active);
	}
	.card.readonly {
		cursor: default;
	}
	.card.readonly:hover {
		background: var(--bg-list);
	}
	:global(html[data-touch]) .card:active:not(.readonly) {
		background: var(--bg-hover);
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
