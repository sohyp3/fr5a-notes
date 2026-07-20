import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Command } from '@tiptap/pm/state';

/**
 * Markdown keyboard shortcuts. Because the document is *raw Markdown text*
 * (no ProseMirror marks), "bold" means literally wrapping the selection in
 * `**…**`. Bindings use TipTap's `Mod-` prefix, which resolves to ⌘ on macOS
 * and Ctrl on Linux/Windows automatically.
 */

function wrap(marker: string): Command {
	return (state, dispatch) => {
		const { from, to, empty } = state.selection;
		const tr = state.tr;
		if (empty) {
			tr.insertText(marker + marker, from);
			const caret = from + marker.length;
			tr.setSelection(TextSelection.create(tr.doc, caret));
		} else {
			// Insert the closing marker first so `from` stays valid.
			tr.insertText(marker, to);
			tr.insertText(marker, from);
			// Keep the inner text selected.
			tr.setSelection(TextSelection.create(tr.doc, from + marker.length, to + marker.length));
		}
		if (dispatch) dispatch(tr.scrollIntoView());
		return true;
	};
}

export const MarkdownShortcuts = Extension.create({
	name: 'markdownShortcuts',

	addKeyboardShortcuts() {
		const run = (marker: string) => () =>
			this.editor.view.dispatch
				? (wrap(marker)(this.editor.state, this.editor.view.dispatch), true)
				: false;
		return {
			'Mod-b': run('**'),
			'Mod-i': run('*'),
			'Mod-e': run('`'),
			'Mod-Shift-x': run('~~')
		};
	}
});
