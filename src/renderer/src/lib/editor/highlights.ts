import { codeLines } from './blocks';

/**
 * Highlights (Settings → Editor). A comment on its own line marks the line
 * next to it, so the Markdown stays clean everywhere else:
 *
 *   <!-- highlight -->              the whole line
 *   <!-- highlight: 4-12 -->        characters 4 to 12 (`text.slice(4, 12)`)
 *   <!-- highlight: 0-3, 9-14 -->   several stretches
 *
 * The comment goes above the line it marks (what the editor writes); below
 * works too when no text follows it, since a comment between two lines of
 * text marks the one below. HighlightBehavior keeps the offsets on their text
 * while the line is edited. Pure.
 */

/** Stretches of a line as [from, to) offsets; null = the whole line. */
export type Ranges = [number, number][] | null;

export interface Highlight {
	/** Line of the comment. */
	comment: number;
	/** Line it marks. */
	target: number;
	ranges: Ranges;
}

const HL_RE = /^\s*<!--\s*highlight\s*(?::\s*(\d+\s*-\s*\d+(?:\s*,\s*\d+\s*-\s*\d+)*)\s*)?-->\s*$/i;
const COMMENT_RE = /^\s*<!--.*-->\s*$/;
/** Block prefix a whole-line highlight leaves out: indent, `#`, `>`, list markers. */
const PREFIX_RE = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/;

export function parseHighlight(line: string): { ranges: Ranges } | null {
	const m = HL_RE.exec(line);
	if (!m) return null;
	if (!m[1]) return { ranges: null };
	return {
		ranges: m[1].split(',').map((part) => {
			const [a, b] = part.split('-').map((n) => Number(n.trim()));
			return [a, b] as [number, number];
		})
	};
}

export function isHighlightComment(line: string): boolean {
	return HL_RE.test(line);
}

export function highlightComment(ranges: Ranges): string {
	return ranges
		? `<!-- highlight: ${ranges.map(([a, b]) => `${a}-${b}`).join(', ')} -->`
		: '<!-- highlight -->';
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

/** Sorted, merged, clipped to the line, empty stretches dropped. */
export function normalizeRanges(ranges: [number, number][], len: number): [number, number][] {
	const sorted = ranges
		.map(([a, b]): [number, number] => [
			Math.max(0, Math.min(a, b, len)),
			Math.min(len, Math.max(a, b, 0))
		])
		.filter(([a, b]) => b > a)
		.sort((x, y) => x[0] - y[0]);
	const out: [number, number][] = [];
	for (const [a, b] of sorted) {
		const last = out[out.length - 1];
		if (last && a <= last[1]) last[1] = Math.max(last[1], b);
		else out.push([a, b]);
	}
	return out;
}

/** The stretches a line's highlights cover, as offsets (whole-line ones resolved). */
export function coveredRanges(text: string, all: Ranges[]): [number, number][] {
	const span = lineSpan(text);
	return normalizeRanges(
		all.flatMap((r) => r ?? [span]),
		text.length
	);
}

function subtract(ranges: [number, number][], [from, to]: [number, number]): [number, number][] {
	const out: [number, number][] = [];
	for (const [a, b] of ranges) {
		if (b <= from || a >= to) out.push([a, b]);
		else {
			if (a < from) out.push([a, from]);
			if (b > to) out.push([to, b]);
		}
	}
	return out;
}

/** True when `from`–`to` lies entirely inside the highlighted stretches. */
export function isCovered(ranges: [number, number][], from: number, to: number): boolean {
	return ranges.some(([a, b]) => a <= from && b >= to);
}

/**
 * A line's highlight after marking (`on`) or clearing `from`–`to`: null for
 * the whole line, undefined when nothing is left.
 */
export function applyRange(
	text: string,
	current: [number, number][],
	from: number,
	to: number,
	on: boolean
): Ranges | undefined {
	const span = lineSpan(text);
	const next = normalizeRanges(
		on ? [...current, [from, to]] : subtract(current, [from, to]),
		text.length
	);
	if (!next.length) return undefined;
	// Covering all of the line's text: say so, rather than as offsets.
	if (next.length === 1 && next[0][0] <= span[0] && next[0][1] >= span[1]) return null;
	return next;
}
