import { renderInline } from '../harness/render';

/**
 * Markdown (GFM pipe) tables for the line-per-paragraph editor: finding table
 * blocks among the lines, where the cells sit, rendering a table for display,
 * and turning a pasted spreadsheet selection (TSV) into one. Pure —
 * MarkdownSyntax.ts paints the result, TableBehavior.ts edits it.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** `|---|:--:|` — every cell dashes, optionally colon-aligned. */
const SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export type RowRole = 'head' | 'sep' | 'body';

export interface TableRow {
	role: RowRole;
	/** Last line of its table. */
	last: boolean;
}

/** Offsets of the cell-separating pipes in a row (escaped `\|` doesn't count). */
export function pipeOffsets(line: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < line.length; i++) {
		if (line[i] === '\\') i++;
		else if (line[i] === '|') out.push(i);
	}
	return out;
}

/**
 * Each cell's text in a row, as offsets: from just after its pipe (spaces
 * skipped) to before the spaces ahead of the next pipe; a blank cell is an
 * empty range one space in. A row without outer
 * pipes still has its first / last cell.
 */
export function cellRanges(line: string): { from: number; to: number }[] {
	const pipes = pipeOffsets(line);
	const bounds = [-1, ...pipes, line.length];
	const out: { from: number; to: number }[] = [];
	for (let k = 0; k + 1 < bounds.length; k++) {
		let from = bounds[k] + 1;
		let to = bounds[k + 1];
		// Nothing before the first pipe / after the last one: not a cell.
		if ((k === 0 || k + 2 === bounds.length) && !line.slice(from, to).trim()) continue;
		if (!line.slice(from, to).trim()) {
			// Blank cell: the caret goes after one space, so typing gives `| x |`.
			from = to = Math.min(from + 1, to);
			out.push({ from, to });
			continue;
		}
		while (from < to && line[from] === ' ') from++;
		while (to > from && line[to - 1] === ' ') to--;
		out.push({ from, to });
	}
	return out;
}

export function isTableSep(line: string): boolean {
	return line.includes('-') && SEP.test(line);
}

/**
 * Lines that belong to a table, by index: a row with a pipe, then a separator
 * row, then every following non-blank row with a pipe. Fenced code is skipped.
 */
export function findTables(lines: string[]): Map<number, TableRow> {
	const rows = new Map<number, TableRow>();
	let fence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const f = FENCE.exec(lines[i]);
		if (fence) {
			if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
			continue;
		}
		if (f) {
			fence = f[1];
			continue;
		}
		if (!pipeOffsets(lines[i]).length || i + 1 >= lines.length || !isTableSep(lines[i + 1]))
			continue;
		rows.set(i, { role: 'head', last: false });
		rows.set(i + 1, { role: 'sep', last: false });
		let j = i + 2;
		while (
			j < lines.length &&
			lines[j].trim() &&
			pipeOffsets(lines[j]).length &&
			!FENCE.test(lines[j])
		)
			rows.set(j++, { role: 'body', last: false });
		rows.get(j - 1)!.last = true;
		i = j - 1;
	}
	return rows;
}

// --- display -------------------------------------------------------------------

/**
 * A table's lines (header, separator, body…) → escaped `<table>` HTML. Cells
 * carry `data-line` (offset from the header line) and `data-cell` (index in
 * `cellRanges`), so a click can put the caret in that cell's source. Links
 * render as text: the editor isn't a browser.
 */
