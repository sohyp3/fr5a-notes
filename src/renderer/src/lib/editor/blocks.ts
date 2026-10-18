import { Fragment, Slice } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

/**
 * Helpers shared by the block-level features (tables, images, highlights) of
 * the line-per-paragraph editor.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export interface CodeRow {
	fence: boolean;
	first: boolean;
	last: boolean;
	/** A compact block such as ``` code ``` on one line. */
	single: boolean;
}

/** Fenced-code rows, including their opening and closing fence lines. */
export function findCodeRows(lines: string[]): Map<number, CodeRow> {
	const rows = new Map<number, CodeRow>();
	for (let i = 0; i < lines.length; i++) {
		const opening = FENCE.exec(lines[i]);
		if (!opening) continue;
		const marker = opening[1];
		const tail = lines[i].slice(opening[0].length);
		const inlineClose = new RegExp(`\\s${marker[0]}{${marker.length},}\\s*$`).exec(tail);
		if (inlineClose && tail.slice(0, inlineClose.index).trim()) {
			rows.set(i, { fence: true, first: true, last: true, single: true });
			continue;
		}

		let end = lines.length - 1;
		for (let j = i + 1; j < lines.length; j++) {
			const closing = FENCE.exec(lines[j]);
			if (
				closing &&
				closing[1][0] === marker[0] &&
				closing[1].length >= marker.length &&
				lines[j].slice(closing[0].length).trim() === ''
			) {
				end = j;
				break;
			}
		}
		for (let j = i; j <= end; j++)
			rows.set(j, {
				fence: j === i || j === end,
				first: j === i,
				last: j === end,
				single: false
			});
		i = end;
	}
	return rows;
}

/** Which lines sit inside fenced code (fence lines included): no blocks there. */
export function codeLines(lines: string[]): boolean[] {
	const out = new Array<boolean>(lines.length).fill(false);
	for (const i of findCodeRows(lines).keys()) out[i] = true;
	return out;
}

/** Every line's text, and where each line's paragraph starts (before the node). */
export function docLines(state: EditorState): { lines: string[]; starts: number[] } {
	const lines: string[] = [];
	const starts: number[] = [];
	state.doc.forEach((node, pos) => {
		lines.push(node.textContent);
		starts.push(pos);
	});
	return { lines, starts };
}

/**
 * Replace the selection with `block` as lines of their own: text before the
 * caret stays on its line, text after it moves below. `pad` puts a blank line
 * around the block where it meets text (a table needs that to stay a table).
 * The caret ends up after the block.
 */
export function insertBlock(tr: Transaction, block: string[], pad = false): Transaction {
	const { $from, $to } = tr.selection;
	const { schema } = tr.doc.type;
	const before = $from.parent.textContent.slice(0, $from.parentOffset).trim();
	const after = $to.parent.textContent.slice($to.parentOffset).trim();
	// Open slice: the first / last line merge with the text around the caret.
	const lines = [
		...(before ? (pad ? ['', ''] : ['']) : []),
		...block,
		...(after && pad ? ['', ''] : [''])
	];
	const p = schema.nodes.paragraph;
	const nodes = lines.map((l) => p.create(null, l ? schema.text(l) : null));
	return tr.replaceSelection(new Slice(Fragment.from(nodes), 1, 1));
}
