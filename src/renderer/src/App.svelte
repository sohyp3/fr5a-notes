<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { untrack } from 'svelte';
	import { Spring } from 'svelte/motion';
	import { MediaQuery } from 'svelte/reactivity';
	import { innerWidth } from 'svelte/reactivity/window';
	import { getAppState, PANE_WIDTHS, type Pane, type PaneName } from './lib/stores/app.svelte';
	import TitleBar from './lib/components/TitleBar.svelte';
	import Sidebar from './lib/components/Sidebar.svelte';
	import NoteList from './lib/components/NoteList.svelte';
	import Editor from './lib/components/Editor.svelte';
	import Settings from './lib/components/Settings.svelte';
	import Changes from './lib/components/Changes.svelte';
	import CheatSheet from './lib/components/CheatSheet.svelte';
	import NoteContextMenu from './lib/components/NoteContextMenu.svelte';
	import ConfirmDialog from './lib/components/ConfirmDialog.svelte';
	import FolderContextMenu from './lib/components/FolderContextMenu.svelte';
	import PromptDialog from './lib/components/PromptDialog.svelte';
	import MoveDialog from './lib/components/MoveDialog.svelte';
	import Notice from './lib/components/Notice.svelte';
	import ConflictWindow from './lib/components/ConflictWindow.svelte';
	import Resizer from './lib/components/Resizer.svelte';
	import { isMobile } from './lib/platform';
	import { layoutFor } from './lib/layout';
	import { easeDrawer, easeOut, motionK, ms, scrimIn, scrimOut } from './lib/motion';
	import {
		EDGE_BACK_PX,
		LOCK_PX,
		Tracker,
		afterTransition,
		liveTranslate,
		project,
		releaseMs,
		rubberband
	} from './lib/gesture';

	const app = getAppState();
	/** Narrowest the editor may get while panes are dragged wider. */
	const EDITOR_MIN = 320;

	// The harness pane's code is loaded on first open, then stays mounted.
	const harnessModule = $derived(
		app.harnessLoaded && app.settings.ai
			? import('./lib/components/harness/HarnessPane.svelte')
			: null
	);
	// Mind maps are a true optional chunk: disabled means no import, no graph
	// state, no note-body reads, and no graph-specific event handlers.
	const graphModule = $derived(
		app.settings.linkedNotes && app.view === 'graph'
			? import('./lib/components/MindMaps.svelte')
			: null
	);

	// Spring-driven widths so toggling/Zen feels physical, not linear (critically
	// damped: no overshoot on a layout edge). Settles within half a pixel: a
	// tail of sub-pixel steps would re-lay out the editor for nothing.
	const PANE_SPRING = { stiffness: 0.16, damping: 0.74, precision: 0.5 };
	const sidebarWidth = new Spring(app.widths.sidebar, PANE_SPRING);
	const listWidth = new Spring(app.widths.list, PANE_SPRING);
	const harnessWidth = new Spring(0, PANE_SPRING);

	const desktop = $derived(app.layout === 'desktop');
	const tablet = $derived(app.layout === 'tablet');
	const phone = $derived(app.layout === 'phone');
	const graphWideTouch = $derived(app.view === 'graph' && app.touch && desktop);

	// In Zen mode the sidebar and note list animate away, centring the editor.
	const showSidebar = $derived(app.sidebarOpen && !app.zen && !graphWideTouch);
	const showList = $derived(app.listOpen && !app.zen);

	// Layout follows width + input type: touch devices (phones/tablets, coarse
	// pointer) get phone / tablet layouts; mouse windows stay desktop at any width.
	const coarse = new MediaQuery('pointer: coarse');
	const touch = $derived(isMobile || coarse.current);
	const winW = $derived(innerWidth.current ?? window.innerWidth);
	$effect(() => app.setLayout(layoutFor(winW, touch), touch));

	/**
	 * Desktop widths actually used. On a narrow window (a landscape tablet, a
	 * half-screen laptop window, the AI pane open) the editor keeps EDITOR_MIN:
	 * the sidebar steps aside first, then the AI pane narrows toward its
	 * minimum, then the list steps aside. Nothing is persisted — a wider window
	 * brings them back.
	 */
	const fit = $derived.by(() => {
		let side = showSidebar ? app.widths.sidebar : 0;
		let list = showList ? app.widths.list : 0;
		let ai = app.harnessOpen ? app.widths.harness : 0;
		if (!desktop) return { side, list, ai: app.widths.harness };
		const room = winW - EDITOR_MIN - 40;
		if (!app.harnessOpen && side + list > room) {
			// Narrow window: the sidebar, then the list, give up width down to their
			// minimums before anything steps aside.
			let over = side + list - room;
			const cut = (w: number, min: number): number => {
				const c = w ? Math.min(over, Math.max(0, w - min)) : 0;
				over -= c;
				return w - c;
			};
			side = cut(side, PANE_WIDTHS.sidebar.min);
			list = cut(list, PANE_WIDTHS.list.min);
		}
		if (side + list + ai > room) side = 0;
		if (app.harnessOpen && list + ai > room) ai = Math.max(PANE_WIDTHS.harness.min, room - list);
		if (list + ai > room) list = 0;
		return { side, list, ai: app.harnessOpen ? ai : app.widths.harness };
	});
	const overlay = $derived(app.view !== 'editor');

	// Which panes are on screen for the current layout. Every pane stays mounted
	// across layouts (only CSS changes), so rotating keeps the editor + caret.
	const sidebarShown = $derived(
		desktop ? fit.side > 0 : tablet ? app.drawerOpen : app.pane === 'nav'
	);
	const listShown = $derived(phone ? app.pane === 'list' : fit.list > 0);
	const editorShown = $derived(phone ? app.pane === 'editor' : true);
	const harnessShown = $derived(phone ? app.pane === 'harness' : app.harnessOpen);

	// Phones: panes sit side by side in this order and slide; the one on
	// screen is "current", earlier ones wait to the left, later to the right.
	const ORDER: Record<Pane, number> = { nav: 0, list: 1, editor: 2, harness: 3 };
	function pos(p: Pane): 'before' | 'current' | 'after' | undefined {
		if (!phone) return undefined;
		const d = ORDER[p] - ORDER[app.pane];
		return d < 0 ? 'before' : d > 0 ? 'after' : 'current';
	}

	function follow(spring: Spring<number>, w: number): void {
		// While an edge is dragged the pane tracks the pointer exactly.
		if (app.resizing || motionK() === 0) void spring.set(w, { instant: true });
		else spring.target = w;
	}

	/**
	 * While the panes slide, the note's scroll area keeps one width (the
	 * narrower of before and after) and moves as one block on its own layer:
	 * the note is wrapped once, and nothing inside it is laid out or painted
	 * again per frame (a landscape tablet can't afford either).
	 */
	let frozen = $state.raw<{ el: HTMLElement; w: number } | null>(null);
	let lastWinW = 0;
	function freezeEditor(side: number, list: number, ai: number): void {
		// A window resize moves the editor too: no estimate, it just wraps.
		const resized = winW !== lastWinW;
		frozen = null;
		if (!desktop || resized || app.resizing || motionK() === 0) return;
		const el = paneEl.editor?.querySelector<HTMLElement>('.editor-pane .scroll');
		if (!el) return;
		const grow =
			sidebarWidth.current - side + (listWidth.current - list) + (harnessWidth.current - ai);
		const now = el.offsetWidth;
		if (Math.abs(grow) >= 1) frozen = { el, w: Math.min(now, now + grow) };
	}
	$effect(() => {
		const side = fit.side;
		const list = fit.list;
		const ai = app.harnessOpen ? fit.ai : 0;
		untrack(() => {
			freezeEditor(side, list, ai);
			follow(sidebarWidth, side);
			follow(listWidth, list);
			follow(harnessWidth, ai);
		});
	});
	// After the effect above, so a resize that changes `fit` is still seen as one.
	$effect(() => {
		lastWinW = winW;
	});
	const sliding = $derived(
		[sidebarWidth, listWidth, harnessWidth].some((sp) => sp.current !== sp.target)
	);
	// Inline on the element: a class or an inherited CSS variable higher up
	// would restyle the whole note at the start and end of every slide.
	$effect(() => {
		const f = sliding ? frozen : null;
		if (!f) return;
		const { el, w } = f;
		Object.assign(el.style, {
			width: `${w}px`,
			right: 'auto',
			left: '50%',
			marginLeft: `${-w / 2}px`,
			willChange: 'transform'
		});
		return () => {
			for (const p of ['width', 'right', 'left', 'margin-left', 'will-change'])
				el.style.removeProperty(p);
		};
	});

	/** Resize one pane, keeping at least EDITOR_MIN for the editor. */
	function resize(pane: PaneName, px: number): void {
		const others =
			(pane !== 'sidebar' && showSidebar ? app.widths.sidebar : 0) +
			(pane !== 'list' && showList ? app.widths.list : 0) +
			(pane !== 'harness' && app.harnessOpen && desktop ? app.widths.harness : 0);
		const room = window.innerWidth - others - EDITOR_MIN - 40;
		app.setWidth(pane, Math.min(px, Math.max(PANE_WIDTHS[pane].min, room)));
	}

	// --- tablet AI sheet: drag the handle between closed, half and full --------
	// While it moves the sheet is laid out at full height once and only
	// translated (no per-frame layout of the transcript); its class height
	// comes back when it lands. The release velocity picks the snap point.
	let sheetEl = $state<HTMLDivElement | null>(null);
	let sheetScrim = $state<HTMLButtonElement | null>(null);
	let sheet: {
		id: number;
		y0: number;
		t0: number;
		base: number;
		full: number;
		half: number;
		on: boolean;
		v: Tracker;
	} | null = null;
	let sheetSettle: (() => void) | null = null;

	function sheetGeo(): { full: number; half: number } {
		const h = sheetEl?.parentElement?.clientHeight ?? window.innerHeight;
		return { full: h - 12, half: Math.round(h * 0.58) };
	}
	/** Full height, shifted down by `base`: one layout, nothing visibly moves. */
	function holdFull(base: number): void {
		if (!sheetEl) return;
		sheetEl.style.transition = 'none';
		sheetEl.style.height = `${sheetGeo().full}px`;
		sheetEl.style.transform = `translateY(${base}px)`;
	}
	function sheetTo(to: number, v: number): void {
		const el = sheetEl;
		if (!el) return;
		const from = liveTranslate(el).y;
		const dur = releaseMs(to - from, v, 160, 320);
		void el.offsetHeight; // commit the start before transitioning
		el.style.transition = `transform ${dur}ms var(--ease-drawer)`;
		el.style.transform = `translateY(${to}px)`;
		if (sheetScrim) sheetScrim.style.transition = `opacity ${dur}ms var(--ease-out)`;
		sheetSettle = afterTransition(el, dur, () => {
			el.style.transition = 'none';
			el.style.removeProperty('height');
			el.style.removeProperty('transform');
			void el.offsetHeight;
			el.style.removeProperty('transition');
			sheetScrim?.style.removeProperty('opacity');
			sheetScrim?.style.removeProperty('transition');
			sheetSettle = null;
		});
	}
	function sheetDown(e: PointerEvent): void {
		if (!sheetEl) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const { full, half } = sheetGeo();
		// Grabbed mid-flight: carry on from where it is.
		const mid = sheetSettle !== null;
		sheetSettle?.();
		sheetSettle = null;
		const base = mid ? liveTranslate(sheetEl).y : app.sheetExpanded ? 0 : full - half;
		if (mid) holdFull(base);
		sheet = {
			id: e.pointerId,
			y0: e.clientY,
			t0: base,
			base,
			full,
			half,
			on: mid,
			v: new Tracker()
		};
		sheet.v.add(e.clientY, e.timeStamp);
	}
	function sheetMove(e: PointerEvent): void {
		const s = sheet;
		if (!s || e.pointerId !== s.id || !sheetEl) return;
		s.v.add(e.clientY, e.timeStamp);
		const dy = e.clientY - s.y0;
		if (!s.on) {
			if (Math.abs(dy) < 6) return;
			s.on = true;
			holdFull(s.base);
		}
		let ty = s.base + dy;
		if (ty < 0) ty = -rubberband(-ty, s.full); // above full: resists
		sheetEl.style.transform = `translateY(${ty}px)`;
		// The scrim dims only between half and closed.
		const below = ty - (s.full - s.half);
		if (sheetScrim) {
			sheetScrim.style.transition = 'none';
			sheetScrim.style.opacity = String(Math.min(1, Math.max(0, 1 - below / s.half)));
		}
	}
	function sheetUp(e: PointerEvent): void {
		const s = sheet;
		if (!s || e.pointerId !== s.id || !sheetEl) return;
		sheet = null;
		if (!s.on) {
			toggleSheet();
			return;
		}
		const ty = liveTranslate(sheetEl).y;
		const v = e.type === 'pointercancel' ? 0 : s.v.velocity(e.timeStamp);
		const p = ty + project(v);
		const snaps = [0, s.full - s.half, s.full + 24];
		const to = snaps.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a));
		// State now; the inline transform rules until it lands.
		if (to === snaps[2]) app.closeHarness();
		else app.sheetExpanded = to === 0;
		sheetTo(to, v);
	}
	/** Tap / keyboard on the handle: half ⇄ full, by transform too. */
	function toggleSheet(): void {
		if (!sheetEl) return;
		sheetSettle?.();
		sheetSettle = null;
		const { full, half } = sheetGeo();
		const expand = !app.sheetExpanded;
		holdFull(expand ? full - half : 0);
		app.sheetExpanded = expand;
		sheetTo(expand ? 0 : full - half, 0);
	}

	// --- phone: swipe from the left edge to go Back ---------------------------
	// The current pane follows the finger 1:1 over the previous one (the same
	// -28% parallax as the CSS push); the release velocity decides, and a commit
	// goes through app.back() exactly like the Back button (no remount, the
	// caret survives). Android gesture navigation owns the edge itself.
	const PREV: Partial<Record<Pane, Pane>> = { list: 'nav', editor: 'list', harness: 'editor' };
	const paneEl: Partial<Record<Pane, HTMLElement>> = {};
	let dimEl = $state<HTMLDivElement | null>(null);
	let edge: {
		id: number;
		x0: number;
		y0: number;
		at: number;
		t0: number;
		w: number;
		on: boolean;
		cur: HTMLElement;
		prev: HTMLElement;
		v: Tracker;
	} | null = null;
	let edgeSettle: { cur: HTMLElement; cancel: () => void } | null = null;
	/** Records a pane wrapper for the edge swipe. */
	const pane =
		(p: Pane) =>
		(node: HTMLElement): (() => void) => {
			paneEl[p] = node;
			return () => delete paneEl[p];
		};

	function edgeListen(on: boolean): void {
		const f = on ? window.addEventListener : window.removeEventListener;
		f('pointermove', edgeMove, true);
		f('pointerup', edgeUp, true);
		f('pointercancel', edgeUp, true);
	}
	function edgeDown(e: PointerEvent): void {
		if (!phone || overlay || edge || e.pointerType === 'mouse' || !e.isPrimary) return;
		if (e.clientX > EDGE_BACK_PX || app.swipeOpen) return;
		const p = PREV[app.pane];
		const cur = paneEl[app.pane];
		const prev = p && paneEl[p];
		if (!cur || !prev || !dimEl) return;
		if (edgeSettle?.cur === cur) {
			edgeSettle.cancel();
			edgeSettle = null;
		}
		edge = {
			id: e.pointerId,
			x0: e.clientX,
			y0: e.clientY,
			at: e.timeStamp,
			t0: liveTranslate(cur).x,
			w: cur.offsetWidth,
			on: false,
			cur,
			prev,
			v: new Tracker()
		};
		edge.v.add(e.clientX, e.timeStamp);
		// No preventDefault / capture: a tap at the edge still works.
		edgeListen(true);
	}
	function edgePaint(t: number): void {
		const g = edge;
		if (!g || !dimEl) return;
		g.cur.style.transform = `translateX(${t}px)`;
		g.prev.style.transform = `translateX(${-0.28 * (g.w - t)}px)`;
		dimEl.style.opacity = String(1 - t / g.w);
	}
	function edgeEnd(): void {
		edgeListen(false);
		edge = null;
	}
	function edgeMove(e: PointerEvent): void {
		const g = edge;
		if (!g || e.pointerId !== g.id || !dimEl) return;
		g.v.add(e.clientX, e.timeStamp);
		const dx = e.clientX - g.x0;
		const dy = e.clientY - g.y0;
		if (!g.on) {
			// A scroll, or a hold (text selection, long-press) — not a swipe.
			if (Math.abs(dy) > LOCK_PX && Math.abs(dy) > Math.abs(dx)) return edgeEnd();
			if (e.timeStamp - g.at > 350) return edgeEnd();
			if (dx < LOCK_PX || dx < 1.5 * Math.abs(dy)) return;
			g.on = true;
			for (const el of [g.cur, g.prev]) {
				el.style.transition = 'none';
				el.style.willChange = 'transform';
			}
			g.prev.style.visibility = 'visible';
			g.prev.classList.add('edge-prev');
			g.cur.classList.add('edge-drag');
			dimEl.style.transition = 'none';
		}
		edgePaint(Math.min(g.w, Math.max(0, g.t0 + dx)));
	}
	function edgeUp(e: PointerEvent): void {
		const g = edge;
		if (!g || e.pointerId !== g.id || !dimEl) return;
		edgeListen(false);
		if (!g.on) {
			edge = null;
			return;
		}
		const dim = dimEl;
		const t = liveTranslate(g.cur).x;
		const v = e.type === 'pointercancel' ? 0 : g.v.velocity(e.timeStamp);
		const commit = v > -0.05 && t + project(v) > g.w / 2;
		const to = commit ? g.w : 0;
		const dur = releaseMs(to - t, v, 140, 300);
		g.cur.style.transition = g.prev.style.transition = `transform ${dur}ms var(--ease-drawer)`;
		dim.style.transition = `opacity ${dur}ms var(--ease-drawer)`;
		if (commit) {
			// Its new data-pos ("after") would hide it at once: keep it on top until it lands.
			g.cur.style.visibility = 'visible';
			g.cur.style.zIndex = '4';
			dim.style.zIndex = '3';
			app.back();
		}
		edgePaint(to);
		edge = null;
		const clean = (): void => {
			for (const el of [g.cur, g.prev, dim])
				for (const p of [
					'transform',
					'transition',
					'visibility',
					'z-index',
					'will-change',
					'opacity'
				])
					el.style.removeProperty(p);
			g.cur.classList.remove('edge-drag');
			g.prev.classList.remove('edge-prev');
			edgeSettle = null;
		};
		edgeSettle = { cur: g.cur, cancel: afterTransition(g.cur, dur, clean) };
	}

	function onKeydown(e: KeyboardEvent): void {
		const mod = e.metaKey || e.ctrlKey;
		// Mod+/ toggles the shortcuts cheat sheet from anywhere.
		if (mod && e.key === '/') {
			e.preventDefault();
			app.toggleCheatSheet();
			return;
		}
		// Mod+N creates a new note.
		if (mod && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
			e.preventDefault();
			app.createNote();
			return;
		}
		// Tabs: Mod+W closes the current one (never the window), Ctrl+Tab steps through them.
		if (app.settings.tabs && mod && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
			e.preventDefault();
			if (app.tabIndex >= 0) void app.closeTab(app.tabIndex);
			return;
		}
		if (app.settings.tabs && e.ctrlKey && e.key === 'Tab') {
			e.preventDefault();
			app.cycleTab(e.shiftKey ? -1 : 1);
			return;
		}
		// Mod+P pins / unpins the active note.
		if (mod && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
			if (!app.activeId) return;
			e.preventDefault();
			app.togglePin(app.activeId);
			return;
		}
		// Mod+J toggles the AI harness pane.
		if (mod && !e.shiftKey && (e.key === 'j' || e.key === 'J') && app.settings.ai) {
			e.preventDefault();
			app.toggleHarness();
			return;
		}
		// Mod+G opens the linked-note map when the feature is enabled.
		if (mod && !e.shiftKey && (e.key === 'g' || e.key === 'G') && app.settings.linkedNotes) {
			e.preventDefault();
			app.openGraph();
			return;
		}
		// Mod+Shift+L shows / hides the note list.
		if (mod && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
			e.preventDefault();
			app.toggleList();
			return;
		}
		// Mod+Shift+E switches the open note between view and edit mode.
		if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
			if (!app.activeId && !app.draft) return;
			e.preventDefault();
			app.toggleEditing();
			if (app.editing) app.editor?.commands.focus();
			return;
		}
		// Mod+Shift+K locks encrypted notes.
		if (mod && e.shiftKey && (e.key === 'k' || e.key === 'K') && app.vault?.unlocked) {
			e.preventDefault();
			app.lockVault();
			return;
		}
		// Mod+\ toggles Zen mode.
		if (mod && e.key === '\\') {
			e.preventDefault();
			app.toggleZen();
			return;
		}
		// Mod+, opens/closes Settings.
		if (mod && e.key === ',') {
			e.preventDefault();
			app.toggleSettings();
			return;
		}
		// Escape closes the cheat sheet first, then leaves Settings / Changes / Zen.
		if (e.key === 'Escape') {
			if (app.cheatSheetOpen) app.toggleCheatSheet();
			else if (app.swipeOpen) app.swipeOpen = null;
			else if (app.view !== 'editor') app.setView('editor');
			else if (app.zen) app.toggleZen();
		}
	}

	app.init();
