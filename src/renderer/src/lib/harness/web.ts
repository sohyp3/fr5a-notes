import type { Http, SearchProfile } from './types';

/** Web search + page reading for sources / fact-checking. */

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) fr5a-notes';

export async function webSearch(
	http: Http,
	profile: SearchProfile,
	apiKey: string | null,
	query: string,
	max = 6
): Promise<SearchResult[]> {
	const q = encodeURIComponent(query);
	let res;
	if (profile.kind === 'searxng') {
		const base = profile.baseUrl.trim().replace(/\/+$/, '');
		if (!base) throw new Error('Set your SearXNG URL in Settings → AI.');
		res = await http.httpFetch({
			url: `${base}/search?q=${q}&format=json`,
			headers: { Accept: 'application/json', 'User-Agent': UA },
			timeoutMs: 30_000
		});
	} else if (profile.kind === 'brave') {
		res = await http.httpFetch({
			url: `https://api.search.brave.com/res/v1/web/search?q=${q}&count=${max}`,
			headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey ?? '' },
			timeoutMs: 30_000
		});
	} else {
		res = await http.httpFetch({
			url: 'https://api.tavily.com/search',
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey ?? ''}` },
			body: JSON.stringify({ query, max_results: max }),
			timeoutMs: 30_000
		});
	}
	if (res.status < 200 || res.status >= 300)
		throw new Error(`Search failed (${res.status}): ${res.body.slice(0, 200)}`);
	return parseSearch(profile.kind, res.body).slice(0, max);
}

export function parseSearch(kind: SearchProfile['kind'], body: string): SearchResult[] {
	const j = JSON.parse(body);
	const rows: { title?: string; url?: string; content?: string; description?: string }[] =
		kind === 'brave' ? (j?.web?.results ?? []) : (j?.results ?? []);
	return rows
		.filter((r) => r.url)
		.map((r) => ({
			title: stripTags(r.title ?? r.url ?? ''),
			url: r.url!,
			snippet: stripTags(r.content ?? r.description ?? '').slice(0, 300)
		}));
}

export function formatResults(results: SearchResult[]): string {
	if (!results.length) return 'No results.';
	return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	mdash: '—',
	ndash: '–',
	hellip: '…',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“'
};

function decode(s: string): string {
	return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

function stripTags(s: string): string {
	return decode(s.replace(/<[^>]*>/g, '')).trim();
}

/**
 * Readable text from an HTML page, without a DOM: drop chrome (scripts, nav,
 * footers…), keep headings / paragraphs / list items as Markdown-ish lines.
 */
export function htmlToText(html: string, maxChars = 12_000): { title: string; text: string } {
	const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
	let s = html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(
			/<(head|title|script|style|noscript|svg|nav|header|footer|aside|form|iframe|template)\b[\s\S]*?<\/\1>/gi,
			''
		);
	const main = /<(main|article)\b[\s\S]*?<\/\1>/i.exec(s);
	if (main && main[0].length > 500) s = main[0];
	s = s
		.replace(/<h([1-6])[^>]*>/gi, (_m, n) => `\n\n${'#'.repeat(Number(n))} `)
		.replace(/<li[^>]*>/gi, '\n- ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|section|h[1-6]|li|tr|blockquote|pre|table|ul|ol)>/gi, '\n\n')
		.replace(/<[^>]+>/g, '');
	const text = decode(s)
		.split('\n')
		.map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return {
		title,
		text: text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[… page truncated]` : text
	};
}

export async function fetchPage(http: Http, url: string): Promise<string> {
	const res = await http.httpFetch({
		url,
		headers: { 'User-Agent': UA, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
		timeoutMs: 30_000
	});
	if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} for ${url}`);
	const type = res.headers['content-type'] ?? '';
	if (!type || type.includes('html')) {
		const { title, text } = htmlToText(res.body);
		return `${title ? `# ${title}\n` : ''}${url}\n\n${text}`;
	}
	if (type.startsWith('text/') || type.includes('json'))
		return `${url}\n\n${res.body.slice(0, 12_000)}`;
	return `${url}: unsupported content type ${type}`;
}
