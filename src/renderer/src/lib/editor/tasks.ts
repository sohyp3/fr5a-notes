import type { Command, EditorState, Transaction } from '@tiptap/pm/state';
import { LIST_RE } from './ListBehavior';

/**
 * To-dos: a bullet line whose text starts with a box, `- [ ] buy milk` /
 * `- [x] done`. `MarkdownSyntax` draws a checkbox in place of `- [ ] ` and
 * strikes a checked line through; these edit the raw text, like every other
 * list command.
 */

/** indent, bullet, spacing, the box's mark (` ` / `x` / `X`), spacing after it. */
export const TASK_RE = /^(\s*)([-*+])(\s+)\[([ xX])\](\s+|$)/;

/** A to-do line's box: where its mark sits (an offset into the line) and whether it's checked. */
export function taskBox(text: string): { mark: number; done: boolean; prefixLen: number } | null {
	const m = TASK_RE.exec(text);
	if (!m) return null;
	return {
		mark: m[1].length + m[2].length + m[3].length + 1,
		done: m[4] !== ' ',
		prefixLen: m[0].length
	};
}

/** Check or uncheck the to-do on the line holding `pos`; null when it isn't one. */
export function toggleCheckAt(state: EditorState, pos: number): Transaction | null {
	const $pos = state.doc.resolve(pos);
	if (!$pos.parent.isTextblock) return null;
	const box = taskBox($pos.parent.textContent);
	if (!box) return null;
	const at = $pos.start() + box.mark;
	return state.tr.insertText(box.done ? ' ' : 'x', at, at + 1);
}

/** Mod+Enter: check / uncheck the caret line's to-do. */
export const toggleCheck: Command = (state, dispatch) => {
	const tr = toggleCheckAt(state, state.selection.head);
	if (!tr) return false;
	dispatch?.(tr.scrollIntoView());
	return true;
};

/**
 * Make the selected lines to-dos (a bullet gains a box, a numbered or plain
 * line becomes `- [ ] `), or plain lines again when they all are already.
 */
export const toggleTask: Command = (state, dispatch) => {
	const { from, to } = state.selection;
	const lines: { start: number; text: string }[] = [];
	state.doc.nodesBetween(from, to, (node, pos) => {
		if (node.isTextblock) lines.push({ start: pos + 1, text: node.textContent });
		return !node.isTextblock;
	});
	if (!lines.length) return false;
	const allTasks = lines.every((l) => TASK_RE.test(l.text));
	if (dispatch) {
		const tr = state.tr;
		for (const { start, text } of lines) {
			const at = (offset: number) => tr.mapping.map(start + offset);
			const task = TASK_RE.exec(text);
			if (allTasks && task) {
				tr.delete(at(task[1].length), at(task[0].length));
			} else if (!task) {
				const list = LIST_RE.exec(text);
				if (list && !list[3]) tr.insertText('[ ] ', at(list[0].length));
				else if (list) tr.insertText('- [ ] ', at(list[1].length), at(list[0].length));
				else tr.insertText('- [ ] ', at(/^\s*/.exec(text)![0].length));
			}
		}
		dispatch(tr.scrollIntoView());
	}
	return true;
};
