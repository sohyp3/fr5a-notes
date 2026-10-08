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
	touches,
	type Highlight,
	type HighlightColor,
	type Ranges,
	type Stretch
} from './highlights';

/**
 * Editing highlights (see highlights.ts; only loaded while Settings → Editor →
 * Highlights is on):
 *
 *   Mod+Shift+H   highlight the selection in the color last picked — or
 *                 clear it when it's all highlighted; with no selection,
 *                 the whole line (the picker: `setHighlight`)
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

interface Part {
	line: number;
	from: number;
	to: number;
	/** What the line has highlighted now. */
	covered: Stretch[];
}

/** The selected stretch of each line in the selection; no selection: the caret's whole line. */
function selectedParts(state: EditorState): Part[] {
	const { lines } = docLines(state);
	const all = findHighlights(lines);
	const targets = byTarget(all);
	// Lines that show as something else (tables, pictures) can't be highlighted.
	const skip = new Set([...all.map((h) => h.comment), ...findTables(lines).keys()]);
	for (const [i, img] of findImages(lines)) skip.add(i).add(img.sizeLine ?? i);
	const { $from, $to, empty } = state.selection;
	const first = $from.index(0);
	const last = $to.index(0);
	const parts: Part[] = [];
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
	return parts;
}

/** Paint every part in `color` (null: clear them), in one transaction. */
function paint(state: EditorState, parts: Part[], color: HighlightColor | null): Transaction {
	const { lines, starts } = docLines(state);
	const targets = byTarget(findHighlights(lines));
	const tr = state.tr;
	for (const p of parts) {
		const next = applyRange(lines[p.line], p.covered, p.from, p.to, color);
		rewrite(tr, state.doc, starts, p.line, targets.get(p.line) ?? [], next);
	}
	return tr.setMeta(key, true).scrollIntoView();
}

/** Highlight the selection in `color`, or (null) clear it; no selection: the whole line. */
export function setHighlight(color: HighlightColor | null): Command {
	return (state, dispatch) => {
		const parts = selectedParts(state);
		if (!parts.length) return false;
		dispatch?.(paint(state, parts, color));
		return true;
	};
}

/** Highlight the selection in `color`, or clear it when it's all highlighted (any color). */
export function toggleHighlight(color: HighlightColor): Command {
	return (state, dispatch) => {
		const parts = selectedParts(state);
		if (!parts.length) return false;
		const all = parts.every((p) => isCovered(p.covered, p.from, p.to));
		dispatch?.(paint(state, parts, all ? null : color));
		return true;
	};
}

/**
 * The selection's highlight, for the picker: the color all of it is
 * highlighted in (null: none, or mixed), whether any of it is highlighted,
 * and whether it can be highlighted at all.
 */
export function highlightAt(state: EditorState): {
	color: HighlightColor | null;
	any: boolean;
	can: boolean;
} {
	const parts = selectedParts(state);
	const colors = new Set(parts.map((p) => p.covered.find(([a, b]) => a < p.to && b > p.from)?.[2]));
	const [only] = colors;
	const one =
		colors.size === 1 && only && parts.every((p) => isCovered(p.covered, p.from, p.to, only));
	return {
		color: one ? only : null,
		any: parts.some((p) => touches(p.covered, p.from, p.to)),
		can: parts.length > 0
	};
}

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
			).map(([a, b, c]): Stretch => [a + len, b + len, c])
		],
		text.length
	);
	const span = lineSpan(text);
	const whole = ranges.length === 1 && ranges[0][0] <= span[0] && ranges[0][1] >= span[1];
	const top = Math.min(p, ...mine.map((h) => h.comment));
	const bottom = Math.max(n, ...mine.map((h) => h.comment));
	const nodes = [
		...(ranges.length
			? [paragraph(state.doc, highlightComment(whole ? ranges[0][2] : ranges))]
			: []),
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

function sameRanges(a: Stretch[], b: Stretch[]): boolean {
	return a.length === b.length && a.every((s, k) => s.every((v, j) => v === b[k][j]));
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
	const ranged = findHighlights(old.lines).filter((h) => typeof h.ranges !== 'string');
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
		if (!nh || typeof nh.ranges === 'string' || cur.lines[c] !== old.lines[h.comment]) continue;
		if (cur.lines[nh.target] === old.lines[h.target]) continue;
		const base = old.starts[h.target] + 1;
		const into = cur.starts[nh.target] + 1;
		const moved = normalizeRanges(
			(h.ranges as Stretch[]).map(([a, b, color]): Stretch => [
				mapping.map(base + a, 1) - into,
				mapping.map(base + b, -1) - into,
				color
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

export interface HighlightBehaviorOptions {
	/** The color Mod+Shift+H paints: the one last picked. */
	color: () => HighlightColor;
}

export const HighlightBehavior = Extension.create<HighlightBehaviorOptions>({
	name: 'highlightBehavior',
	// Ahead of the core keymap's Backspace / Delete joins.
	priority: 150,

	addOptions() {
		return { color: () => 'yellow' };
	},

	addKeyboardShortcuts() {
		return {
			'Mod-Shift-h': () =>
				toggleHighlight(this.options.color())(this.editor.state, this.editor.view.dispatch)
		};
	},

	addProseMirrorPlugins() {
		return [highlightPlugin()];
	}
});
