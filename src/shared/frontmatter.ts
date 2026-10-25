/** Lightweight boundaries shared by the editor and indexers; no YAML parser. */
export interface FrontmatterParts {
	prefix: string;
	yaml: string;
	body: string;
	lineEnding: '\n' | '\r\n';
}

/** A top-level `key:` line (plain or quoted key, optionally opening a flow map). */
const KEY_LINE =
	/^(?:\{[ \t]*)?(?:[\p{L}\p{N}_][\p{L}\p{N}_. -]*[ \t]*:(?:[ \t]|$)|(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')[ \t]*:)/u;

/**
 * A later `key:` line: any plain key (`Created (UTC):`, `$schema:`), since the
 * first line already showed this is metadata. Prose lines without a `key: `
 * still fail.
 */
const LATER_KEY = /^[^\s#\-?:,[\]{}|>][^:]*:(?:[ \t]|$)/u;

/**
 * Whether the text between two rules reads as YAML metadata: it opens with a
 * mapping key, and every other line is a key, a comment, an indented line
 * (nested values, block scalars) or a `- item` of the key above. A Markdown
 * note that merely starts with a `---` rule fails on its first prose line.
 */
function isMetadata(yaml: string): boolean {
	const lines = yaml.split(/\r?\n/).filter((line) => line.trim() && !/^\s*#/.test(line));
	if (!lines.length || !KEY_LINE.test(lines[0])) return false;
	// A flow map (`{ … }` on one or more lines) is taken as a whole.
	if (/^\{/.test(lines[0])) return true;
	return lines.every(
		(line) =>
			KEY_LINE.test(line) ||
			LATER_KEY.test(line) ||
			/^[ \t]/.test(line) ||
			/^-(?:[ \t]|$)/.test(line)
	);
}

/**
 * Treat an opening rule as metadata only when the block reads as YAML (see
 * `isMetadata`). This keeps ordinary rule-delimited Markdown intact without
 * loading YAML in the editor or indexers. A note beginning with `key: value`
 * lines between rules is inherently ambiguous and is treated as frontmatter.
 */
export function splitFrontmatter(source: string): FrontmatterParts | null {
	const bom = source.startsWith('\ufeff') ? '\ufeff' : '';
	const start = bom.length;
	if (!source.slice(start).startsWith('---\n') && !source.slice(start).startsWith('---\r\n'))
		return null;
	const firstEnd = source.indexOf('\n', start);
	const ending = source.slice(start, firstEnd + 1).endsWith('\r\n') ? '\r\n' : '\n';
	const match = /^---\r?$/m.exec(source.slice(firstEnd + 1));
	if (!match) return null;
	const closeStart = firstEnd + 1 + match.index;
	const yaml = source.slice(firstEnd + 1, closeStart);
	if (!isMetadata(yaml)) return null;
	const afterMarker = closeStart + match[0].length;
	const afterLine = source.startsWith('\r\n', afterMarker)
		? afterMarker + 2
		: source.startsWith('\n', afterMarker)
			? afterMarker + 1
			: afterMarker;
	return {
		prefix: `${bom}---${ending}`,
		yaml,
		body: source.slice(afterLine),
		lineEnding: ending
	};
}

export function markdownBody(source: string): string {
	return splitFrontmatter(source)?.body ?? source;
}

/** Apply ordinary metadata edits to the body, keeping YAML first in the file. */
export function editMarkdownBody(source: string, edit: (body: string) => string): string {
	const parts = splitFrontmatter(source);
	return parts
		? source.slice(0, source.length - parts.body.length) + edit(parts.body)
		: edit(source);
}
