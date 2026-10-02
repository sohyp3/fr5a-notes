/**
 * Safe Markdown → HTML for AI output in the harness transcript. Every piece of
 * source text is HTML-escaped before any tag is emitted, and only the tags
 * produced here ever reach the DOM — raw HTML in the model's reply shows up as
 * text. Links are limited to http(s) / mailto.
 *
 * Covers what chat replies actually use: headings, paragraphs, emphasis,
 * inline + fenced code, quotes, nested / task lists, tables, rules, links.
 * Tolerates an unterminated fence (a reply still streaming).
 */

const ESC: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

// --- JSON ---------------------------------------------------------------------

const JSON_TOKEN =
	/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;

/** JSON source → escaped HTML with key / string / number / literal spans. */
export function highlightJson(src: string): string {
	let out = '';
	let last = 0;
	for (const m of src.matchAll(JSON_TOKEN)) {
		out += escapeHtml(src.slice(last, m.index));
		const [whole, str, colon, lit] = m;
		if (str !== undefined) {
			const cls = colon ? 'j-key' : 'j-str';
			out += `<span class="${cls}">${escapeHtml(str)}</span>${colon ? escapeHtml(colon) : ''}`;
		} else if (lit !== undefined) out += `<span class="j-lit">${lit}</span>`;
		else out += `<span class="j-num">${escapeHtml(whole)}</span>`;
		last = m.index + whole.length;
	}
	return out + escapeHtml(src.slice(last));
}

/** Pretty-printed JSON when `text` is a JSON object/array, else null. */
export function asJson(text: string): string | null {
	const t = text.trim();
	if (!/^[[{]/.test(t) || !/[\]}]$/.test(t)) return null;
	try {
		return JSON.stringify(JSON.parse(t), null, 2);
	} catch {
		return null;
	}
}

// --- inline -------------------------------------------------------------------

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function link(href: string, label: string): string {
	return `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`;
}

/** Emphasis, links and code on one line of (unescaped) text. */
export function renderInline(src: string): string {
	// Code spans and links wait behind placeholders, so emphasis never reaches
	// inside them; everything else is escaped first.
	const slots: string[] = [];
	// Placeholders use private-use code points, which never occur in real text.
	const hold = (html: string) => `\ue000${slots.push(html) - 1}\ue001`;
	const restore = (s: string): string =>
		s.replace(/\ue000(\d+)\ue001/g, (_m, i) => restore(slots[Number(i)]));
	const emphasis = (s: string) =>
		escapeHtml(s)
			.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
			.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
			.replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>')
			.replace(/(^|[^_\w])_(?=[^\s_])([^_]*?[^\s_])_(?![_\w])/g, '$1<em>$2</em>');

	let s = src.replace(/[\ue000\ue001]/g, '');
	s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _ticks, code: string) =>
		hold(`<code>${escapeHtml(code.trim() || code)}</code>`)
	);
	s = s.replace(/!?\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_m, label, url) =>
		hold(SAFE_URL.test(url) ? link(escapeHtml(url), emphasis(label)) : emphasis(label))
	);
	s = s.replace(/\bhttps?:\/\/[^\s<>()\ue000]+[^\s<>().,;:!?'"\]\ue000\ue001]/g, (url) =>
		hold(link(escapeHtml(url), escapeHtml(url)))
	);
	return restore(emphasis(s));
}

// --- blocks -------------------------------------------------------------------

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function isBlockStart(line: string): boolean {
	return (
		FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line)
	);
}

function codeBlock(lang: string, code: string): string {
	const l = lang.toLowerCase();
	const body = l === 'json' ? highlightJson(code) : escapeHtml(code);
	return (
		`<div class="md-code"><div class="md-code-head"><span>${escapeHtml(lang || 'text')}</span>` +
		`<button type="button" class="md-copy">Copy</button></div>` +
		`<pre><code>${body}</code></pre></div>`
	);
}

