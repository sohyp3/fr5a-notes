/**
 * The note-list preview: the body after the first heading, flattened to one
 * line with Markdown syntax dropped — list markers, rules, quote / emphasis /
 * tag symbols, table pipes and separator rows, images and comment lines
 * (highlights, image sizes) — but hyphens inside words (dates, names) kept.
 * Shared by both hosts' indexers.
 */
export function noteSnippet(body: string, max = 140): string {
	return body
		.replace(/^\s*<!--.*-->\s*$/gm, '')
		.replace(/^#{1,6}\s.*$/m, '')
		.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
		.replace(/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/gm, '')
		.replace(/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
		.replace(/[#>*_`~]/g, '')
		.replace(/\s*\|\s*/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}
