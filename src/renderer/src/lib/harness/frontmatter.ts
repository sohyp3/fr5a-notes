/**
 * Minimal `---` frontmatter: flat `key: value` lines, where a value in
 * `[a, b]` is a list. Enough for sessions and skills without a YAML dependency.
 */

export type FrontValue = string | string[];

export function parseFrontmatter(text: string): { data: Record<string, FrontValue>; body: string } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (!m) return { data: {}, body: text };
	const data: Record<string, FrontValue> = {};
	for (const line of m[1].split(/\r?\n/)) {
		const i = line.indexOf(':');
		if (i <= 0) continue;
		const key = line.slice(0, i).trim();
		const raw = line.slice(i + 1).trim();
		data[key] =
			raw.startsWith('[') && raw.endsWith(']') ? splitList(raw.slice(1, -1)) : unquote(raw);
	}
	return { data, body: text.slice(m[0].length) };
}

/** Split `a, "b, c"` on commas outside double quotes. */
function splitList(s: string): string[] {
	const out: string[] = [];
	let cur = '';
	let inQuote = false;
	for (const ch of s) {
		if (ch === '"') inQuote = !inQuote;
		if (ch === ',' && !inQuote) {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	out.push(cur);
	return out.map((v) => unquote(v.trim())).filter(Boolean);
}

function unquote(s: string): string {
	return /^(["']).*\1$/.test(s) ? s.slice(1, -1) : s;
}

/** Quote values that would otherwise be ambiguous (commas, brackets, colons). */
function quote(s: string): string {
	return /[,[\]:#"]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, "'")}"` : s;
}

export function stringifyFrontmatter(data: Record<string, FrontValue | undefined>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(data)) {
		if (v === undefined) continue;
		lines.push(`${k}: ${Array.isArray(v) ? `[${v.map(quote).join(', ')}]` : quote(v)}`);
	}
	lines.push('---', '');
	return lines.join('\n');
}

export const str = (v: FrontValue | undefined): string =>
	Array.isArray(v) ? v.join(', ') : (v ?? '');
export const list = (v: FrontValue | undefined): string[] =>
	Array.isArray(v)
		? v
		: v
			? v
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: [];
