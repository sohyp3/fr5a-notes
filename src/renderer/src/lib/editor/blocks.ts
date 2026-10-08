import { Fragment, Slice } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

/**
 * Helpers shared by the block-level features (tables, images, highlights) of
 * the line-per-paragraph editor.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Which lines sit inside fenced code (fence lines included): no blocks there. */
export function codeLines(lines: string[]): boolean[] {
	const out = new Array<boolean>(lines.length).fill(false);
	let fence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const f = FENCE.exec(lines[i]);
		if (fence) {
			out[i] = true;
			if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
		} else if (f) {
			out[i] = true;
			fence = f[1];
		}
	}
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
