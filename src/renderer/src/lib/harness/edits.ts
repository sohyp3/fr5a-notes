/** Pure text transforms behind write_note (one paragraph per line, like the editor). */

const META_LINE_RE = /^\s*<!--\s*[\w-]+:\s*[\w-]+\s*-->\s*$/;

function norm(s: string): string {
	return s.replace(/\r\n?/g, '\n');
}

export function appendText(before: string, content: string): string {
	const base = norm(before).replace(/\s+$/, '');
	const add = norm(content).trim();
	return base ? `${base}\n\n${add}\n` : `${add}\n`;
}

/** Whole-note replace that keeps the file's hidden metadata lines (dir / pinned / ai…). */
export function replaceText(before: string, content: string): string {
	const meta = norm(before)
		.split('\n')
		.filter((l) => META_LINE_RE.test(l));
	const body = norm(content).trim();
	const has = new Set(
		body
			.split('\n')
			.filter((l) => META_LINE_RE.test(l))
			.map((l) => l.trim())
	);
	const keep = meta.filter((l) => !has.has(l.trim()));
	return `${[...keep, body].join('\n')}\n`;
}

/** Insert `content` as new lines after line `line` (0-based). */
export function insertAfterLine(before: string, line: number, content: string): string {
	const lines = norm(before).split('\n');
	const at = Math.max(0, Math.min(lines.length, line + 1));
	lines.splice(at, 0, ...norm(content).trim().split('\n'));
	return lines.join('\n');
}

/** A new note's body: keep a leading H1 if the model wrote one, else add the title. */
export function newNoteText(title: string, content: string): string {
	const body = norm(content).trim();
	return /^#\s/.test(body) ? `${body}\n` : `# ${title}\n\n${body}\n`;
}
