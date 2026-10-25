/** Lightweight boundaries shared by the editor and indexers; no YAML parser. */
export interface FrontmatterParts {
	prefix: string;
	yaml: string;
	body: string;
	lineEnding: '\n' | '\r\n';
}

/**
 * Treat an opening rule as metadata only when its first non-comment content is
 * a mapping key. This keeps ordinary rule-delimited Markdown intact without
 * loading YAML in the editor or indexers. A note beginning with `key: value`
 * between rules is inherently ambiguous and is treated as frontmatter.
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
	const firstContent = yaml.split(/\r?\n/).find((line) => line.trim() && !/^\s*#/.test(line));
	if (
		!firstContent ||
		!/^(?:\{[ \t]*)?(?:[\p{L}\p{N}_][\p{L}\p{N}_. -]*[ \t]*:(?:[ \t]|$)|(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')[ \t]*:)/u.test(
			firstContent
		)
	)
		return null;
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
