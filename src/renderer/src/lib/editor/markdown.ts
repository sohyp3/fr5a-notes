import type { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';

/**
 * Bridge between raw Markdown text (what lives on disk) and the ProseMirror
 * document. The mapping is deliberately 1:1 — each line of the file becomes one
 * paragraph — so the buffer *is* the Markdown. The MarkdownSyntax plugin then
 * decorates the symbols; we never restructure them into semantic nodes.
 */

export function textToDoc(text: string): JSONContent {
	// Normalise CRLF, then split on newlines. An empty file → one empty line.
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	return {
		type: 'doc',
		content: lines.map((line) =>
			line.length
				? { type: 'paragraph', content: [{ type: 'text', text: line }] }
				: { type: 'paragraph' }
		)
	};
}

export function docToText(editor: Editor): string {
	// Each top-level block is one line; join with newlines to reconstruct the file.
	const lines: string[] = [];
	editor.state.doc.forEach((node) => lines.push(node.textContent));
	return lines.join('\n');
}

// --- title derivation ---------------------------------------------------------

/**
 * The filename a draft note should get on its first save: the first H1 line's
 * text, else the first non-empty non-metadata line, else null (still blank —
 * nothing worth saving yet).
 */
export function titleFromContent(text: string): string | null {
	let fallback: string | null = null;
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line || /^<!--.*-->$/.test(line)) continue;
		const h1 = line.match(/^#\s+(.+)$/);
		if (h1) return h1[1].trim();
		// A bare `#` (the empty H1 scaffold) isn't a title.
		if (line === '#') continue;
		fallback ??= line.replace(/^#{1,6}\s*/, '');
	}
	return fallback;
}

// --- per-file directionality ------------------------------------------------

export type Direction = 'ltr' | 'rtl';

/** Matches the hidden metadata line, e.g. `<!-- dir: rtl -->`. */
export const DIR_COMMENT_RE = /^<!--\s*dir:\s*(rtl|ltr)\s*-->$/i;

/** Read the direction stored in the note's metadata comment, if any. */
export function detectDir(text: string): Direction | null {
	// Only the first few lines may carry metadata.
	const lines = text.split('\n', 4);
	for (const line of lines) {
		const m = line.trim().match(DIR_COMMENT_RE);
		if (m) return m[1].toLowerCase() as Direction;
	}
	return null;
}

/**
 * Return `text` with its direction metadata set to `dir`. Replaces an existing
 * `<!-- dir: … -->` line if present, otherwise prepends one.
 */
export function setDir(text: string, dir: Direction): string {
	const comment = `<!-- dir: ${dir} -->`;
	const lines = text.split('\n');
	const idx = lines.findIndex((l) => DIR_COMMENT_RE.test(l.trim()));
	if (idx !== -1) {
		lines[idx] = comment;
		return lines.join('\n');
	}
	return `${comment}\n${text}`;
}

// --- pinning ----------------------------------------------------------------

/** Matches the pinned metadata line, e.g. `<!-- pinned: true -->`. */
export const PIN_COMMENT_RE = /^<!--\s*pinned:\s*(true|false)\s*-->$/i;

export function detectPinned(text: string): boolean {
	const lines = text.split('\n', 4);
	for (const line of lines) {
		const m = line.trim().match(PIN_COMMENT_RE);
		if (m) return m[1].toLowerCase() === 'true';
	}
	return false;
}

/**
 * Return `text` with its pinned flag set. When pinning, insert/replace the
 * comment; when unpinning, drop the comment line entirely so files stay tidy.
 */
export function setPinned(text: string, pinned: boolean): string {
	const lines = text.split('\n');
	const idx = lines.findIndex((l) => PIN_COMMENT_RE.test(l.trim()));
	if (!pinned) {
		if (idx !== -1) lines.splice(idx, 1);
		return lines.join('\n');
	}
	const comment = '<!-- pinned: true -->';
	if (idx !== -1) {
		lines[idx] = comment;
		return lines.join('\n');
	}
	// Place the pin marker after a leading `dir:` comment if one exists.
	const insertAt = lines.findIndex((l) => DIR_COMMENT_RE.test(l.trim())) === 0 ? 1 : 0;
	lines.splice(insertAt, 0, comment);
	return lines.join('\n');
}

// --- locking ----------------------------------------------------------------

/** Matches the locked metadata line, e.g. `<!-- locked: true -->`. */
export const LOCK_COMMENT_RE = /^<!--\s*locked:\s*(true|false)\s*-->$/i;

export function detectLocked(text: string): boolean {
	const lines = text.split('\n', 4);
	for (const line of lines) {
		const m = line.trim().match(LOCK_COMMENT_RE);
		if (m) return m[1].toLowerCase() === 'true';
	}
	return false;
}

/**
 * Return `text` with its locked flag set. When locking, insert/replace the
 * comment (kept below any `dir:` / `pinned:` markers); when unlocking, drop the
 * line so files stay tidy.
 */
export function setLocked(text: string, locked: boolean): string {
	const lines = text.split('\n');
	const idx = lines.findIndex((l) => LOCK_COMMENT_RE.test(l.trim()));
	if (!locked) {
		if (idx !== -1) lines.splice(idx, 1);
		return lines.join('\n');
	}
	const comment = '<!-- locked: true -->';
	if (idx !== -1) {
		lines[idx] = comment;
		return lines.join('\n');
	}
	// Keep lock below any leading dir/pinned metadata comments.
	let insertAt = 0;
	while (
		insertAt < lines.length &&
		(DIR_COMMENT_RE.test(lines[insertAt].trim()) || PIN_COMMENT_RE.test(lines[insertAt].trim()))
	) {
		insertAt++;
	}
	lines.splice(insertAt, 0, comment);
	return lines.join('\n');
}
