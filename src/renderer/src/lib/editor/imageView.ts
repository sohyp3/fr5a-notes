import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { docLines } from './blocks';
import {
	clampSize,
	dropGaps,
	findImages,
	moveLines,
	parseImage,
	parseSize,
	sizeComment
} from './images';

/**
 * The picture standing in for an image line (MarkdownSyntax puts it right
 * above the line, which is hidden until the caret enters it). While editable:
 * a press on the picture puts the caret at the end of its line, the corner
 * handle drags its width, written to the `<!-- size: N% -->` comment below
 * the line (double-click: back to the picture's own width), and dragging the
 * picture (touch: long-press, then drag) moves its lines elsewhere.
 */

export interface ImageView {
	/** What `<img>` loads; null when the source can't be shown. */
	url: string | null;
	src: string;
	alt: string;
	size: number | null;
}

/** Set (or with null, drop) the width comment of the image line at `pos`. */
export function setImageSize(view: EditorView, pos: number, pct: number | null): void {
	const { state } = view;
	const i = state.doc.resolve(pos).index(0);
	if (i >= state.doc.childCount || !parseImage(state.doc.child(i).textContent)) return;
	const end = pos + state.doc.child(i).nodeSize;
	const next = i + 1 < state.doc.childCount ? state.doc.child(i + 1) : null;
	const { schema } = state;
	const line = () => schema.nodes.paragraph.create(null, schema.text(sizeComment(pct!)));
	const tr = state.tr;
	if (next && parseSize(next.textContent) !== null) {
		if (pct === null) tr.delete(end, end + next.nodeSize);
		else tr.replaceWith(end, end + next.nodeSize, line());
	} else if (pct !== null) tr.insert(end, line());
	if (tr.docChanged) view.dispatch(tr);
}

/**
 * Move the image block at `pos` (its line and size comment) to before line
 * `gap` (see `dropGaps`). A caret inside it moves along.
 */
export function moveImage(view: EditorView, pos: number, gap: number): void {
	const { state } = view;
	const { lines, starts } = docLines(state);
	const from = state.doc.resolve(pos).index(0);
	const img = findImages(lines).get(from);
	if (!img) return;
	const to = img.sizeLine ?? from;
	const plan = moveLines(lines, from, to, gap);
	if (!plan) return;
	const at = (i: number) => (i < lines.length ? starts[i] : state.doc.content.size);
	const { schema } = state;
	const tr = state.tr.delete(at(plan.cut[0]), at(plan.cut[1]));
	const into = tr.mapping.map(at(plan.at));
	tr.insert(
		into,
		plan.insert.map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : null))
	);
	const { anchor, head, from: a, to: b } = state.selection;
	if (a >= starts[from] && b <= at(to + 1)) {
		const shift = into + plan.offset * 2 - starts[from]; // a padding line is an empty paragraph
		tr.setSelection(TextSelection.create(tr.doc, anchor + shift, head + shift));
	}
	view.dispatch(tr);
}

/** The element `el` scrolls in. */
function scrollParent(el: HTMLElement): HTMLElement {
	for (let p = el.parentElement; p; p = p.parentElement) {
		const { overflowY } = getComputedStyle(p);
		if (overflowY === 'auto' || overflowY === 'scroll') return p;
	}
	return document.documentElement;
}

/**
 * Each gap a picture may land in, with its y in the scroller's content:
 * midway between the lines around it (a widget drawn above a line — a
 * picture, a table — counts as part of it; hidden lines don't count).
 */
function gapPlaces(view: EditorView, scroller: HTMLElement, from: number, to: number) {
	const { lines } = docLines(view.state);
	const ok = dropGaps(lines);
	ok[from] = ok[to + 1] = true; // staying put is always an option
	const spans: ({ top: number; bottom: number } | null)[] = [];
	view.state.doc.forEach((_node, pos) => {
		const p = view.nodeDOM(pos) as HTMLElement | null;
		const widget = p?.previousElementSibling;
		const shown = [widget?.matches('.md-image, .md-table') ? widget : null, p].filter(
			(el): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0
		);
		const rects = shown.map((el) => el.getBoundingClientRect());
		spans.push(rects.length ? { top: rects[0].top, bottom: rects[rects.length - 1].bottom } : null);
	});
	const below: (number | null)[] = new Array(spans.length + 1).fill(null);
	for (let k = spans.length - 1; k >= 0; k--) below[k] = spans[k]?.top ?? below[k + 1];
	const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
	const out: { gap: number; y: number }[] = [];
	let above: number | null = null;
	for (let k = 0; k <= lines.length; k++) {
		const next = below[k];
		const y = above !== null && next !== null ? (above + next) / 2 : (above ?? next);
		if (ok[k] && y !== null) out.push({ gap: k, y: y - base });
		if (k < spans.length) above = spans[k]?.bottom ?? above;
	}
	return out;
}

