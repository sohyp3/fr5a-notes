import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Command } from '@tiptap/pm/state';

/**
 * Intelligent list handling for the raw-Markdown editor.
 *
 * The document stores literal Markdown (one line per paragraph), so there are no
 * ProseMirror `listItem` nodes to sink/lift. Instead we operate on the text:
 *
 *   Tab        → sink   (indent the list line by two spaces)
 *   Shift-Tab  → lift   (outdent by up to two spaces)
 *   Enter      → continue the bullet / number on the next line;
 *                a second Enter on an empty item clears the list formatting.
 *
 * These are the exact behaviours `sinkListItem` / `liftListItem` would give in a
 * node-based editor, adapted to our text model.
 */

const LIST_RE = /^(\s*)([-*+]|(\d+)\.)(\s+)/;

interface LineCtx {
	paraStart: number;
	text: string;
}

function lineCtx(state: Parameters<Command>[0]): LineCtx {
	const $head = state.selection.$head;
	return { paraStart: $head.start(), text: $head.parent.textContent };
}

const enter: Command = (state, dispatch) => {
	const { paraStart, text } = lineCtx(state);
	const m = text.match(LIST_RE);
	if (!m) return false; // not a list line → default newline

	const prefixLen = m[0].length;
	const content = text.slice(prefixLen);

	// Double-Enter on an empty item clears the list formatting.
	if (content.trim() === '') {
		if (dispatch) {
			const tr = state.tr.delete(paraStart, paraStart + prefixLen);
			tr.setSelection(TextSelection.create(tr.doc, paraStart));
			dispatch(tr.scrollIntoView());
		}
		return true;
	}

	// Otherwise continue the list with the same indent + (incremented) marker.
	const indent = m[1];
	const spacing = m[4];
	const marker = m[3] ? `${Number(m[3]) + 1}.` : m[2];
	const newPrefix = `${indent}${marker}${spacing}`;

	if (dispatch) {
		const pos = state.selection.$head.pos;
		const tr = state.tr;
		if (!state.selection.empty) tr.deleteSelection();
		tr.split(tr.mapping.map(pos));
		const insertPos = tr.mapping.map(pos);
		tr.insertText(newPrefix, insertPos);
		tr.setSelection(TextSelection.create(tr.doc, insertPos + newPrefix.length));
		dispatch(tr.scrollIntoView());
	}
	return true;
};

const sink: Command = (state, dispatch) => {
	const { paraStart, text } = lineCtx(state);
	if (dispatch) {
		const tr = state.tr.insertText('  ', paraStart);
		dispatch(tr.scrollIntoView());
	}
	// Return true regardless so Tab never escapes the editor (even on non-list
	// lines, where it acts as a two-space indent).
	void text;
	return true;
};

const lift: Command = (state, dispatch) => {
	const { paraStart, text } = lineCtx(state);
	let remove = 0;
	if (text.startsWith('\t')) remove = 1;
	else if (text.startsWith('  ')) remove = 2;
	else if (text.startsWith(' ')) remove = 1;
	if (remove > 0 && dispatch) {
		const tr = state.tr.delete(paraStart, paraStart + remove);
		dispatch(tr.scrollIntoView());
	}
	return true;
};

export const ListBehavior = Extension.create({
	name: 'listBehavior',

	addKeyboardShortcuts() {
		const cmd = (c: Command) => () => c(this.editor.state, this.editor.view.dispatch);
		return {
			Enter: cmd(enter),
			Tab: cmd(sink),
			'Shift-Tab': cmd(lift)
		};
	}
});
