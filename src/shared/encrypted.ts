/**
 * Encrypted notes: the file keeps its leading metadata comments (dir /
 * pinned / locked / ai) in the clear, so both indexers and the delete-lock
 * check still work, and everything after them is one ASCII-armored OpenPGP
 * message (`gpg -d` reads it as is):
 *
 *     <!-- pinned: true -->
 *     -----BEGIN PGP MESSAGE-----
 *     …
 *     -----END PGP MESSAGE-----
 *
 * Pure string helpers, shared by main, Android and the renderer.
 */

/** One hidden metadata comment line (as `markdown.ts` writes them). */
export const META_LINE_RE =
	/^\s*<!--\s*(?:dir:\s*(?:rtl|ltr)|pinned:\s*(?:true|false)|locked:\s*(?:true|false)|ai:\s*local)\s*-->\s*$/i;

const BEGIN_RE = /^-----BEGIN PGP MESSAGE-----\s*$/;

/** Length of the leading metadata lines (each with its newline). */
function headLength(text: string): number {
	let at = 0;
	while (at < text.length) {
		const nl = text.indexOf('\n', at);
		if (nl === -1 || !META_LINE_RE.test(text.slice(at, nl))) break;
		at = nl + 1;
	}
	return at;
}

/** Plaintext → the metadata lines that stay in the clear, and the body to encrypt. */
export function splitHeader(text: string): { head: string; body: string } {
	const n = headLength(text);
	return { head: text.slice(0, n), body: text.slice(n) };
}

/**
 * An encrypted file → its clear metadata lines and the armored message, or
 * null when the text right after the metadata isn't a PGP message (a note
 * that merely quotes one further down stays plain).
 */
export function splitEncrypted(raw: string): { head: string; armor: string } | null {
	const n = headLength(raw);
	const nl = raw.indexOf('\n', n);
	const first = raw.slice(n, nl === -1 ? undefined : nl);
	return BEGIN_RE.test(first) ? { head: raw.slice(0, n), armor: raw.slice(n) } : null;
}

export function isEncryptedNote(raw: string): boolean {
	return splitEncrypted(raw) !== null;
}