function splitRow(line: string): string[] {
	let t = line.trim();
	if (t.startsWith('|')) t = t.slice(1);
	if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
	return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function table(head: string, sep: string, rows: string[]): string {
	const align = splitRow(sep).map((c) =>
		c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''
	);
	const cell = (tag: string, text: string, i: number) =>
		`<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ''}>${renderInline(text)}</${tag}>`;
	const h = splitRow(head)
		.map((c, i) => cell('th', c, i))
		.join('');
	const b = rows
		.map(
			(r) =>
				`<tr>${splitRow(r)
					.map((c, i) => cell('td', c, i))
					.join('')}</tr>`
		)
		.join('');
	return `<div class="md-table"><table><thead><tr>${h}</tr></thead><tbody>${b}</tbody></table></div>`;
}

interface ListItem {
	indent: number;
	ordered: boolean;
	start: number;
	text: string;
}

function renderList(items: ListItem[]): string {
	let html = '';
	let i = 0;
	while (i < items.length) {
		const first = items[i];
		const tag = first.ordered ? 'ol' : 'ul';
		const start = first.ordered && first.start !== 1 ? ` start="${first.start}"` : '';
		html += `<${tag}${start}>`;
		while (
			i < items.length &&
			items[i].indent === first.indent &&
			items[i].ordered === first.ordered
		) {
			const it = items[i++];
			// Deeper items that follow belong to this one.
			const kids: ListItem[] = [];
			while (i < items.length && items[i].indent > first.indent) kids.push(items[i++]);
			const task = /^\[([ xX])\]\s+(.*)$/.exec(it.text);
			const body = task
				? `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ${renderInline(task[2])}`
				: renderInline(it.text);
			html += `<li${task ? ' class="task"' : ''}>${body}${kids.length ? renderList(kids) : ''}</li>`;
		}
		// Anything left (other list kind, odd indent) opens the next list.
		html += `</${tag}>`;
	}
	return html;
}

/** Markdown → escaped, tag-whitelisted HTML. */
export function renderMarkdown(src: string): string {
	const lines = src.replace(/\r\n?/g, '\n').split('\n');
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) {
			i++;
			continue;
		}

		const fence = FENCE.exec(line);
		if (fence) {
			const marker = fence[1];
			const body: string[] = [];
			i++;
			while (i < lines.length && !lines[i].trim().startsWith(marker)) body.push(lines[i++]);
			i++; // closing fence (or EOF while streaming)
			while (body.length && !body[body.length - 1].trim()) body.pop();
			out.push(codeBlock(fence[2], body.join('\n')));
			continue;
		}

		const h = HEADING.exec(line);
		if (h) {
			const level = h[1].length;
			out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
			i++;
			continue;
		}

		if (RULE.test(line)) {
			out.push('<hr>');
			i++;
			continue;
		}

		if (QUOTE.test(line)) {
			const body: string[] = [];
			while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''));
			out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
			continue;
		}

		if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
			const head = line;
			const sep = lines[i + 1];
			i += 2;
			const rows: string[] = [];
			while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(lines[i++]);
			out.push(table(head, sep, rows));
			continue;
		}

		if (ITEM.test(line)) {
			const items: ListItem[] = [];
			while (i < lines.length) {
				const m = ITEM.exec(lines[i]);
				if (m) {
					items.push({
						indent: m[1].replace(/\t/g, '    ').length,
						ordered: /\d/.test(m[2]),
						start: parseInt(m[2], 10) || 1,
						text: m[3]
					});
					i++;
				} else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
					// Indented continuation of the previous item.
					items[items.length - 1].text += ` ${lines[i++].trim()}`;
				} else if (!lines[i].trim() && i + 1 < lines.length && ITEM.test(lines[i + 1])) {
					i++; // loose list: a blank line between items
				} else break;
			}
			// Normalise indents so the shallowest item is depth 0.
			const min = Math.min(...items.map((it) => it.indent));
			for (const it of items) it.indent -= min;
			out.push(renderList(items));
			continue;
		}

		const para: string[] = [];
		while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
			if (para.length && lines[i].includes('|') && TABLE_SEP.test(lines[i + 1] ?? '')) break;
			para.push(lines[i++].trim());
		}
		if (!para.length) para.push(lines[i++].trim());
		out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
	}
	return out.join('');
}

/** AI reply → HTML: a bare JSON reply becomes a highlighted block, else Markdown. */
export function renderReply(text: string): string {
	const json = asJson(text);
	return json ? codeBlock('json', json) : renderMarkdown(text);
}
