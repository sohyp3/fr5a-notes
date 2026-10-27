import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Command, Transaction } from '@tiptap/pm/state';
import { TASK_RE, toggleCheck, toggleTask } from './tasks';

/**
 * Intelligent list handling for the raw-Markdown editor.
 *
 * The document stores literal Markdown (one line per paragraph), so there are no
 * ProseMirror `listItem` nodes to sink/lift. Instead we operate on the text:
 *
 *   Tab        → sink   (indent the list line by two spaces)
 *   Shift-Tab  → lift   (outdent by up to two spaces)
 *   Enter      → continue the bullet / number / to-do (unchecked) on the
 *                next line; a second Enter on an empty item clears the list
 *                formatting.
 *   Backspace  → at the start of a to-do's text, drop its box (a bullet stays).
 *   Mod-Enter  → check / uncheck the line's to-do; Mod-Shift-T makes lines
 *                to-dos (`tasks.ts`).
 *
 * These are the exact behaviours `sinkListItem` / `liftListItem` would give in a
 * node-based editor, adapted to our text model.
 */

export const LIST_RE = /^(\s*)([-*+]|(\d+)\.)(\s+)/;

interface LineCtx {
	paraStart: number;
	text: string;
}

function lineCtx(state: Parameters<Command>[0]): LineCtx {
	const $head = state.selection.$head;
	return { paraStart: $head.start(), text: $head.parent.textContent };
}

const indentWidth = (spaces: string) => spaces.replace(/\t/g, '  ').length;

/** The following lines owned by this item, up to its next sibling or prose. */
function descendants(state: Parameters<Command>[0], start: number, level: number) {
	const children: { start: number; raw: string; end: number }[] = [];
	let past = false;
	state.doc.forEach((node, offset) => {
		if (offset + 1 <= start || past) return;
		const line = node.textContent;
		const raw = /^\s*/.exec(line)![0];
		if (!line.trim() || indentWidth(raw) <= level) {
			past = true;
			return;
		}
		children.push({ start: offset + 1, raw, end: offset + node.nodeSize });
	});
	return children;
}

function moveChildren(tr: Transaction, children: ReturnType<typeof descendants>, by: number): void {
	for (const child of [...children].reverse()) {
		const target = ' '.repeat(Math.max(0, indentWidth(child.raw) + by));
		tr.insertText(target, child.start, child.start + child.raw.length);
	}
}

/** The next number at this level in the contiguous Markdown list. Deeper items
 * do not count; prose ends the list. Bullets/tasks at this level do not supply
 * an ordinal, but may sit between numbered siblings. */
function numberAtLevel(state: Parameters<Command>[0], start: number, indent: number): number {
	let previous: number | null = null;
	state.doc.forEach((node, offset) => {
		if (offset + 1 >= start || !node.isTextblock) return;
		const text = node.textContent;
		const item = LIST_RE.exec(text);
		if (!item) {
			// An indented continuation belongs to the preceding item, not a new
			// paragraph ending the ordered sequence.
			if (text.trim() && (!indent || indentWidth(/^\s*/.exec(text)![0]) < indent)) previous = null;
			return;
		}
		const level = indentWidth(item[1]);
		if (level < indent) previous = null;
		else if (level === indent && item[3]) previous = Number(item[3]);
	});
	return (previous ?? 0) + 1;
}

export const enter: Command = (state, dispatch) => {
	const { paraStart, text } = lineCtx(state);
	const task = text.match(TASK_RE);
	const m = task ?? text.match(LIST_RE);
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

	// Otherwise continue the list with the same indent + (incremented) marker;
	// a to-do continues unchecked.
	const newPrefix = task
		? `${task[1]}${task[2]}${task[3]}[ ]${task[5] || ' '}`
		: `${m[1]}${m[3] ? `${Number(m[3]) + 1}.` : m[2]}${m[4]}`;

	if (dispatch) {
		const pos = state.selection.$head.pos;
		const tr = state.tr;
		const atEnd = state.selection.empty && state.selection.$head.parentOffset === text.length;
		const children = atEnd ? descendants(state, paraStart, indentWidth(m[1])) : [];
		let insertPos: number;
		if (children.length) {
			// Enter at the end of a parent continues after its subtree instead of
			// inserting a new parent between it and its existing children.
			const after = children[children.length - 1].end;
			const paragraph = state.selection.$head.parent.type.create(
				null,
				state.schema.text(newPrefix)
			);
			tr.insert(after, paragraph);
			insertPos = after + 1;
		} else {
			if (!state.selection.empty) tr.deleteSelection();
			tr.split(tr.mapping.map(pos));
			insertPos = tr.mapping.map(pos);
			tr.insertText(newPrefix, insertPos);
		}
		// If Enter was pressed at the end just before an already numbered sibling,
		// avoid two identical ordinals. Only advance a contiguous, matching run;
		// custom numbers and unrelated Markdown are left untouched.
		if (!task && m[3] && atEnd) {
			const after = children.length
				? children[children.length - 1].end
				: paraStart + text.length + 1;
			let expected = Number(m[3]) + 1;
			let running = true;
			state.doc.forEach((node, offset) => {
				if (offset < after || !running) return;
				const next = LIST_RE.exec(node.textContent);
				if (!next || next[1] !== m[1] || Number(next[3]) !== expected) {
					running = false;
					return;
				}
				const start = offset + 1 + next[1].length;
				tr.insertText(
					`${expected + 1}.`,
					tr.mapping.map(start),
					tr.mapping.map(start + next[2].length)
				);
				expected++;
			});
		}
		tr.setSelection(TextSelection.create(tr.doc, insertPos + newPrefix.length));
		dispatch(tr.scrollIntoView());
	}
	return true;
};

