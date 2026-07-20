import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { undo, redo } from '@tiptap/pm/history';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * A compact Vim mode for the raw-Markdown editor. There is no maintained
 * ProseMirror/TipTap Vim package, so this implements the essentials directly:
 *
 *   modes    normal · insert · visual
 *   motions  h j k l · w b e · 0 $ · gg G
 *   inserts  i a I A o O
 *   edits    x · dd dw d$ · yy · p · u · Ctrl-r
 *   visual   v + motions, then d / y / x
 *
 * "Lines" are paragraphs (the editor stores one Markdown line per paragraph).
 */

export type VimMode = 'normal' | 'insert' | 'visual';

interface VimPluginState {
	mode: VimMode;
	/** Pending operator, e.g. 'd' or 'g' waiting for a motion. */
	pending: string;
	/** Anchor position for visual mode. */
	anchor: number | null;
}

export const vimKey = new PluginKey<VimPluginState>('vim');

// A single module-level register (vim's unnamed register) for yank/delete/paste.
let register = '';
let registerLinewise = false;

const WORD = /[A-Za-z0-9_]/;

// --- line helpers -----------------------------------------------------------

interface Line {
	start: number;
	end: number;
	text: string;
}

function lines(doc: PMNode): Line[] {
	const out: Line[] = [];
	doc.forEach((node, offset) => {
		if (node.isTextblock)
			out.push({ start: offset + 1, end: offset + 1 + node.content.size, text: node.textContent });
	});
	return out;
}

function lineAt(ls: Line[], pos: number): { line: Line; index: number } {
	for (let i = 0; i < ls.length; i++) {
		if (pos >= ls[i].start && pos <= ls[i].end) return { line: ls[i], index: i };
	}
	const i = ls.length - 1;
	return { line: ls[i], index: i };
}

/** Clamp a caret so it rests on (not past) the last character in normal mode. */
function clampNormal(line: Line, pos: number): number {
	const max = Math.max(line.start, line.end - 1);
	return Math.min(Math.max(pos, line.start), Math.max(max, line.start));
}

// --- motions ----------------------------------------------------------------

function wordForward(text: string, col: number): number {
	const n = text.length;
	let i = col;
	if (i < n && WORD.test(text[i])) while (i < n && WORD.test(text[i])) i++;
	else while (i < n && !WORD.test(text[i]) && text[i] !== ' ') i++;
	while (i < n && text[i] === ' ') i++;
	return i;
}

function wordBackward(text: string, col: number): number {
	let i = col - 1;
	while (i > 0 && text[i] === ' ') i--;
	if (i > 0 && WORD.test(text[i])) while (i > 0 && WORD.test(text[i - 1])) i--;
	else while (i > 0 && !WORD.test(text[i - 1]) && text[i - 1] !== ' ') i--;
	return Math.max(0, i);
}

function wordEnd(text: string, col: number): number {
	const n = text.length;
	let i = col + 1;
	while (i < n && text[i] === ' ') i++;
	while (i < n - 1 && WORD.test(text[i + 1])) i++;
	return Math.min(n - 1 < 0 ? 0 : n - 1, i);
}

// --- state transitions ------------------------------------------------------

function setMode(tr: Transaction, mode: VimMode, anchor: number | null = null): Transaction {
	return tr.setMeta(vimKey, { mode, anchor });
}

function apply(view: EditorView, tr: Transaction): void {
	view.dispatch(tr.scrollIntoView());
	view.focus();
}

/** Move the caret (and, in visual mode, extend the selection to it). */
function moveTo(view: EditorView, pos: number, mode: VimMode, anchor: number | null): void {
	const { state } = view;
	const tr = state.tr;
	if (mode === 'visual' && anchor !== null) {
		tr.setSelection(TextSelection.create(state.doc, anchor, pos));
	} else {
		tr.setSelection(TextSelection.create(state.doc, pos));
	}
	apply(view, tr);
}

function deleteRange(view: EditorView, from: number, to: number, linewise: boolean): void {
	const text = view.state.doc.textBetween(from, to, '\n');
	register = text;
	registerLinewise = linewise;
	const tr = view.state.tr.delete(from, to);
	setMode(tr, 'normal');
	apply(view, tr);
}