export function tableHtml(lines: string[]): string {
	const align = cellRanges(lines[1] ?? '').map(({ from, to }) => {
		const c = (lines[1] ?? '').slice(from, to).trim();
		return c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '';
	});
	const cols = Math.max(...lines.filter((_, i) => i !== 1).map((l) => cellRanges(l).length));
	const row = (line: string, i: number, tag: 'th' | 'td') => {
		const cells = cellRanges(line);
		let html = '';
		for (let c = 0; c < cols; c++) {
			const r = cells[c];
			const text = r ? line.slice(r.from, r.to).replace(/\\\|/g, '|') : '';
			const inner = renderInline(text).replace(
				/<a [^>]*>([\s\S]*?)<\/a>/g,
				'<span class="md-link">$1</span>'
			);
			const style = align[c] ? ` style="text-align:${align[c]}"` : '';
			html += `<${tag} data-line="${i}" data-cell="${r ? c : Math.max(0, cells.length - 1)}"${style}>${inner}</${tag}>`;
		}
		return `<tr>${html}</tr>`;
	};
	const body = lines
		.slice(2)
		.map((l, k) => row(l, k + 2, 'td'))
		.join('');
	return `<table><thead>${row(lines[0], 0, 'th')}</thead><tbody>${body}</tbody></table>`;
}

// --- paste: spreadsheet selection → Markdown table ------------------------------

/** Tab-separated rows; a cell may be "quoted" (spreadsheets quote cells with newlines). */
function parseTsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let i = 0;
	let atStart = true;
	while (i < text.length) {
		const c = text[i];
		if (atStart && c === '"') {
			// Quoted cell: "" is a literal quote; ends at the closing quote.
			let j = i + 1;
			let q = '';
			while (j < text.length) {
				if (text[j] === '"' && text[j + 1] === '"') {
					q += '"';
					j += 2;
				} else if (text[j] === '"') break;
				else q += text[j++];
			}
			if (j < text.length && (j + 1 >= text.length || /[\t\r\n]/.test(text[j + 1]))) {
				cell = q;
				i = j + 1;
				atStart = false;
				continue;
			}
		}
		atStart = false;
		if (c === '\t') {
			row.push(cell);
			cell = '';
			atStart = true;
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
			atStart = true;
		} else cell += c;
		i++;
	}
	if (cell || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

/**
 * Rows of a pasted table, or null when the text isn't one: tab-separated
 * (spreadsheets, web tables) with 2+ columns, or columns aligned by runs of
 * 2+ spaces with 3+ columns. Every row needs the same number of cells.
 */
export function parsePastedTable(text: string): string[][] | null {
	const t = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
	if (!t.includes('\n')) return null;
	if (t.includes('\t')) {
		const rows = parseTsv(t).filter((r) => r.some((c) => c.trim()));
		const n = rows[0]?.length ?? 0;
		if (rows.length >= 2 && n >= 2 && rows.every((r) => r.length === n)) return rows;
		return null;
	}
	const lines = t.split('\n').filter((l) => l.trim());
	if (lines.some((l) => l.includes('|'))) return null;
	const rows = lines.map((l) => l.trimEnd().split(/ {2,}/));
	const n = rows[0]?.length ?? 0;
	if (rows.length >= 2 && n >= 3 && rows.every((r) => r.length === n)) return rows;
	return null;
}

/** Display width, close enough for padding columns (wide CJK / emoji count double). */
function width(s: string): number {
	let w = 0;
	for (const ch of s)
		w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
	return w;
}

/** Rows (first = header) → Markdown table lines, columns padded so the raw text lines up. */
export function toMarkdownTable(rows: string[][]): string[] {
	const n = Math.max(...rows.map((r) => r.length));
	const cells = rows.map((r) =>
		Array.from({ length: n }, (_, i) =>
			(r[i] ?? '')
				.replace(/\s*\n\s*/g, ' ')
				.trim()
				.replace(/\|/g, '\\|')
		)
	);
	const widths = Array.from({ length: n }, (_, i) =>
		Math.min(40, Math.max(3, ...cells.map((r) => width(r[i]))))
	);
	const line = (r: string[]) =>
		`| ${r.map((c, i) => c + ' '.repeat(Math.max(0, widths[i] - width(c)))).join(' | ')} |`;
	return [
		line(cells[0]),
		`| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`,
		...cells.slice(1).map(line)
	];
}
