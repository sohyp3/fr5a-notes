import { isImagePath } from '../../../../shared/paths';
import { codeLines } from './blocks';

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
