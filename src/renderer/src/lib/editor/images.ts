import { isImagePath } from '../../../../shared/paths';
import { codeLines } from './blocks';
import { findHighlights } from './highlights';
import { findTables } from './tables';

/**
 * Images in the line-per-paragraph editor: a line holding only `![alt](src)`
 * shows the picture (painted by MarkdownSyntax, edited by ImageBehavior). Its
 * width is kept in a comment on the line right below, as a share of the text
 * column:
 *
 *   ![Diagram](../assets/diagram.png)
 *   <!-- size: 60% -->
 *
 * No comment: the picture's own width, never wider than the column. Pasted /
 * dropped images are saved under `assets/` at the workspace root and linked
 * relative to the note, so other Markdown tools find them too. Pure.
 */

/** Saved images go here (workspace root). */
export const ASSETS_DIR = 'assets';
export const MIN_SIZE = 10;

const IMAGE_RE =
	/^\s*!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)\s*$/;
const SIZE_RE = /^\s*<!--\s*size:\s*(\d{1,3})\s*%\s*-->\s*$/i;

export interface ImageLine {
	alt: string;
	src: string;
}

export interface ImageBlock extends ImageLine {
	/** Width in % of the text column; null = the picture's own width. */
	size: number | null;
	/** Line of the size comment, when there is one (always the next line). */
	sizeLine: number | null;
}

/** The image on a line that holds nothing else. */
export function parseImage(line: string): ImageLine | null {
	const m = IMAGE_RE.exec(line);
	if (!m) return null;
	return { alt: m[1], src: m[2].startsWith('<') ? m[2].slice(1, -1) : m[2] };
}

export function parseSize(line: string): number | null {
	const m = SIZE_RE.exec(line);
	return m ? clampSize(Number(m[1])) : null;
}

export function clampSize(n: number): number {
	return Math.min(100, Math.max(MIN_SIZE, Math.round(n)));
}

export function sizeComment(pct: number): string {
	return `<!-- size: ${clampSize(pct)}% -->`;
}

/** Image lines by index (fenced code skipped), each with its size comment. */
export function findImages(lines: string[]): Map<number, ImageBlock> {
	const code = codeLines(lines);
	const out = new Map<number, ImageBlock>();
	for (let i = 0; i < lines.length; i++) {
		if (code[i]) continue;
		const img = parseImage(lines[i]);
		if (!img) continue;
		const size = i + 1 < lines.length && !code[i + 1] ? parseSize(lines[i + 1]) : null;
		out.set(i, { ...img, size, sizeLine: size === null ? null : i + 1 });
		if (size !== null) i++;
	}
	return out;
}

export type ImageSource = { kind: 'url'; url: string } | { kind: 'file'; path: string };

/**
 * Where `src` points: an https / data URL as it is, or a workspace image —
 * `/a.png` from the workspace root, anything else from the note's folder
 * `dir`. Null for other schemes (http, file, …), paths that climb out of the
 * workspace, and files that aren't images.
 */
