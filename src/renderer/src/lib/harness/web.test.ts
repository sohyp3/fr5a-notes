import { describe, expect, it } from 'vitest';
import {
	formatResults,
	htmlToText,
	parseDuckDuckGo,
	parseSearch,
	searchError,
	webSearch
} from './web';
import type { HttpRequest, HttpResponse } from '../../../../shared/types';
import { compactDiff, diffLines } from './diff';

describe('htmlToText', () => {
	it('keeps headings, paragraphs and lists, drops chrome', () => {
		const html = `<html><head><title>T &amp; co</title><style>x{}</style></head><body>
			<nav>menu</nav><h1>Big</h1><p>Hello&nbsp;<b>world</b> &#8212; ok</p>
			<ul><li>one</li><li>two</li></ul><script>evil()</script><footer>foot</footer></body></html>`;
		const { title, text } = htmlToText(html);
		expect(title).toBe('T & co');
		expect(text).toBe('# Big\n\nHello world — ok\n\n- one\n\n- two');
	});

	it('truncates long pages', () => {
		expect(htmlToText(`<p>${'a'.repeat(100)}</p>`, 10).text).toMatch(
			/^a{10}\n\n\[… page truncated\]$/
		);
	});
});

describe('parseDuckDuckGo', () => {
	it('unwraps redirect links, pairs snippets, drops ads', () => {
		const html = `
			<div class="result results_links result--ad">
				<a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">Ad</a>
				<a class="result__snippet" href="#">buy now</a>
			</div>
			<div class="result results_links">
				<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&amp;rut=z">Example <b>Domain</b></a>
				<a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">An <b>example</b> &amp; more</a>
			</div>
			<div class="result"><a class="result__a" href="https://plain.org/">Plain</a></div>`;
		expect(parseDuckDuckGo(html)).toEqual([
			{ title: 'Example Domain', url: 'https://example.com/a?b=1', snippet: 'An example & more' },
			{ title: 'Plain', url: 'https://plain.org/', snippet: '' }
		]);
		expect(parseSearch('duckduckgo', html)).toHaveLength(2);
	});
});

describe('parseSearch', () => {
	it('reads SearXNG and Brave shapes', () => {
		const searx = JSON.stringify({
			results: [{ title: 'A', url: 'https://a', content: '<b>x</b>' }]
		});
		expect(parseSearch('searxng', searx)).toEqual([{ title: 'A', url: 'https://a', snippet: 'x' }]);
		const brave = JSON.stringify({
			web: { results: [{ title: 'B', url: 'https://b', description: 'y' }] }
		});
		expect(formatResults(parseSearch('brave', brave))).toBe('1. B\n   https://b\n   y');
	});
});

describe('webSearch', () => {
	const brave = { kind: 'brave' as const, baseUrl: '' };
	function fakeHttp(res: HttpResponse) {
		const sent: HttpRequest[] = [];
		return { sent, http: { httpFetch: async (r: HttpRequest) => (sent.push(r), res) } };
	}

	it('asks for a key before calling Brave without one', async () => {
		const { sent, http } = fakeHttp({ status: 200, headers: {}, body: '{}' });
		await expect(webSearch(http, brave, null, 'x')).rejects.toThrow(
			/Brave Search needs an API key/
		);
		await expect(webSearch(http, brave, '  ', 'x')).rejects.toThrow(/needs an API key/);
		expect(sent).toHaveLength(0);
	});

	it('sends the trimmed key and a query Brave accepts', async () => {
		const body = JSON.stringify({ web: { results: [{ title: 'T', url: 'https://t' }] } });
		const { sent, http } = fakeHttp({ status: 200, headers: {}, body });
		const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
		expect(await webSearch(http, brave, ' key \n', long, 30)).toHaveLength(1);
		const url = new URL(sent[0].url);
		expect(sent[0].headers?.['X-Subscription-Token']).toBe('key');
		expect(url.searchParams.get('q')!.split(' ')).toHaveLength(50);
		expect(url.searchParams.get('count')).toBe('20');
	});

	it("shows Brave's error detail", async () => {
		const body = JSON.stringify({
			error: {
				code: 'SUBSCRIPTION_TOKEN_INVALID',
				detail: 'The provided subscription token is invalid.',
				status: 422
			},
			type: 'ErrorResponse'
		});
		const { http } = fakeHttp({ status: 422, headers: {}, body });
		await expect(webSearch(http, brave, 'bad', 'x')).rejects.toThrow(
			'Search failed (422): The provided subscription token is invalid. Check the key in Settings → AI → Web search.'
		);
		expect(
			searchError(
				JSON.stringify({
					error: {
						code: 'VALIDATION',
						detail: 'Unable to validate request parameter(s)',
						meta: { errors: [{ loc: ['query', 'q'], msg: 'too long' }] }
					}
				})
			)
		).toBe('Unable to validate request parameter(s) (query q: too long)');
		expect(searchError(JSON.stringify({ detail: { error: 'Unauthorized' } }))).toBe('Unauthorized');
		expect(searchError('<html>bad gateway</html>')).toBe('<html>bad gateway</html>');
	});
});

describe('diffLines', () => {
	it('marks added and removed lines', () => {
		expect(diffLines('a\nb\nc', 'a\nB\nc\nd')).toEqual([
			{ op: 'same', text: 'a' },
			{ op: 'del', text: 'b' },
			{ op: 'add', text: 'B' },
			{ op: 'same', text: 'c' },
			{ op: 'add', text: 'd' }
		]);
	});

	it('collapses unchanged runs', () => {
		const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
		const after = before.replace('l10', 'X');
		const c = compactDiff(diffLines(before, after), 1);
		expect(c).toEqual([
			{ op: 'gap', count: 9 },
			{ op: 'same', text: 'l9' },
			{ op: 'del', text: 'l10' },
			{ op: 'add', text: 'X' },
			{ op: 'same', text: 'l11' },
			{ op: 'gap', count: 8 }
		]);
	});
});