/** At the start of a to-do's text, Backspace drops the box: `- [ ] a` → `- a`. */
const backspace: Command = (state, dispatch) => {
	const { empty, $head } = state.selection;
	if (!empty) return false;
	const task = $head.parent.textContent.match(TASK_RE);
	if (!task || $head.parentOffset !== task[0].length) return false;
	if (dispatch) {
		const box = $head.start() + task[1].length + task[2].length + task[3].length;
		dispatch(state.tr.delete(box, $head.pos).scrollIntoView());
	}
	return true;
};

export const sink: Command = (state, dispatch) => {
	const { paraStart, text } = lineCtx(state);
	if (dispatch) {
		const item = LIST_RE.exec(text);
		const indent = item ? indentWidth(item[1]) + 2 : 0;
		const prefix = item?.[3] ? `${item[1]}  ${numberAtLevel(state, paraStart, indent)}.` : null;
		const tr = state.tr;
		if (item) moveChildren(tr, descendants(state, paraStart, indent - 2), 2);
		if (prefix) tr.insertText(prefix, paraStart, paraStart + item![1].length + item![2].length);
		else tr.insertText('  ', paraStart);
		dispatch(tr.scrollIntoView());
	}
	// Return true regardless so Tab never escapes the editor (even on non-list
	// lines, where it acts as a two-space indent).
	return true;
};

export const lift: Command = (state, dispatch) => {
	const { paraStart, text } = lineCtx(state);
	const item = LIST_RE.exec(text);
	const rawIndent = item?.[1] ?? /^\s*/.exec(text)![0];
	let remove = 0;
	if (text.startsWith('\t')) remove = 1;
	else if (text.startsWith('  ')) remove = 2;
	else if (text.startsWith(' ')) remove = 1;
	if (remove > 0 && dispatch) {
		const indent = indentWidth(rawIndent);
		const nextIndent = ' '.repeat(Math.max(0, indent - 2));
		const tr = state.tr;
		if (item) {
			// Move a parent's descendants with it. Stop at the first sibling or
			// unrelated paragraph; edit from the bottom to keep original positions.
			const children = descendants(state, paraStart, indent);
			moveChildren(tr, children, nextIndent.length - indent);
			// Former siblings become children of the lifted item. Restart only a
			// matching numbered run at one; leave deliberate custom ordinals alone.
			if (item[3]) {
				let expected = Number(item[3]) + 1;
				let replacement = 1;
				const after = children.length
					? children[children.length - 1].end
					: paraStart + text.length + 1;
				let running = true;
				state.doc.forEach((node, offset) => {
					if (offset < after || !running) return;
					const line = node.textContent;
					const next = LIST_RE.exec(line);
					const leading = next?.[1] ?? /^\s*/.exec(line)![0];
					const level = indentWidth(leading);
					if (!line.trim() || level <= nextIndent.length) {
						running = false;
						return;
					}
					if (level > indent) return; // descendants of the following sibling
					if (!next || !next[3] || Number(next[3]) !== expected) {
						running = false;
						return;
					}
					const start = offset + 1 + next[1].length;
					tr.insertText(
						`${replacement}.`,
						tr.mapping.map(start),
						tr.mapping.map(start + next[2].length)
					);
					expected++;
					replacement++;
				});
			}
			const marker = item[3] ? `${numberAtLevel(state, paraStart, nextIndent.length)}.` : item[2];
			tr.insertText(
				`${nextIndent}${marker}`,
				paraStart,
				paraStart + item[1].length + item[2].length
			);
		} else {
			tr.delete(paraStart, paraStart + remove);
		}
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
			Backspace: cmd(backspace),
			'Mod-Enter': cmd(toggleCheck),
			'Mod-Shift-t': cmd(toggleTask),
			Tab: cmd(sink),
			'Shift-Tab': cmd(lift)
		};
	}
});