function yankRange(view: EditorView, from: number, to: number, linewise: boolean): void {
	register = view.state.doc.textBetween(from, to, '\n');
	registerLinewise = linewise;
	const tr = setMode(view.state.tr, 'normal');
	// Collapse selection to the start of the yank (vim behaviour).
	tr.setSelection(TextSelection.create(tr.doc, Math.min(from, to)));
	apply(view, tr);
}

// --- the keymap -------------------------------------------------------------

function handleNormal(view: EditorView, event: KeyboardEvent, vs: VimPluginState): boolean {
	const key = event.key;
	const { state } = view;
	const ls = lines(state.doc);
	const head = state.selection.head;
	const { line, index } = lineAt(ls, head);
	const col = head - line.start;
	const visual = vs.mode === 'visual';

	// Operator pending (d / y / g).
	if (vs.pending) {
		const op = vs.pending;
		const clearPending = () => apply(view, view.state.tr.setMeta(vimKey, { pending: '' }));
		if (op === 'g') {
			if (key === 'g') {
				moveTo(view, ls[0].start, vs.mode, vs.anchor);
			}
			clearPending();
			return true;
		}
		if (op === 'd' || op === 'y') {
			const linewise = key === op; // dd / yy
			let from: number;
			let to: number;
			if (key === op) {
				// Whole line: join with a neighbouring newline so the line is removed.
				if (index === 0 && ls.length > 1) {
					from = line.start;
					to = ls[1].start - 1;
				} else {
					from = index > 0 ? ls[index - 1].end : line.start;
					to = line.end;
				}
			} else if (key === 'w') {
				to = line.start + wordForward(line.text, col);
				from = head;
			} else if (key === '$') {
				to = line.end;
				from = head;
			} else if (key === '0') {
				from = line.start;
				to = head;
			} else {
				clearPending();
				return true;
			}
			if (op === 'd') deleteRange(view, Math.min(from, to), Math.max(from, to), linewise);
			else yankRange(view, Math.min(from, to), Math.max(from, to), linewise);
			apply(view, view.state.tr.setMeta(vimKey, { pending: '' }));
			return true;
		}
	}

	switch (key) {
		case 'h':
			moveTo(view, clampNormal(line, head - 1), vs.mode, vs.anchor);
			return true;
		case 'l':
			moveTo(view, clampNormal(line, head + 1), vs.mode, vs.anchor);
			return true;
		case 'j': {
			const t = ls[Math.min(ls.length - 1, index + 1)];
			moveTo(view, clampNormal(t, t.start + col), vs.mode, vs.anchor);
			return true;
		}
		case 'k': {
			const t = ls[Math.max(0, index - 1)];
			moveTo(view, clampNormal(t, t.start + col), vs.mode, vs.anchor);
			return true;
		}
		case '0':
			moveTo(view, line.start, vs.mode, vs.anchor);
			return true;
		case '$':
			moveTo(view, visual ? line.end : clampNormal(line, line.end), vs.mode, vs.anchor);
			return true;
		case 'w':
			moveTo(view, clampNormal(line, line.start + wordForward(line.text, col)), vs.mode, vs.anchor);
			return true;
		case 'b':
			moveTo(view, line.start + wordBackward(line.text, col), vs.mode, vs.anchor);
			return true;
		case 'e':
			moveTo(view, clampNormal(line, line.start + wordEnd(line.text, col)), vs.mode, vs.anchor);
			return true;
		case 'G':
			moveTo(view, clampNormal(ls[ls.length - 1], ls[ls.length - 1].start), vs.mode, vs.anchor);
			return true;
		case 'g':
			apply(view, view.state.tr.setMeta(vimKey, { pending: 'g' }));
			return true;
		case 'd':
			if (visual) {
				deleteRange(view, state.selection.from, state.selection.to, false);
			} else {
				apply(view, view.state.tr.setMeta(vimKey, { pending: 'd' }));
			}
			return true;
		case 'y':
			if (visual) {
				yankRange(view, state.selection.from, state.selection.to, false);
			} else {
				apply(view, view.state.tr.setMeta(vimKey, { pending: 'y' }));
			}
			return true;
		case 'x': {
			if (visual) {
				deleteRange(view, state.selection.from, state.selection.to, false);
			} else if (head < line.end) {
				deleteRange(view, head, head + 1, false);
			}
			return true;
		}
		case 'p': {
			if (!register) return true;
			const tr = state.tr;
			if (registerLinewise) {
				const insertAt = line.end;
				tr.insertText('\n' + register, insertAt);
				tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
			} else {
				const at = Math.min(head + 1, line.end);
				tr.insertText(register, at);
				tr.setSelection(TextSelection.create(tr.doc, at + register.length - 1));
			}
			setMode(tr, 'normal');
			apply(view, tr);
			return true;
		}
		case 'u':
			undo(state, view.dispatch);
			return true;
		case 'i':
			apply(view, setMode(state.tr, 'insert'));
			return true;
		case 'a':
			apply(
				view,
				setMode(
					state.tr.setSelection(TextSelection.create(state.doc, Math.min(head + 1, line.end))),
					'insert'
				)
			);
			return true;
		case 'I':
			apply(
				view,
				setMode(state.tr.setSelection(TextSelection.create(state.doc, line.start)), 'insert')
			);
			return true;
		case 'A':
			apply(
				view,
				setMode(state.tr.setSelection(TextSelection.create(state.doc, line.end)), 'insert')
			);
			return true;
		case 'o': {
			const tr = state.tr.insert(line.end, state.schema.nodes.paragraph.create());
			tr.setSelection(TextSelection.create(tr.doc, line.end + 1));
			apply(view, setMode(tr, 'insert'));
			return true;
		}
		case 'O': {
			const tr = state.tr.insert(line.start - 1, state.schema.nodes.paragraph.create());
			tr.setSelection(TextSelection.create(tr.doc, line.start));
			apply(view, setMode(tr, 'insert'));
			return true;
		}
		case 'v':
			apply(view, setMode(state.tr, visual ? 'normal' : 'visual', visual ? null : head));
			return true;
		case 'Escape':
			apply(view, setMode(state.tr, 'normal'));
			return true;
		default:
			// swallow other printable keys in normal mode
			return key.length === 1 && !event.metaKey && !event.ctrlKey;
	}
}

