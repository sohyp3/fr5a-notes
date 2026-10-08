import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Command, EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { Mapping } from '@tiptap/pm/transform';
import { docLines } from './blocks';
import { findImages } from './images';
import { findTables } from './tables';
import {
	applyRange,
	coveredRanges,
	findHighlights,
	highlightComment,
	isCovered,
	isHighlightComment,
	lineSpan,
	normalizeRanges,
	type Highlight,
	type Ranges
} from './highlights';

/**
 * Editing highlights (see highlights.ts; only loaded while Settings → Editor →
 * Highlights is on):
 *
 *   Mod+Shift+H   highlight the selection — or clear it when it's all
 *                 highlighted; with no selection, the whole line
 *   typing        a highlighted stretch keeps to its text: the comment's
 *                 offsets follow edits made earlier in the line
 *   Backspace /   joining a line across a (hidden) highlight comment joins it
 *   Delete        to the text line beyond, the highlight moving along —
 *                 rather than pulling the text into the comment
 */

const key = new PluginKey('highlightBehavior');

function byTarget(all: Highlight[]): Map<number, Highlight[]> {
	const out = new Map<number, Highlight[]>();
	for (const h of all) out.set(h.target, [...(out.get(h.target) ?? []), h]);
	return out;
}

function paragraph(doc: PMNode, text: string): PMNode {
	const { schema } = doc.type;
	return schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
}

/**
 * Give line `target` the highlight `ranges` (undefined = none): its old
 * comments go and one comment goes right above it. Positions (of `doc`) are
 * mapped through `tr`, so one transaction can rewrite several lines.
 */
function rewrite(
	tr: Transaction,
	doc: PMNode,
	starts: number[],
	target: number,
	old: Highlight[],
	ranges: Ranges | undefined
): void {
	for (const h of old) {
		const at = starts[h.comment];
		tr.delete(tr.mapping.map(at), tr.mapping.map(at + doc.child(h.comment).nodeSize));
	}
	if (ranges !== undefined)
		tr.insert(tr.mapping.map(starts[target], -1), paragraph(doc, highlightComment(ranges)));
}

/** Highlight the selection, or clear it when it's all highlighted; no selection: the whole line. */
export const toggleHighlight: Command = (state, dispatch) => {
	const { lines, starts } = docLines(state);
	const all = findHighlights(lines);
	const targets = byTarget(all);
	// Lines that show as something else (tables, pictures) can't be highlighted.
	const skip = new Set([...all.map((h) => h.comment), ...findTables(lines).keys()]);
	for (const [i, img] of findImages(lines)) skip.add(i).add(img.sizeLine ?? i);
	const { $from, $to, empty } = state.selection;
	const first = $from.index(0);
	const last = $to.index(0);
	const parts: { line: number; from: number; to: number; covered: [number, number][] }[] = [];
	for (let i = first; i <= last; i++) {
		if (skip.has(i) || isHighlightComment(lines[i])) continue;
		const text = lines[i];
		const [s, e] = lineSpan(text);
		// Never the block prefix (`- `, `# `) or trailing spaces.
		const from = empty ? s : Math.max(s, i === first ? $from.parentOffset : 0);
		const to = empty ? e : Math.min(e, i === last ? $to.parentOffset : text.length);
		if (to <= from) continue;
		const covered = coveredRanges(
			text,
			(targets.get(i) ?? []).map((h) => h.ranges)
		);
		parts.push({ line: i, from, to, covered });
	}
	if (!parts.length) return false;
	const on = !parts.every((p) => isCovered(p.covered, p.from, p.to));
	if (dispatch) {
		const tr = state.tr;
		for (const p of parts) {
			const next = applyRange(lines[p.line], p.covered, p.from, p.to, on);
			rewrite(tr, state.doc, starts, p.line, targets.get(p.line) ?? [], next);
		}
		dispatch(tr.setMeta(key, true).scrollIntoView());
	}
	return true;
};

/**
 * Join text lines `p` and `n` (only highlight comments between them) into
 * one, keeping both lines' highlights as offsets in the joined line.
 */