export function imageSource(src: string, dir: string): ImageSource | null {
	if (/^https:\/\//i.test(src) || /^data:image\//i.test(src)) return { kind: 'url', url: src };
	if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
	let path = src.replace(/[?#].*$/, '');
	try {
		path = decodeURI(path);
	} catch {
		/* a stray % — take it as written */
	}
	const parts = path.startsWith('/') ? [] : dir.split('/').filter(Boolean);
	for (const seg of path.split('/')) {
		if (!seg || seg === '.') continue;
		if (seg !== '..') parts.push(seg);
		else if (!parts.pop()) return null;
	}
	const out = parts.join('/');
	return isImagePath(out) ? { kind: 'file', path: out } : null;
}

/** Characters that would end or break a Markdown link destination. */
const encodeSegment = (s: string) =>
	s.replace(/[\s()<>%]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

/** Workspace path `to` as a link from folder `dir`: `../assets/a.png`. */
export function relativeLink(dir: string, to: string): string {
	const from = dir.split('/').filter(Boolean);
	const target = to.split('/');
	let i = 0;
	while (i < from.length && i < target.length - 1 && from[i] === target[i]) i++;
	return [...from.slice(i).map(() => '..'), ...target.slice(i).map(encodeSegment)].join('/');
}

const TYPE_EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/avif': 'avif',
	'image/bmp': 'bmp',
	'image/svg+xml': 'svg'
};

/** True for the image types the editor saves. */
export function isImageType(type: string): boolean {
	return type in TYPE_EXT;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * File name for a saved image: the original's name, cleaned up (no spaces or
 * brackets, so the link needs no escaping), or `image-<time>` for a pasted
 * one — clipboard images are all called `image.png`.
 */
export function assetName(original: string, type: string, now = new Date()): string {
	const ext = TYPE_EXT[type] ?? /\.([a-z0-9]+)$/i.exec(original)?.[1].toLowerCase() ?? 'png';
	let stem = original
		.replace(/\.[^.]*$/, '')
		.normalize('NFC')
		.replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	if (!stem || /^image$/i.test(stem)) {
		const d = now;
		stem = `image-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
	}
	return `${stem}.${ext}`;
}

/** The Markdown line for an image. */
export function imageLine(alt: string, link: string): string {
	return `![${alt.replace(/[[\]\n]/g, '')}](${link})`;
}

// --- moving a picture ------------------------------------------------------------

const COMMENT_RE = /^\s*<!--.*-->\s*$/;

/**
 * Where a dragged picture may land: `out[k]` says whether lines can go in
 * before line `k` (`k = lines.length`: at the end) without splitting fenced
 * code, a table, an image from its size comment or a highlight comment from
 * the line it marks, or going above the note's leading metadata comments.
 */
export function dropGaps(lines: string[]): boolean[] {
	const out = new Array<boolean>(lines.length + 1).fill(true);
	for (let k = 0; k < lines.length && COMMENT_RE.test(lines[k]); k++) out[k] = false;
	const code = codeLines(lines);
	const tables = findTables(lines);
	for (let k = 1; k < lines.length; k++) {
		if (code[k - 1] && code[k]) out[k] = false;
		if (tables.has(k) && tables.get(k)!.role !== 'head') out[k] = false;
	}
	for (let k = 0; k < lines.length; k++)
		if (!code[k] && parseSize(lines[k]) !== null) out[k] = false;
	for (const h of findHighlights(lines)) {
		out[Math.max(h.comment, h.target)] = false;
		// A comment marking the line above would mark a line put in below it.
		if (h.target < h.comment) out[h.comment + 1] = false;
	}
	return out;
}

export interface LineMove {
	/** Lines taken out: `[from, to)`. */
	cut: [number, number];
	/** The lines go in before this one (numbered as before the cut). */
	at: number;
	insert: string[];
	/** Where the moved block starts in `insert` (after a padding line). */
	offset: number;
}

/**
 * Moving lines `from..to` (an image and its size comment) to gap `gap` (see
 * `dropGaps`); null when they'd stay where they are. A blank line left doubled
 * behind goes with them, and a blank line keeps them apart from a table (other
 * Markdown tools would read the line as a row).
 */
export function moveLines(lines: string[], from: number, to: number, gap: number): LineMove | null {
	if (gap >= from && gap <= to + 1) return null;
	const blank = (i: number) => i >= 0 && i < lines.length && !lines[i].trim();
	const end = blank(from - 1) && blank(to + 1) ? to + 2 : to + 1;
	const tables = findTables(lines);
	const above = gap === end ? from - 1 : gap - 1;
	const before = tables.has(above) ? [''] : [];
	const after = tables.get(gap)?.role === 'head' ? [''] : [];
	return {
		cut: [from, end],
		at: gap,
		insert: [...before, ...lines.slice(from, to + 1), ...after],
		offset: before.length
	};
}
