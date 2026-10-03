/**
 * The note-list preview: the body after the first heading, flattened to one
 * line with Markdown syntax dropped — list markers, rules, quote / emphasis /
 * tag symbols, table pipes and separator rows — but hyphens inside words
 * (dates, names) kept. Shared by both hosts' indexers.
 */
export function noteSnippet(body: string, max = 140): string {
	return body
		.replace(/^#{1,6}\s.*$/m, '')
		.replace(/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/gm, '')
		.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
		.replace(/[#>*_`~]/g, '')
		.replace(/\s*\|\s*/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}