</script>

<svelte:window onkeydown={onKeydown} />

<div class={['app', { zen: app.zen, resizing: app.resizing }]}>
	<TitleBar />
	<!-- The body renders only once init() has restored the workspace, settings
	     and last-open note, then fades in — no flash from empty to full. -->
	{#if app.booted}
		<div
			class={[
				`body layout-${app.layout}`,
				{
					'drawer-open': app.drawerOpen,
					'harness-open': app.harnessOpen,
					'sheet-expanded': app.sheetExpanded,
					overlay
				}
			]}
			data-layout={app.layout}
			data-pane={phone ? (overlay ? app.view : app.pane) : undefined}
			onpointerdowncapture={edgeDown}
			style:--sidebar-w="{fit.side || app.widths.sidebar}px"
			style:--list-w="{fit.list || app.widths.list}px"
			style:--harness-w="{fit.ai}px"
			in:fade={{ duration: ms.pane, easing: easeOut }}
		>
			<div
				class="sidebar-wrap"
				{@attach pane('nav')}
				data-pos={pos('nav')}
				style:width={desktop ? `${sidebarWidth.current}px` : null}
				aria-hidden={!sidebarShown}
				inert={!sidebarShown || (phone && overlay)}
			>
				<Sidebar />
			</div>
			{#if desktop && fit.side > 0}
				<Resizer
					value={app.widths.sidebar}
					min={PANE_WIDTHS.sidebar.min}
					max={PANE_WIDTHS.sidebar.max}
					label="Resize sidebar"
					onresize={(px) => resize('sidebar', px)}
					onreset={() => app.resetWidth('sidebar')}
				/>
			{/if}
			{#if tablet && app.drawerOpen}
				<button
					class="scrim"
					aria-label="Close folders"
					onclick={() => app.toggleDrawer()}
					in:fade={{ duration: ms.pane, easing: easeOut }}
					out:fade={{ duration: ms.exit }}
				></button>
			{/if}
			<main class="content">
				<div
					class="list-wrap"
					{@attach pane('list')}
					data-pos={pos('list')}
					style:width={phone ? null : `${listWidth.current}px`}
					aria-hidden={!listShown || overlay}
					inert={!listShown || overlay}
				>
					<NoteList />
				</div>
				{#if !phone && fit.list > 0}
					<Resizer
						value={app.widths.list}
						min={PANE_WIDTHS.list.min}
						max={PANE_WIDTHS.list.max}
						label="Resize note list"
						onresize={(px) => resize('list', px)}
						onreset={() => app.resetWidth('list')}
					/>
				{/if}
				<div
					class="editor-wrap"
					{@attach pane('editor')}
					data-pos={pos('editor')}
					aria-hidden={!editorShown || overlay}
					inert={!editorShown || overlay}
				>
					<Editor />
				</div>
				{#if overlay}
					<div
						class="view-overlay"
						in:fly={phone
							? { x: '100%', opacity: 1, duration: ms.pane, easing: easeDrawer }
							: { y: 8, duration: ms.pop, easing: easeOut }}
						out:fly={phone
							? { x: '100%', opacity: 1, duration: ms.exit, easing: easeOut }
							: { y: 0, opacity: 0, duration: ms.out }}
					>
						{#if app.view === 'settings'}
							<Settings />
						{:else if app.view === 'changes'}
							<Changes />
						{:else if graphModule}
							{#await graphModule then m}
								<m.default />
							{/await}
						{/if}
					</div>
				{/if}
			</main>
			{#if tablet && app.harnessOpen}
				<button
					class="scrim sheet-scrim"
					bind:this={sheetScrim}
					aria-label="Close AI"
					onclick={() => app.closeHarness()}
					in:fade={scrimIn}
					out:fade={scrimOut}
				></button>
			{/if}
			{#if desktop && app.harnessOpen}
				<Resizer
					value={app.widths.harness}
					min={PANE_WIDTHS.harness.min}
					max={PANE_WIDTHS.harness.max}
					edge="start"
					label="Resize AI pane"
					onresize={(px) => resize('harness', px)}
					onreset={() => app.resetWidth('harness')}
				/>
			{/if}
			<div
				bind:this={sheetEl}
				{@attach pane('harness')}
				class="harness-wrap"
				data-pos={pos('harness')}
				style:width={desktop ? `${harnessWidth.current}px` : null}
				aria-hidden={!harnessShown}
				inert={!harnessShown}
			>
				{#if tablet}
					<div
						class="sheet-handle"
						role="button"
						tabindex="0"
						aria-label={app.sheetExpanded ? 'Shrink AI sheet' : 'Expand AI sheet'}
						onpointerdown={sheetDown}
						onpointermove={sheetMove}
						onpointerup={sheetUp}
						onpointercancel={sheetUp}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								toggleSheet();
							}
						}}
					>
						<span></span>
					</div>
				{/if}
				{#if harnessModule}
					{#await harnessModule then m}
						<m.default />
					{/await}
				{/if}
			</div>
			<div class="pane-dim" bind:this={dimEl} aria-hidden="true"></div>
		</div>
	{:else}
		<div class="body"></div>
	{/if}

	{#if app.cheatSheetOpen}
		<CheatSheet />
	{/if}

	<NoteContextMenu />
	<FolderContextMenu />
	<MoveDialog />
	<PromptDialog />
	<ConfirmDialog />
	<Notice />

	{#if app.conflictOpen}
		<!-- Same resolver the desktop opens as a second window; closes on sync done. -->
		<div class="conflict-overlay" transition:fade={{ duration: 160 * motionK() }}>
			<ConflictWindow />
		</div>
	{/if}
</div>

<style>
	.conflict-overlay {
		position: fixed;
		inset: 0;
		z-index: 50;
		overflow: auto;
		background: var(--bg-primary);
	}
	.app {
		display: flex;
		flex-direction: column;
		height: 100%;
		/* Android edge-to-edge: keep the top bar clear of the status bar (0 on desktop). */
		padding-top: env(safe-area-inset-top, 0px);
	}
	.app.resizing {
		cursor: col-resize;
		user-select: none;
	}
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
		position: relative;
		/* Off-screen drawers / sheets (translated out of view) must never become
		   scroll offset: `clip` (unlike `hidden`) can't be scrolled by focus or
		   scrollIntoView. Chromium 90+, so fine for the oldest Android WebView. */
		overflow: hidden;
		overflow: clip;
	}
	.sidebar-wrap {
		flex: 0 0 auto;
		overflow: hidden;
		min-width: 0;
	}
	.content {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 10px;
		padding: 0 10px 10px;
	}
	/* A zero-width resizer between two flex items would double the gap. */
	.content > :global(.resizer) {
		margin: 0 -5px;
	}
	.list-wrap {
		flex: 0 0 auto;
		min-width: 0;
		overflow: hidden;
		display: flex;
	}
	.list-wrap > :global(.notelist) {
		flex: 0 0 auto;
	}
	.editor-wrap {
		flex: 1;
		min-width: 0;
		display: flex;
	}

	/* Settings / Changes cover the list + editor, which stay mounted beneath. */
	.view-overlay {
		position: absolute;
		top: 0;
		left: 10px;
		right: 10px;
		bottom: 10px;
		z-index: 8;
		display: flex;
	}
	/* Zen: the editor pane fills the whole window (its text stays centred via
	   the editor's own max-width), so it reaches edge to edge. */
	.app.zen .content {
		gap: 0;
		padding: 0;
	}
	.app.zen :global(.editor-pane) {
		border-radius: 0;
		box-shadow: none;
	}
	.app.zen .view-overlay {
		inset: 0;
	}

	/* --- tablet: list + editor; folders slide in as a drawer ------------- */
	.layout-tablet .sidebar-wrap {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		z-index: 20;
		width: min(320px, 80vw);
		background: var(--bg-primary);
		box-shadow: 8px 0 24px rgba(0, 0, 0, 0.12);
		transform: translateX(-105%);
		transition: transform var(--dur-exit) var(--ease-out);
	}
	.layout-tablet.drawer-open .sidebar-wrap {
		transform: none;
		transition: transform var(--dur-pane) var(--ease-drawer);
	}
	/* The sidebar fills the drawer (its desktop width would leave a bare strip). */
	.layout-tablet .sidebar-wrap > :global(.sidebar) {
		width: 100%;
	}
	.layout-tablet .list-wrap {
		max-width: 50%;
	}
	.layout-tablet .list-wrap > :global(.notelist) {
		width: 100%;
		flex: 1 1 auto;
	}
	.scrim {
		position: absolute;
		inset: 0;
		z-index: 15;
		background: rgba(0, 0, 0, 0.22);
	}
	.sheet-scrim {
		z-index: 17;
		background: rgba(0, 0, 0, 0.14);
	}

	/* --- AI harness: side split / bottom sheet / own pane ----------------- */
	.harness-wrap {
		flex: 0 0 auto;
		min-width: 0;
		overflow: hidden;
	}
	.layout-desktop .harness-wrap {
		padding: 0 10px 10px 0;
	}
	.layout-desktop .harness-wrap > :global(.harness) {
		width: calc(var(--harness-w) - 10px);
	}
	.layout-tablet .harness-wrap {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 18;
		height: 58%;
		display: flex;
		flex-direction: column;
		padding: 0 8px;
		transform: translateY(105%);
		transition:
			transform var(--dur-exit) var(--ease-out),
			height var(--dur-sheet) var(--ease-in-out);
	}
	.layout-tablet.sheet-expanded .harness-wrap {
		height: calc(100% - 12px);
	}
	.layout-tablet.harness-open .harness-wrap {
		transform: none;
		transition:
			transform var(--dur-sheet) var(--ease-drawer),
			height var(--dur-sheet) var(--ease-in-out);
	}
	.layout-tablet .harness-wrap > :global(.harness) {
		flex: 1;
		min-height: 0;
		height: auto;
		border-radius: 0;
		box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.16);
	}
	.sheet-handle {
		position: relative;
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		height: 24px;
		border-radius: 16px 16px 0 0;
		background: var(--bg-editor);
		box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.12);
		touch-action: none;
		cursor: ns-resize;
	}
	/* A finger-sized grab area above the visible strip. */
	.sheet-handle::before {
		content: '';
		position: absolute;
		inset: -14px 0 0;
	}
	.sheet-handle span {
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--rule);
		transition: background var(--dur-fast) ease;
	}
	.sheet-handle:active span {
		background: var(--text-muted);
	}

	/* --- phone: one pane on screen; the others wait off to the side -------- */
	/* `clip` as on `.body`: the off-screen panes must never become a scroll offset
	   (focusing a Settings field used to shift the whole UI sideways). */
	.layout-phone {
		overflow: hidden;
		overflow: clip;
	}
	.layout-phone .content {
		display: contents;
	}
	.layout-phone .sidebar-wrap,
	.layout-phone .list-wrap,
	.layout-phone .editor-wrap,
	.layout-phone .harness-wrap {
		position: absolute;
		inset: 0;
		display: flex;
		transition:
			transform var(--dur-pane) var(--ease-drawer),
			visibility 0s linear var(--dur-pane);
	}
	/* The page being covered dims a little, as on iOS: says which way you went.
	   A composited layer, no filter. */
	.layout-phone .sidebar-wrap::after,
	.layout-phone .list-wrap::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 10;
		pointer-events: none;
		background: #000;
		opacity: 0;
		transition: opacity var(--dur-pane) var(--ease-drawer);
	}
	.layout-phone .sidebar-wrap[data-pos='before']::after,
	.layout-phone .list-wrap[data-pos='before']::after {
		opacity: 0.1;
	}
	/* Edge swipe back: the dim follows the finger instead (.pane-dim). */
	.layout-phone :global(.edge-prev)::after {
		opacity: 0 !important;
		transition: none !important;
	}
	.pane-dim {
		display: none;
	}
	.layout-phone .pane-dim {
		display: block;
		position: absolute;
		inset: 0;
		z-index: 1; /* after the wrappers: above "before" (1), below "current" (2) */
		background: rgba(0, 0, 0, 0.1);
		opacity: 0;
		pointer-events: none;
	}
	.layout-phone :global(.edge-drag) {
		box-shadow: -10px 0 28px rgba(0, 0, 0, 0.12);
	}
	/* Horizontal drags reach the edge swipe instead of becoming a pan (up to the
	   nearest scroller, so the scrollers say it too; wide tables keep theirs). */
	.layout-phone .list-wrap,
	.layout-phone .editor-wrap,
	.layout-phone .harness-wrap,
	.layout-phone :global(.notelist .list),
	.layout-phone :global(.editor-pane .scroll),
	.layout-phone :global(.harness .transcript) {
		touch-action: pan-y pinch-zoom;
	}
	.layout-phone .sidebar-wrap {
		background: var(--bg-primary);
	}
	.layout-phone .sidebar-wrap > :global(.sidebar),
	.layout-phone .list-wrap > :global(.notelist),
	.layout-phone .harness-wrap > :global(.harness) {
		width: 100%;
		flex: 1 1 auto;
	}
	.layout-phone [data-pos='current'] {
		z-index: 2;
		transform: none;
		visibility: visible;
		transition:
			transform var(--dur-pane) var(--ease-drawer),
			visibility 0s linear 0s;
	}
	.layout-phone [data-pos='before'] {
		z-index: 1;
		transform: translateX(-28%);
		visibility: hidden;
	}
	.layout-phone [data-pos='after'] {
		z-index: 3;
		transform: translateX(100%);
		visibility: hidden;
		box-shadow: -10px 0 28px rgba(0, 0, 0, 0.12);
	}
	.layout-phone .view-overlay {
		inset: 0;
		z-index: 6;
	}
	.layout-phone .harness-wrap > :global(.harness) {
		border-radius: 0;
		box-shadow: none;
	}
</style>
