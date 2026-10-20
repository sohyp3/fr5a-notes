import { reducedMotion } from './portal';

/**
 * Touch-gesture helpers: release velocity, momentum projection, rubber-banding
 * and velocity-matched release durations. Pure — no Svelte state — so any
 * component can use them. Releases of big surfaces are CSS transform
 * transitions (compositor: they keep going while the main thread is busy).
 */

/** Left-edge zone that starts Back on phones (≈ iOS screen-edge pan). */
export const EDGE_BACK_PX = 20;
/** Movement before a gesture commits to an axis. */
export const LOCK_PX = 10;

/** The last ~100 ms of one coordinate → release velocity in px/ms. */
export class Tracker {
	#s: { p: number; t: number }[] = [];
	add(p: number, t: number): void {
		this.#s.push({ p, t });
		while (this.#s.length > 2 && t - this.#s[0].t > 100) this.#s.shift();
	}
	/** px/ms; 0 when the finger rested ≥ 50 ms before lifting (placed, not thrown). */
	velocity(now: number): number {
		const a = this.#s[0];
		const b = this.#s[this.#s.length - 1];
		return !a || a === b || now - b.t > 50 ? 0 : (b.p - a.p) / Math.max(1, b.t - a.t);
	}
}

/** Where a release at `v` px/ms would come to rest (deceleration rate `d` per ms). */
export const project = (v: number, d = 0.998): number => (v * d) / (1 - d);

/** Resistance past a bound: the further it goes, the less it follows. */
export const rubberband = (over: number, dim: number, c = 0.55): number =>
	(over * dim * c) / (dim + c * Math.abs(over));

/**
 * Duration of a release transition that starts at the finger's speed, for a
 * curve whose initial slope is `slope` (2.25 for --ease-drawer).
 */
export function releaseMs(dist: number, v: number, min = 140, max = 300, slope = 2.25): number {
	if (reducedMotion()) return 0;
	const d = Math.abs(dist);
	const s = Math.abs(v);
	const t = s > 0.05 ? (slope * d) / s : 120 + 0.4 * d;
	return Math.round(Math.min(max, Math.max(min, t)));
}

/** The element's translate right now (mid-transition included). */
export function liveTranslate(el: HTMLElement): { x: number; y: number } {
	const t = getComputedStyle(el).transform;
	if (!t || t === 'none') return { x: 0, y: 0 };
	const m = new DOMMatrixReadOnly(t);
	return { x: m.m41, y: m.m42 };
}

/**
 * `done` once el's transform transition ends. A timer backs it up: Chromium
 * fires no `transitionend` for 0 ms or unchanged values. Returns a cancel.
 */
export function afterTransition(el: HTMLElement, ms: number, done: () => void): () => void {
	const stop = (): void => {
		clearTimeout(timer);
		el.removeEventListener('transitionend', onEnd);
	};
	const fire = (): void => {
		stop();
		done();
	};
	const onEnd = (e: TransitionEvent): void => {
		if (e.target === el && e.propertyName === 'transform') fire();
	};
	el.addEventListener('transitionend', onEnd);
	const timer = setTimeout(fire, ms + 40);
	return stop;
}

/**
 * Attachment for a bottom sheet: drag it down to dismiss (a flick does it from
 * anywhere), lifting it resists, the scrim follows the drag. A sheet that fits
 * owns every drag; one that scrolls only by its top strip (`.grip`, `.sheet-title`).
 * `dismiss` runs once the sheet has left the screen, so its own outro should be
 * instant then. A drag that started on a row never also runs it.
 */
export function dragToDismiss(scrim: () => HTMLElement | null, dismiss: () => void) {
	return (node: HTMLElement): (() => void) => {
		let g: { id: number; y0: number; h: number; on: boolean; v: Tracker } | null = null;
		let dragged = false;
		const fits = (): boolean => node.scrollHeight <= node.clientHeight + 1;
		// Otherwise the browser claims the vertical drag as a (no-op) pan.
		if (fits()) node.style.touchAction = 'none';
		const down = (e: PointerEvent): void => {
			dragged = false;
			if (e.pointerType === 'mouse' || g) return;
			if (!fits() && !(e.target as Element).closest('.grip, .sheet-title')) return;
			g = { id: e.pointerId, y0: e.clientY, h: node.offsetHeight, on: false, v: new Tracker() };
			g.v.add(e.clientY, e.timeStamp);
		};
		const move = (e: PointerEvent): void => {
			if (!g || e.pointerId !== g.id) return;
			g.v.add(e.clientY, e.timeStamp);
			const dy = e.clientY - g.y0;
			if (!g.on) {
				if (Math.abs(dy) < LOCK_PX) return;
				g.on = dragged = true;
				node.setPointerCapture(e.pointerId);
				node.style.transition = 'none';
			}
			const y = dy >= 0 ? dy : -rubberband(-dy, g.h);
			node.style.transform = `translateY(${y}px)`;
			const s = scrim();
			if (s) s.style.opacity = String(1 - Math.max(0, y) / g.h);
		};
		const up = (e: PointerEvent): void => {
			if (!g || e.pointerId !== g.id) return;
			const s = g;
			g = null;
			if (!s.on) return;
			const y = Math.max(0, liveTranslate(node).y);
			const v = e.type === 'pointercancel' ? 0 : s.v.velocity(e.timeStamp);
			const close = v > -0.05 && y + project(v) > s.h * 0.4;
			const to = close ? s.h + 40 : 0; // +40: its upward shadow clears the screen too
			const ms = releaseMs(to - y, v, 140, 280);
			node.style.transition = `transform ${ms}ms var(--ease-drawer)`;
			node.style.transform = `translateY(${to}px)`;
			const sc = scrim();
			if (sc) {
				sc.style.transition = `opacity ${ms}ms var(--ease-out)`;
				sc.style.opacity = close ? '0' : '';
			}
			afterTransition(node, ms, () => {
				if (close) dismiss();
				else {
					node.style.removeProperty('transition');
					node.style.removeProperty('transform');
				}
			});
		};
		const click = (e: MouseEvent): void => {
			if (!dragged) return;
			e.stopPropagation();
			e.preventDefault();
			dragged = false;
		};
		node.addEventListener('pointerdown', down);
		node.addEventListener('pointermove', move);
		node.addEventListener('pointerup', up);
		node.addEventListener('pointercancel', up);
		node.addEventListener('click', click, true);
		return () => {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			node.removeEventListener('click', click, true);
		};
	};
}