export interface VimOptions {
	onModeChange?: (mode: VimMode) => void;
}

export const Vim = Extension.create<VimOptions>({
	name: 'vim',

	addOptions() {
		return { onModeChange: undefined };
	},

	addProseMirrorPlugins() {
		const options = this.options;
		let lastMode: VimMode = 'normal';

		return [
			new Plugin<VimPluginState>({
				key: vimKey,
				state: {
					init: () => ({ mode: 'normal', pending: '', anchor: null }),
					apply(tr, value) {
						const meta = tr.getMeta(vimKey) as Partial<VimPluginState> | undefined;
						if (meta) return { ...value, ...meta } as VimPluginState;
						return value;
					}
				},
				view() {
					return {
						update(view) {
							const mode = vimKey.getState(view.state)!.mode;
							if (mode !== lastMode) {
								lastMode = mode;
								options.onModeChange?.(mode);
							}
						}
					};
				},
				props: {
					attributes(state) {
						return { class: `vim-${vimKey.getState(state)!.mode}` };
					},
					handleKeyDown(view, event) {
						const vs = vimKey.getState(view.state)!;
						if (vs.mode === 'insert') {
							if (event.key === 'Escape') {
								const ls = lines(view.state.doc);
								const head = view.state.selection.head;
								const { line } = lineAt(ls, head);
								const tr = view.state.tr.setSelection(
									TextSelection.create(view.state.doc, clampNormal(line, head - 1))
								);
								apply(view, setMode(tr, 'normal'));
								return true;
							}
							return false; // normal editing in insert mode
						}
						// normal or visual
						if (event.ctrlKey && event.key === 'r') {
							redo(view.state, view.dispatch);
							event.preventDefault();
							return true;
						}
						const handled = handleNormal(view, event, vs);
						if (handled) event.preventDefault();
						return handled;
					},
					decorations(state: EditorState) {
						const vs = vimKey.getState(state)!;
						if (vs.mode === 'insert') return DecorationSet.empty;
						// Block cursor over the character to the right of the caret.
						const head = state.selection.head;
						const ls = lines(state.doc);
						const { line } = lineAt(ls, head);
						if (head < line.end) {
							return DecorationSet.create(state.doc, [
								Decoration.inline(head, head + 1, { class: 'vim-cursor' })
							]);
						}
						return DecorationSet.create(state.doc, [
							Decoration.widget(head, () => {
								const span = document.createElement('span');
								span.className = 'vim-cursor vim-cursor-eol';
								span.textContent = ' ';
								return span;
							})
						]);
					}
				}
			})
		];
	}
});
