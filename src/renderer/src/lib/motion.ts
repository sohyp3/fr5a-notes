import { reducedMotion } from './portal';

/**
 * JS twins of the app.css motion tokens, for Svelte transitions (which run as
 * WAAPI, so the CSS reduced-motion rule never reaches them). Keep in sync.
 */

/** A CSS `cubic-bezier()` as an easing function (Svelte samples it per frame). */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;
	const x = (s: number) => ((ax * s + bx) * s + cx) * s;
	const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
	return (t) => {
		if (t <= 0) return 0;
		if (t >= 1) return 1;
		// Newton's method for the curve parameter at x = t.
		let s = t;
		for (let i = 0; i < 8; i++) {
			const d = dx(s);
			if (Math.abs(d) < 1e-6) break;
			s = Math.min(1, Math.max(0, s - (x(s) - t) / d));
		}
		return ((ay * s + by) * s + cy) * s;
	};
}

/** `--ease-out`: enters and exits. */
export const easeOut = bezier(0.23, 1, 0.32, 1);
/** `--ease-in-out`: things moving on screen (list reorder). */
export const easeInOut = bezier(0.77, 0, 0.175, 1);
/** `--ease-drawer`: panes, drawers, sheets. */
export const easeDrawer = bezier(0.32, 0.72, 0, 1);

const k = reducedMotion() ? 0 : 1;
/** Durations (ms), zero under reduced motion. `out` = popovers leaving. */
export const ms = {
	fast: 120 * k,
	out: 120 * k,
	pop: 160 * k,
	pane: 220 * k,
	sheet: 280 * k,
	exit: 200 * k
};

/** Bottom sheets: slide the whole height, no fade (they're physical). */
export const sheetIn = { y: '100%', opacity: 1, duration: ms.sheet, easing: easeDrawer };
export const sheetOut = { y: '100%', opacity: 1, duration: ms.exit, easing: easeOut };
/** Popovers / menus: grow a little from their anchor (set `transform-origin`). */
export const popIn = { start: 0.97, opacity: 0, duration: ms.pop, easing: easeOut };
/** Scrims: on the same clock as their sheet. */
export const scrimIn = { duration: ms.sheet, easing: easeOut };
export const scrimOut = { duration: ms.exit };

/**
 * Chromium 92 has no `inert`, which Svelte sets on outroing nodes: a menu
 * fading out could still take a tap. Use as `onoutrostart={offWhileLeaving}`.
 */
export function offWhileLeaving(e: Event): void {
	(e.currentTarget as HTMLElement).style.pointerEvents = 'none';
}
