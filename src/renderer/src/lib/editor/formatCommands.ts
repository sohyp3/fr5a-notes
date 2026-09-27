import { TextSelection } from '@tiptap/pm/state';
import type { Command } from '@tiptap/pm/state';
import { LIST_RE } from './ListBehavior';

/**
 * Line-level formatting for the touch toolbar. Like the rest of the editor,
 * these edit the raw Markdown text of the caret's line (one paragraph per
 * line) — no heading or list nodes are ever created.
 */

const HEADING_RE = /^(#{1,6})\s+/;

function line(state: Parameters<Command>[0]) {
	const $head = state.selection.$head;
	return { start: $head.start(), text: $head.parent.textContent };
}

/** Cycle the line: plain → `# ` → `## ` → `### ` → plain. */
export const cycleHeading: Command = (state, dispatch) => {
	const { start, text } = line(state);
	const m = text.match(HEADING_RE);
	const level = m ? m[1].length : 0;
	const next = level >= 3 ? '' : '#'.repeat(level + 1) + ' ';
	if (dispatch) {
		const tr = state.tr;
		if (m) tr.delete(start, start + m[0].length);
		if (next) tr.insertText(next, start);
		dispatch(tr.scrollIntoView());
	}
	return true;
};

/** Toggle a `- ` bullet on the line, keeping its indentation. */
export const toggleBullet: Command = (state, dispatch) => {
	const { start, text } = line(state);
	const m = text.match(LIST_RE);
	if (dispatch) {
		const tr = state.tr;
		if (m) {
			const indent = m[1].length;
			tr.delete(start + indent, start + m[0].length);
		} else {
			const indent = text.match(/^\s*/)![0].length;
			tr.insertText('- ', start + indent);
		}
		dispatch(tr.scrollIntoView());
	}
	return true;
};

/** Insert `#` at the caret (space-separated) so tag autocomplete opens. */
export const insertTag: Command = (state, dispatch) => {
	const { from, $from } = state.selection;
	const before = $from.parent.textContent.slice(0, $from.parentOffset);
	const text = before === '' || /\s$/.test(before) ? '#' : ' #';
	if (dispatch) {
		const tr = state.tr.insertText(text, from, state.selection.to);
		tr.setSelection(TextSelection.create(tr.doc, from + text.length));
		dispatch(tr.scrollIntoView());
	}
	return true;
};
