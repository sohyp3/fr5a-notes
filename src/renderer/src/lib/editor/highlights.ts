import { codeLines } from './blocks';

/**
 * Highlights (Settings → Editor). A comment on its own line marks the line
 * next to it, so the Markdown stays clean everywhere else:
 *
 *   <!-- highlight -->                the whole line, yellow
 *   <!-- highlight: green -->         the whole line, green
 *   <!-- highlight: 4-12 -->          characters 4 to 12 (`text.slice(4, 12)`)
 *   <!-- highlight: 0-3, pink 9-14 -->  several stretches, each its own color
 *
 * A stretch without a color is yellow (what older notes have). The comment
 * goes above the line it marks (what the editor writes); below works too when
 * no text follows it, since a comment between two lines of text marks the one
 * below. HighlightBehavior keeps the offsets on their text while the line is
 * edited. Pure.
 */

/** Highlighter colors, in picker order. The first is the default, written without a name. */
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
const DEFAULT: HighlightColor = HIGHLIGHT_COLORS[0];

export function isHighlightColor(name: unknown): name is HighlightColor {
	return HIGHLIGHT_COLORS.includes(name as HighlightColor);
}

/** A highlighted stretch of a line: [from, to) offsets and its color. */
export type Stretch = [number, number, HighlightColor];

/** A line's highlight: its stretches, or (a color) the whole line. */
export type Ranges = Stretch[] | HighlightColor;

export interface Highlight {
	/** Line of the comment. */
	comment: number;
	/** Line it marks. */
	target: number;
	ranges: Ranges;
}

const NAMES = HIGHLIGHT_COLORS.join('|');
const ITEM = `(?:(?:${NAMES})\\s+)?\\d+\\s*-\\s*\\d+`;
const HL_RE = new RegExp(
	`^\\s*<!--\\s*highlight\\s*(?::\\s*(${NAMES}|${ITEM}(?:\\s*,\\s*${ITEM})*)\\s*)?-->\\s*$`,
	'i'
);
const ITEM_RE = /^(?:([a-z]+)\s+)?(\d+)\s*-\s*(\d+)$/i;
const COMMENT_RE = /^\s*<!--.*-->\s*$/;
/** Block prefix a whole-line highlight leaves out: indent, `#`, `>`, list markers. */
const PREFIX_RE = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/;

const color = (name: string | undefined): HighlightColor =>
	name ? (name.toLowerCase() as HighlightColor) : DEFAULT;

export function parseHighlight(line: string): { ranges: Ranges } | null {
	const m = HL_RE.exec(line);
	if (!m) return null;
	if (!m[1]) return { ranges: DEFAULT };
	if (!/\d/.test(m[1])) return { ranges: color(m[1]) };
	return {
		ranges: m[1].split(',').map((part) => {
			const [, name, a, b] = ITEM_RE.exec(part.trim())!;
			return [Number(a), Number(b), color(name)] as Stretch;
		})
	};
}

export function isHighlightComment(line: string): boolean {
	return HL_RE.test(line);
}

export function highlightComment(ranges: Ranges): string {
	if (typeof ranges === 'string')
		return ranges === DEFAULT ? '<!-- highlight -->' : `<!-- highlight: ${ranges} -->`;
	const items = ranges.map(([a, b, c]) => `${c === DEFAULT ? '' : `${c} `}${a}-${b}`);
	return `<!-- highlight: ${items.join(', ')} -->`;
}

/** Every highlight comment (outside fenced code) and the line it marks. */
export function findHighlights(lines: string[]): Highlight[] {
	const code = codeLines(lines);
	const text = (j: number) =>
		j >= 0 && j < lines.length && !code[j] && !!lines[j].trim() && !COMMENT_RE.test(lines[j]);
	const out: Highlight[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (code[i]) continue;
		const h = parseHighlight(lines[i]);
		if (!h) continue;
		const target = text(i + 1) ? i + 1 : text(i - 1) ? i - 1 : -1;
		if (target !== -1) out.push({ comment: i, target, ranges: h.ranges });
	}
	return out;
}

/** The part of a line a whole-line highlight covers: after its block prefix, before trailing space. */
export function lineSpan(text: string): [number, number] {
	const from = PREFIX_RE.exec(text)?.[0].length ?? 0;
	return [from, Math.max(from, text.trimEnd().length)];
}

/** `ranges` with `from`–`to` cut out. */
function subtract(ranges: Stretch[], from: number, to: number): Stretch[] {
	const out: Stretch[] = [];
	for (const [a, b, c] of ranges) {
		if (b <= from || a >= to) out.push([a, b, c]);
		else {
			if (a < from) out.push([a, from, c]);
			if (b > to) out.push([to, b, c]);
		}
	}
	return out;
}

/**
 * Clipped to the line, empty stretches dropped, sorted; where stretches
 * overlap the later one wins, and touching ones of one color merge.
 */
export function normalizeRanges(ranges: Stretch[], len: number): Stretch[] {
	let painted: Stretch[] = [];
	for (const [x, y, c] of ranges) {
		const a = Math.max(0, Math.min(x, y, len));
		const b = Math.min(len, Math.max(x, y, 0));
		if (b > a) painted = [...subtract(painted, a, b), [a, b, c]];
	}
	painted.sort((p, q) => p[0] - q[0]);
	const out: Stretch[] = [];
	for (const [a, b, c] of painted) {
		const last = out[out.length - 1];
		if (last && last[2] === c && a <= last[1]) last[1] = Math.max(last[1], b);
		else out.push([a, b, c]);
	}
	return out;
}

/** The stretches a line's highlights cover (whole-line ones resolved), in order. */
export function coveredRanges(text: string, all: Ranges[]): Stretch[] {
	const [from, to] = lineSpan(text);
	return normalizeRanges(
		all.flatMap((r): Stretch[] => (typeof r === 'string' ? [[from, to, r]] : r)),
		text.length
	);
}

/**
 * True when `from`–`to` lies entirely inside the highlighted stretches (all
 * of them `color`, when given).
 */
export function isCovered(
	ranges: Stretch[],
	from: number,
	to: number,
	color?: HighlightColor
): boolean {
	let at = from;
	for (const [a, b, c] of ranges) {
		if (b <= at) continue;
		if (a > at || (color && c !== color)) return false;
		at = b;
		if (at >= to) return true;
	}
	return at >= to;
}

/** True when any of `from`–`to` is highlighted. */
export function touches(ranges: Stretch[], from: number, to: number): boolean {
	return ranges.some(([a, b]) => a < to && b > from);
}

/**
 * A line's highlight after painting `from`–`to` in `color` (null: clearing
 * it): a color for the whole line, undefined when nothing is left.
 */
export function applyRange(
	text: string,
	current: Stretch[],
	from: number,
	to: number,
	color: HighlightColor | null
): Ranges | undefined {
	const span = lineSpan(text);
	const next = normalizeRanges(
		color ? [...current, [from, to, color]] : subtract(current, from, to),
		text.length
	);
	if (!next.length) return undefined;
	// One color over all of the line's text: say so, rather than as offsets.
	if (next.length === 1 && next[0][0] <= span[0] && next[0][1] >= span[1]) return next[0][2];
	return next;
}
