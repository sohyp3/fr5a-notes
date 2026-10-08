import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { docLines, insertBlock } from './blocks';
import { findImages, imageLine, isImageType, type ImageBlock } from './images';
import { findTables } from './tables';

/**
 * Editing images (lines painted by MarkdownSyntax, see images.ts):
 *
 *   arrows       beside a picture (its lines hidden): into its source line
 *   Backspace    at the start of the line below a picture: into its source
 *                (an empty line goes) — rather than joining onto the hidden
 *                lines; Delete at the end of the line above it likewise
 *   Enter        at the end of an image line: the new line goes below its
 *                size comment, which stays with the image
 *   Paste / drop image files: saved (`save`, under assets/) and linked, one
 *                line each
 */

export interface ImageBehaviorOptions {
	/** Store an image file; resolves to the link for the note, null on failure. */
	save: (file: File) => Promise<string | null>;
}

/** The image block a line belongs to (its image line or size comment). */
function blockAt(images: Map<number, ImageBlock>, i: number): number | null {
	if (images.has(i)) return i;
	if (images.get(i - 1)?.sizeLine === i) return i - 1;
	return null;
}

function caretAt(view: EditorView, pos: number): true {
	const { state } = view;
	view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)).scrollIntoView());
	return true;
}

/** Arrow keys next to a hidden image block: onto its image line. */
function stepIn(view: EditorView, key: string): boolean {
	const { $head, empty } = view.state.selection;
	if (!empty || $head.depth !== 1) return false;
	const { lines, starts } = docLines(view.state);
	const images = findImages(lines);
	const i = $head.index(0);
	if (blockAt(images, i) !== null) return false; // already in the source
	const forward = key === 'ArrowDown' || key === 'ArrowRight';
	if (key === 'ArrowRight' && $head.parentOffset < $head.parent.content.size) return false;
	if (key === 'ArrowLeft' && $head.parentOffset > 0) return false;
	if ((key === 'ArrowDown' || key === 'ArrowUp') && !view.endOfTextblock(forward ? 'down' : 'up'))
		return false;
	const b = blockAt(images, i + (forward ? 1 : -1));
	if (b === null) return false;
	return caretAt(view, starts[b] + 1 + (forward ? 0 : lines[b].length));
}

/** Backspace below / Delete above a hidden image block. */
function edge(view: EditorView, back: boolean): boolean {
	const { $head, empty } = view.state.selection;
	if (!empty || $head.depth !== 1) return false;
	if ($head.parentOffset !== (back ? 0 : $head.parent.content.size)) return false;
	const { lines, starts } = docLines(view.state);
	const images = findImages(lines);
	const i = $head.index(0);
	if (blockAt(images, i) !== null) return false;
	const b = blockAt(images, i + (back ? -1 : 1));
	if (b === null) return false;
	const into = starts[b] + 1 + (back ? lines[b].length : 0);
	if (lines[i] !== '') return caretAt(view, into);
	// An empty line: remove it, the caret into the image's source.
	const from = starts[i];
	const tr = view.state.tr.delete(from, from + view.state.doc.child(i).nodeSize);
	const pos = tr.mapping.map(into);
	view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos)).scrollIntoView());
	return true;
}

/** Enter at the end of an image line with a size comment: open a line below the comment. */
function enter(view: EditorView): boolean {
	const { $head, empty } = view.state.selection;
	if (!empty || $head.depth !== 1 || $head.parentOffset !== $head.parent.content.size) return false;
	const { lines, starts } = docLines(view.state);
	const img = findImages(lines).get($head.index(0));
	if (img?.sizeLine == null) return false;
	const at = starts[img.sizeLine] + view.state.doc.child(img.sizeLine).nodeSize;
	const tr = view.state.tr.insert(at, view.state.schema.nodes.paragraph.create());
	view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
	return true;
}

/**
 * With the caret in a table or an image block, a new block goes after it
 * rather than splitting one of its lines: the caret moves to the block's end.
 */
export function outsideBlocks(tr: Transaction): Transaction {
	const lines: string[] = [];
	tr.doc.forEach((n) => lines.push(n.textContent));
	let i = tr.selection.$head.index(0);
	const tables = findTables(lines);
	if (tables.has(i)) {
		while (!tables.get(i)!.last) i++;
	} else {
		const images = findImages(lines);
		const b = blockAt(images, i);
		if (b === null) return tr;
		i = images.get(b)!.sizeLine ?? b;
	}
	let pos = 1;
	for (let k = 0; k < i; k++) pos += tr.doc.child(k).nodeSize;
	return tr.setSelection(TextSelection.create(tr.doc, pos + tr.doc.child(i).content.size));
}

/** Image files out of a clipboard / drop payload. */
function imageFiles(data: DataTransfer | null): File[] {
	return [...(data?.files ?? [])].filter((f) => isImageType(f.type));
}

/**
 * Save `files` and put their image lines at the selection (or `pos`), each on
 * its own line. Used by paste, drop and the Insert → Image picker.
 */
export async function insertImages(
	view: EditorView,
	files: File[],
	save: ImageBehaviorOptions['save'],
	pos?: number
): Promise<void> {
	const lines: string[] = [];
	for (const f of files) {
		const link = await save(f);
		// A pasted image has no useful name; a dropped / picked file keeps its own as the alt text.
		const alt = /^image\.\w+$/i.test(f.name) ? '' : f.name.replace(/\.[^.]*$/, '');
		if (link) lines.push(imageLine(alt, link));
	}
	if (!lines.length || view.isDestroyed) return;
	const tr = view.state.tr;
	if (pos !== undefined)
		tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
	view.dispatch(insertBlock(outsideBlocks(tr), lines).scrollIntoView());
	view.focus();
}

export const ImageBehavior = Extension.create<ImageBehaviorOptions>({
	name: 'imageBehavior',
	// Ahead of the core keymap's joins and ListBehavior's Enter.
	priority: 150,

	addOptions() {
		return { save: async () => null };
	},

	addProseMirrorPlugins() {
		const { save } = this.options;
		return [
			new Plugin({
				key: new PluginKey('imageBehavior'),
				props: {
					handleKeyDown(view, e) {
						if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return false;
						if (e.key.startsWith('Arrow') && !e.shiftKey) return stepIn(view, e.key);
						if (e.shiftKey) return false;
						if (e.key === 'Backspace') return edge(view, true);
						if (e.key === 'Delete') return edge(view, false);
						if (e.key === 'Enter') return enter(view);
						return false;
					},
					handlePaste(view, event) {
						const files = imageFiles(event.clipboardData);
						if (!files.length || !view.editable) return false;
						void insertImages(view, files, save);
						return true;
					},
					handleDrop(view, event) {
						const files = imageFiles(event.dataTransfer);
						if (!files.length || !view.editable) return false;
						const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
						void insertImages(view, files, save, at?.pos);
						return true;
					}
				}
			})
		];
	}
});
