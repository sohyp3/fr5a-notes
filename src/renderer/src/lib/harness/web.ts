import { SEARCH_KINDS, type Http, type SearchProfile } from './types';

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
	const kind = SEARCH_KINDS.find((k) => k.kind === profile.kind);
	if (kind?.needsKey && !apiKey?.trim())
		throw new Error(`${kind.label} needs an API key: paste it in Settings → AI → Web search.`);
	let res;
	if (profile.kind === 'duckduckgo') {
		// The no-JavaScript results page: no key, no account.
		res = await http.httpFetch({
			url: `https://html.duckduckgo.com/html/?q=${q}`,
			headers: { Accept: 'text/html', 'User-Agent': UA },
			timeoutMs: 30_000
		});
		if (res.status < 200 || res.status >= 300)
			throw new Error(
				`Search failed (${res.status}). DuckDuckGo may be rate-limiting; retry later.`
			);
		const results = parseDuckDuckGo(res.body);
		if (!results.length && /anomaly|captcha/i.test(res.body))
			throw new Error(
				'DuckDuckGo asked for a captcha. Retry later, or pick another provider in Settings → AI.'
			);
		return results.slice(0, max);
	} else if (profile.kind === 'searxng') {
		const base = profile.baseUrl.trim().replace(/\/+$/, '');
		if (!base) throw new Error('Set your SearXNG URL in Settings → AI.');
		res = await http.httpFetch({
			url: `${base}/search?q=${q}&format=json`,
			headers: { Accept: 'application/json', 'User-Agent': UA },
			timeoutMs: 30_000
		});
	} else if (profile.kind === 'brave') {
		// Brave rejects (422) queries over 400 characters / 50 words, and count > 20.
		const short = encodeURIComponent(query.split(/\s+/).slice(0, 50).join(' ').slice(0, 400));
		res = await http.httpFetch({
			url: `https://api.search.brave.com/res/v1/web/search?q=${short}&count=${Math.min(max, 20)}`,
			headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey!.trim() },
			timeoutMs: 30_000
		});
	} else if (profile.kind === 'tavily') {
		res = await http.httpFetch({
			url: 'https://api.tavily.com/search',
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey!.trim()}` },
			body: JSON.stringify({ query, max_results: max }),
			timeoutMs: 30_000
		});
	} else {
		// Highlights: the passages that best match the query, as the snippet.
		res = await http.httpFetch({
			url: 'https://api.exa.ai/search',
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!.trim() },
			body: JSON.stringify({
				query,
				numResults: Math.min(max, 100),
				contents: { highlights: { maxCharacters: 300 } }
			}),
			timeoutMs: 30_000
		});
	}
	if (res.status < 200 || res.status >= 300)
		throw new Error(`Search failed (${res.status}): ${searchError(res.body)}`);
	return parseSearch(profile.kind, res.body).slice(0, max);
}

/**
 * The readable part of a search API error: Brave's `error.detail` (plus which
 * field failed validation), Tavily's `detail.error`, Exa's `error`, else the
 * start of the body.
 */
export function searchError(body: string): string {
	try {
		const j = JSON.parse(body);
		const e = j?.error;
		if (e && typeof e === 'object') {
			const field = e.meta?.errors?.[0];
			const where = field?.loc ? ` (${field.loc.join(' ')}: ${field.msg})` : '';
			if (e.code === 'SUBSCRIPTION_TOKEN_INVALID')
				return `${e.detail} Check the key in Settings → AI → Web search.`;
			if (e.detail) return `${e.detail}${where}`;
		}
		if (j?.tag === 'INVALID_API_KEY')
			return 'Invalid API key. Check the key in Settings → AI → Web search.';
		const d = j?.detail;
		if (typeof d === 'string') return d;
		if (d?.error) return String(d.error);
		if (typeof e === 'string') return e;
	} catch {
		// Not JSON.
	}
	return body.slice(0, 200);
}

/**
 * Results from DuckDuckGo's HTML page: each `result__a` link starts a result,
 * the next `result__snippet` describes it. Ads (redirects through
 * duckduckgo.com itself) are dropped; `/l/?uddg=` redirects are unwrapped.
 */
export function parseDuckDuckGo(html: string): SearchResult[] {
	const out: SearchResult[] = [];
	const el =
		/<(a|div|td|span)\b([^>]*\bclass="[^"]*\bresult__(a|snippet)\b[^"]*"[^>]*)>([\s\S]*?)<\/\1>/g;
	for (const m of html.matchAll(el)) {
		const [, , attrs, kind, inner] = m;
		if (kind === 'snippet') {
			const last = out[out.length - 1];
			if (last && !last.snippet) last.snippet = stripTags(inner).slice(0, 300);
			continue;
		}
		const href = decode(/\bhref="([^"]*)"/.exec(attrs)?.[1] ?? '');
		let url = href.startsWith('//') ? `https:${href}` : href;
		const wrapped = /[?&]uddg=([^&]+)/.exec(url);
		if (wrapped) {
			try {
				url = decodeURIComponent(wrapped[1]);
			} catch {
				continue;
			}
		}
		if (!/^https?:\/\//i.test(url) || /^https?:\/\/([^/]+\.)?duckduckgo\.com\//i.test(url)) {
			out.push({ title: '', url: '', snippet: 'skip' }); // keeps its snippet from attaching upward
			continue;
		}
		out.push({ title: stripTags(inner) || url, url, snippet: '' });
	}
	return out.filter((r) => r.url);
}

export function parseSearch(kind: SearchProfile['kind'], body: string): SearchResult[] {
	if (kind === 'duckduckgo') return parseDuckDuckGo(body);
	const j = JSON.parse(body);
	const rows: {
		title?: string;
		url?: string;
		content?: string;
		description?: string;
		highlights?: string[];
	}[] = kind === 'brave' ? (j?.web?.results ?? []) : (j?.results ?? []);
	return rows
		.filter((r) => r.url)
		.map((r) => ({
			title: stripTags(r.title || r.url || ''),
			url: r.url!,
			snippet: stripTags(
				r.content ?? r.description ?? r.highlights?.join(' … ').replace(/\s+/g, ' ') ?? ''
			).slice(0, 300)
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
