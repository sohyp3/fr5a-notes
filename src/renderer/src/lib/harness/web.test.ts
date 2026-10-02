import { describe, expect, it } from 'vitest';
import { formatResults, htmlToText, parseSearch } from './web';
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