/** Touch: how long a press lifts the picture; a plain drag scrolls. */
const LIFT_MS = 400;
/** Mouse: how far a press moves before it drags. Touch: before it scrolls instead. */
const SLOP = { mouse: 5, touch: 10 };
/** How near the scroller's top / bottom a drag scrolls it. */
const EDGE = 48;

function draggable(
	view: EditorView,
	getPos: () => number | undefined,
	wrap: HTMLElement,
	frame: HTMLElement
): void {
	let lifted = false;
	let pressed = false;
	// While lifted, a finger's move drags instead of scrolling; a long press opens no menu.
	wrap.addEventListener('touchmove', (e) => lifted && e.preventDefault(), { passive: false });
	wrap.addEventListener('contextmenu', (e) => (pressed || lifted) && e.preventDefault());

	wrap.addEventListener('pointerdown', (down) => {
		const target = down.target as Element;
		if (!view.editable || down.button !== 0 || !down.isPrimary || pressed || lifted) return;
		if (target.closest('.md-image-handle')) return;
		const touch = down.pointerType !== 'mouse';
		let x = down.clientX;
		let y = down.clientY;
		pressed = true;
		const timer = touch ? window.setTimeout(() => lift(), LIFT_MS) : 0;
		const mine = (e: PointerEvent) => e.pointerId === down.pointerId;
		const release = () => {
			pressed = false;
			clearTimeout(timer);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', release);
			window.removeEventListener('pointercancel', release);
		};
		const move = (e: PointerEvent) => {
			if (!mine(e)) return;
			x = e.clientX;
			y = e.clientY;
			if (Math.hypot(x - down.clientX, y - down.clientY) < SLOP[touch ? 'touch' : 'mouse']) return;
			if (touch)
				release(); // a scroll
			else lift();
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', release);
		window.addEventListener('pointercancel', release);

		const lift = () => {
			release();
			const pos = getPos();
			if (pos === undefined || !view.editable) return;
			const from = view.state.doc.resolve(pos).index(0);
			const img = findImages(docLines(view.state).lines).get(from);
			if (!img) return;
			const to = img.sizeLine ?? from;
			lifted = true;
			const scroller = scrollParent(view.dom);
			const places = gapPlaces(view, scroller, from, to);
			const column = wrap.getBoundingClientRect();

			const ghost = document.createElement('div');
			ghost.className = 'md-image-ghost';
			const pic = frame.querySelector('img');
			ghost.append(pic ? pic.cloneNode() : frame.cloneNode(true));
			const line = document.createElement('div');
			line.className = 'md-image-drop';
			line.style.width = `${column.width}px`;
			document.body.append(ghost, line);
			const gh = ghost.offsetHeight;
			wrap.classList.add('moving');
			document.documentElement.classList.add('md-image-dragging');

			let gap: number | null = null;
			const place = () => {
				// Above the finger, so it stays in sight; beside the mouse pointer.
				const top = touch ? y - gh - 24 : y - gh / 2;
				ghost.style.transform = `translate(${x - ghost.offsetWidth / 2}px, ${top}px)`;
				const box = scroller.getBoundingClientRect();
				const at = Math.min(Math.max(y, box.top), box.bottom) - box.top + scroller.scrollTop;
				let best = places[0];
				for (const p of places) if (Math.abs(p.y - at) < Math.abs(best.y - at)) best = p;
				gap = best && best.gap !== from && best.gap !== to + 1 ? best.gap : null;
				line.hidden = gap === null;
				if (gap === null) return;
				const ly = Math.min(Math.max(best.y - scroller.scrollTop + box.top, box.top), box.bottom);
				line.style.transform = `translate(${column.left}px, ${ly - 1}px)`;
			};
			let raf = 0;
			const scroll = () => {
				const box = scroller.getBoundingClientRect();
				const v =
					y < box.top + EDGE
						? y - box.top - EDGE
						: y > box.bottom - EDGE
							? y - box.bottom + EDGE
							: 0;
				if (v) {
					scroller.scrollTop += Math.max(-EDGE, Math.min(EDGE, v)) / 3;
					place();
				}
				raf = requestAnimationFrame(scroll);
			};
			const drag = (e: PointerEvent) => {
				if (!mine(e)) return;
				x = e.clientX;
				y = e.clientY;
				place();
			};
			const finish = (commit: boolean) => {
				cancelAnimationFrame(raf);
				window.removeEventListener('pointermove', drag);
				window.removeEventListener('pointerup', drop);
				window.removeEventListener('pointercancel', cancel);
				window.removeEventListener('keydown', key, true);
				ghost.remove();
				line.remove();
				wrap.classList.remove('moving');
				document.documentElement.classList.remove('md-image-dragging');
				lifted = false;
				const at = getPos();
				if (commit && gap !== null && at !== undefined && !view.isDestroyed && view.editable)
					moveImage(view, at, gap);
			};
			const drop = (e: PointerEvent) => mine(e) && finish(true);
			const cancel = (e: PointerEvent) => mine(e) && finish(false);
			const key = (e: KeyboardEvent) => {
				if (e.key !== 'Escape') return;
				e.preventDefault();
				e.stopPropagation();
				finish(false);
			};
			window.addEventListener('pointermove', drag);
			window.addEventListener('pointerup', drop);
			window.addEventListener('pointercancel', cancel);
			window.addEventListener('keydown', key, true);
			place();
			raf = requestAnimationFrame(scroll);
		};
	});
}

function missing(frame: HTMLElement, img: ImageView): void {
	frame.classList.add('md-image-missing');
	frame.replaceChildren();
	const what = document.createElement('span');
	what.textContent = img.url ? 'Image not found' : 'Can’t show this image';
	const where = document.createElement('span');
	where.className = 'md-image-src';
	where.textContent = img.alt ? `${img.alt} · ${img.src}` : img.src;
	frame.append(what, where);
}

export function imageWidget(
	view: EditorView,
	getPos: () => number | undefined,
	img: ImageView
): HTMLElement {
	const wrap = document.createElement('div');
	wrap.className = 'md-image';
	wrap.contentEditable = 'false';
	const frame = document.createElement('div');
	frame.className = 'md-image-frame';
	if (img.size !== null) {
		frame.classList.add('sized');
		frame.style.width = `${img.size}%`;
	}
	wrap.append(frame);
	if (!img.url) {
		missing(frame, img);
		return wrap;
	}
	const pic = document.createElement('img');
	pic.alt = img.alt;
	pic.draggable = false;
	pic.decoding = 'async';
	pic.addEventListener('error', () => missing(frame, img));
	pic.src = img.url;
	const handle = document.createElement('span');
	handle.className = 'md-image-handle';
	handle.title = 'Drag to resize · double-click for the original size';
	const badge = document.createElement('span');
	badge.className = 'md-image-pct';
	frame.append(pic, handle, badge);

	draggable(view, getPos, wrap, frame);

	// A press on the picture: the caret goes to the end of its line (source shows).
	wrap.addEventListener('mousedown', (e) => {
		const at = getPos();
		if (handle.contains(e.target as Node) || at === undefined || !view.editable) return;
		e.preventDefault();
		const i = view.state.doc.resolve(at).index(0);
		if (i >= view.state.doc.childCount) return;
		const end = at + 1 + view.state.doc.child(i).content.size;
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
		view.focus();
	});

	handle.addEventListener('pointerdown', (e) => {
		if (!view.editable || e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		handle.setPointerCapture(e.pointerId);
		const column = wrap.getBoundingClientRect().width;
		const start = frame.getBoundingClientRect().width;
		const rtl = getComputedStyle(wrap).direction === 'rtl';
		const x0 = e.clientX;
		let pct = img.size ?? clampSize((start / column) * 100);
		badge.textContent = `${pct}%`;
		wrap.classList.add('resizing');
		const move = (ev: PointerEvent) => {
			const dx = (ev.clientX - x0) * (rtl ? -1 : 1);
			pct = clampSize(((start + dx) / column) * 100);
			frame.classList.add('sized');
			frame.style.width = `${pct}%`;
			badge.textContent = `${pct}%`;
		};
		const end = (commit: boolean) => () => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', done);
			handle.removeEventListener('pointercancel', cancel);
			wrap.classList.remove('resizing');
			const at = getPos();
			if (commit && pct !== img.size && at !== undefined) setImageSize(view, at, pct);
			else if (!commit) {
				frame.classList.toggle('sized', img.size !== null);
				frame.style.width = img.size === null ? '' : `${img.size}%`;
			}
		};
		const done = end(true);
		const cancel = end(false);
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', done);
		handle.addEventListener('pointercancel', cancel);
	});
	handle.addEventListener('dblclick', (e) => {
		e.preventDefault();
		const at = getPos();
		if (view.editable && at !== undefined && img.size !== null) setImageSize(view, at, null);
	});
	return wrap;
}
