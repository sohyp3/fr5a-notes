import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { insertBlock } from './blocks';
import { outsideBlocks } from './ImageBehavior';
import { cellRanges, findTables, parsePastedTable, toMarkdownTable } from './tables';

/**
 * Editing Markdown tables (rows are plain lines, laid out by MarkdownSyntax):
 *
 *   arrows       beside a rendered table (lines hidden): into its source
 *   Tab / ⇧Tab   next / previous cell, its text selected
 *   Enter        at the end of a row: a new empty row; on an empty row: leave
 *                the table (like double-Enter in a list), after a blank line
 *   Paste        a spreadsheet / web-table selection (tab-separated) becomes a
 *                Markdown table; Mod+Shift+V pastes the raw text
 *
 * `insertTable` (the Insert → Table picker) puts a blank table at the caret.
 */

interface RowCtx {
	text: string;
	/** Document position of the line's first character. */
	start: number;
	/** Offset of the caret (selection head) in the line. */
	off: number;
	role: 'head' | 'sep' | 'body';
	/** Every line's text, and which are table rows. */
	lines: string[];
	tables: ReturnType<typeof findTables>;
}

/** The table row holding the selection (within one line), if any. */
function rowAt(state: EditorState): RowCtx | null {
	const { $from, $to, $head } = state.selection;
	if ($head.depth !== 1 || $from.parent !== $to.parent) return null;
	const lines: string[] = [];
	state.doc.forEach((n) => lines.push(n.textContent));
	const tables = findTables(lines);
	const row = tables.get($head.index(0));
	if (!row) return null;
	return {
		text: $head.parent.textContent,
		start: $head.start(),
		off: $head.parentOffset,
		role: row.role,
		lines,
		tables
	};
}

/** Document position of line `i`'s first character. */
function lineStart(state: EditorState, i: number): number {
	let pos = 0;
	for (let k = 0; k < i; k++) pos += state.doc.child(k).nodeSize;
	return pos + 1;
}

/**
 * Arrow keys beside a rendered table (its lines are hidden, so the browser
 * would skip it): step into the source — the header from above / the left,
 * the last row from below / the right.
 */
function stepIn(view: EditorView, key: string): boolean {
	const { state } = view;
	const { $head, empty } = state.selection;
	if (!empty || $head.depth !== 1) return false;
	const lines: string[] = [];
	state.doc.forEach((n) => lines.push(n.textContent));
	const tables = findTables(lines);
	const i = $head.index(0);
	if (tables.has(i)) return false; // already in the source
	const forward = key === 'ArrowDown' || key === 'ArrowRight';
	if (key === 'ArrowRight' && $head.parentOffset < $head.parent.content.size) return false;
	if (key === 'ArrowLeft' && $head.parentOffset > 0) return false;
	if ((key === 'ArrowDown' || key === 'ArrowUp') && !view.endOfTextblock(forward ? 'down' : 'up'))
		return false;
	const j = i + (forward ? 1 : -1);
	if (!tables.has(j)) return false;
	const text = lines[j];
	const first = cellRanges(text)[0];
	const at = key === 'ArrowLeft' ? text.length : (first?.from ?? 0);
	view.dispatch(
		state.tr
			.setSelection(TextSelection.create(state.doc, lineStart(state, j) + at))
			.scrollIntoView()
	);
	return true;
}

function tab(view: EditorView, back: boolean): boolean {
	const { state } = view;
	const row = rowAt(state);
	if (!row || row.role === 'sep') return false;
	const cells = cellRanges(row.text);
	const i = cells.findIndex((c) => row.off <= c.to + 1);
	const cur = i === -1 ? cells.length - 1 : i;
	let target = cells[cur + (back ? -1 : 1)];
	let start = row.start;
	if (!target) {
		// Past the row's end: the first / last cell of the next / previous row.
		let j = state.doc.resolve(row.start).index(0) + (back ? -1 : 1);
		if (row.tables.get(j)?.role === 'sep') j += back ? -1 : 1;
		if (!row.tables.has(j)) return true; // table edge: stay (and don't indent)
		start = lineStart(state, j);
		const other = cellRanges(row.lines[j]);
		target = back ? other[other.length - 1] : other[0];
		if (!target) return true;
	}
	view.dispatch(
		state.tr
			.setSelection(TextSelection.create(state.doc, start + target.from, start + target.to))
			.scrollIntoView()
	);
	return true;
}

function enter(view: EditorView): boolean {
	const { state } = view;
	const row = state.selection.empty ? rowAt(state) : null;
	if (!row || row.role === 'sep') return false;
	const cells = cellRanges(row.text);
	if (cells.every((c) => c.from === c.to) && row.role === 'body') {
		// An empty row: leave the table, with a blank line after it — a line
		// right under the last row would read as another row elsewhere (GFM).
		const tr = state.tr.delete(row.start, row.start + row.text.length).split(row.start);
		view.dispatch(tr.setSelection(TextSelection.create(tr.doc, row.start + 2)).scrollIntoView());
		return true;
	}
	if (row.off !== row.text.length) return false;
	// A new row with as many (blank) cells, the caret in the first.
	const tr = state.tr.split(state.selection.head);
	const next = tr.selection.from;
	tr.insertText(`|${'  |'.repeat(Math.max(1, cells.length))}`, next);
	view.dispatch(tr.setSelection(TextSelection.create(tr.doc, next + 2)).scrollIntoView());
	return true;
}

/**
 * A blank table — `cols` columns, a header row and `rows - 1` body rows — as
 * lines of their own at the caret, which goes into its first header cell.
 */
export function insertTable(view: EditorView, cols: number, rows: number): void {
	const start = outsideBlocks(view.state.tr);
	const { $from } = start.selection;
	const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
	const tr = insertBlock(start, toMarkdownTable(grid), true);
	// Text before the caret keeps its line, then a blank line: the header follows.
	const before = $from.parent.textContent.slice(0, $from.parentOffset).trim();
	const head = $from.index(0) + (before ? 2 : 0);
	let pos = 1;
	for (let k = 0; k < head; k++) pos += tr.doc.child(k).nodeSize;
	const first = cellRanges(tr.doc.child(head).textContent)[0];
	view.dispatch(
		tr.setSelection(TextSelection.create(tr.doc, pos + (first?.from ?? 0))).scrollIntoView()
	);
	view.focus();
}

export const TableBehavior = Extension.create({
	name: 'tableBehavior',
	// Ahead of ListBehavior's Tab-indent, behind TagSuggest's open dropdown.
	priority: 200,

	addProseMirrorPlugins() {
		let plain = false;
		return [
			new Plugin({
				key: new PluginKey('tableBehavior'),
				props: {
					handleKeyDown(view, e) {
						plain = e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';
						if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return false;
						if (e.key.startsWith('Arrow') && !e.shiftKey) return stepIn(view, e.key);
						if (e.key === 'Tab') return tab(view, e.shiftKey);
						if (e.key === 'Enter' && !e.shiftKey) return enter(view);
						return false;
					},
					handlePaste(view, event) {
						const raw = plain;
						plain = false;
						const text = event.clipboardData?.getData('text/plain');
						const rows = !raw && text ? parsePastedTable(text) : null;
						if (!rows) return false;
						view.dispatch(insertBlock(view.state.tr, toMarkdownTable(rows), true).scrollIntoView());
						return true;
					}
				}
			})
		];
	}
});