function join(view: EditorView, p: number, n: number): boolean {
	const { state } = view;
	const { lines, starts } = docLines(state);
	const targets = byTarget(findHighlights(lines));
	const mine = [...(targets.get(p) ?? []), ...(targets.get(n) ?? [])];
	const len = lines[p].length;
	const text = lines[p] + lines[n];
	const ranges = normalizeRanges(
		[
			...coveredRanges(
				lines[p],
				(targets.get(p) ?? []).map((h) => h.ranges)
			),
			...coveredRanges(
				lines[n],
				(targets.get(n) ?? []).map((h) => h.ranges)
			).map(([a, b]): [number, number] => [a + len, b + len])
		],
		text.length
	);
	const span = lineSpan(text);
	const whole = ranges.length === 1 && ranges[0][0] <= span[0] && ranges[0][1] >= span[1];
	const top = Math.min(p, ...mine.map((h) => h.comment));
	const bottom = Math.max(n, ...mine.map((h) => h.comment));
	const nodes = [
		...(ranges.length ? [paragraph(state.doc, highlightComment(whole ? null : ranges))] : []),
		paragraph(state.doc, text)
	];
	const from = starts[top];
	const to = starts[bottom] + state.doc.child(bottom).nodeSize;
	const tr = state.tr.replaceWith(from, to, nodes);
	const caret = from + (nodes.length === 2 ? nodes[0].nodeSize : 0) + 1 + len;
	view.dispatch(
		tr.setSelection(TextSelection.create(tr.doc, caret)).setMeta(key, true).scrollIntoView()
	);
	return true;
}

/** Backspace at a line's start / Delete at its end, with a highlight comment in between. */
function joinAcross(view: EditorView, back: boolean): boolean {
	const { $head, empty } = view.state.selection;
	if (!empty || $head.depth !== 1) return false;
	if ($head.parentOffset !== (back ? 0 : $head.parent.content.size)) return false;
	const { lines } = docLines(view.state);
	const i = $head.index(0);
	const step = back ? -1 : 1;
	let j = i + step;
	if (j < 0 || j >= lines.length || !isHighlightComment(lines[j])) return false;
	while (j >= 0 && j < lines.length && isHighlightComment(lines[j])) j += step;
	// Only comments beyond: nothing to join with (and nothing to pull into them).
	if (j < 0 || j >= lines.length) return true;
	return back ? join(view, j, i) : join(view, i, j);
}

function sameRanges(a: [number, number][], b: [number, number][]): boolean {
	return a.length === b.length && a.every(([x, y], k) => x === b[k][0] && y === b[k][1]);
}

/**
 * After an edit to a line with ranged highlights, move the offsets with its
 * text (positions mapped through the edit). Left alone when the comment
 * itself was edited.
 */
function followEdits(
	trs: readonly Transaction[],
	oldState: EditorState,
	newState: EditorState
): Transaction | null {
	if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta(key))) return null;
	const old = docLines(oldState);
	const ranged = findHighlights(old.lines).filter((h) => h.ranges);
	if (!ranged.length) return null;
	const mapping = new Mapping();
	for (const tr of trs) mapping.appendMapping(tr.mapping);
	const cur = docLines(newState);
	const now = new Map(findHighlights(cur.lines).map((h) => [h.comment, h]));
	const tr = newState.tr;
	for (const h of ranged) {
		const at = mapping.mapResult(old.starts[h.comment] + 1, 1);
		if (at.deleted) continue;
		const c = newState.doc.resolve(at.pos).index(0);
		const nh = now.get(c);
		if (!nh?.ranges || cur.lines[c] !== old.lines[h.comment]) continue;
		if (cur.lines[nh.target] === old.lines[h.target]) continue;
		const base = old.starts[h.target] + 1;
		const into = cur.starts[nh.target] + 1;
		const moved = normalizeRanges(
			h.ranges!.map(([a, b]): [number, number] => [
				mapping.map(base + a, 1) - into,
				mapping.map(base + b, -1) - into
			]),
			cur.lines[nh.target].length
		);
		if (sameRanges(moved, nh.ranges)) continue;
		const from = tr.mapping.map(cur.starts[c]);
		const to = tr.mapping.map(cur.starts[c] + newState.doc.child(c).nodeSize);
		if (moved.length) tr.replaceWith(from, to, paragraph(newState.doc, highlightComment(moved)));
		else tr.delete(from, to);
	}
	return tr.docChanged ? tr.setMeta(key, true) : null;
}

/** Offsets follow edits; Backspace / Delete join across hidden comments. */
export function highlightPlugin(): Plugin {
	return new Plugin({
		key,
		appendTransaction: followEdits,
		props: {
			handleKeyDown(view, e) {
				if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return false;
				if (e.key === 'Backspace') return joinAcross(view, true);
				if (e.key === 'Delete') return joinAcross(view, false);
				return false;
			}
		}
	});
}

export const HighlightBehavior = Extension.create({
	name: 'highlightBehavior',
	// Ahead of the core keymap's Backspace / Delete joins.
	priority: 150,

	addKeyboardShortcuts() {
		return {
			'Mod-Shift-h': () => toggleHighlight(this.editor.state, this.editor.view.dispatch)
		};
	},

	addProseMirrorPlugins() {
		return [highlightPlugin()];
	}
});
