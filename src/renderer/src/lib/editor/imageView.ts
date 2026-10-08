import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { clampSize, parseImage, parseSize, sizeComment } from './images';

/**
 * The picture standing in for an image line (MarkdownSyntax puts it right
 * above the line, which is hidden until the caret enters it). While editable:
 * a press on the picture puts the caret at the end of its line, and the
 * corner handle drags its width, written to the `<!-- size: N% -->` comment
 * below the line (double-click: back to the picture's own width).
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
