import { describe, expect, it } from 'vitest';
import { asJson, highlightJson, renderInline, renderMarkdown, renderReply } from './render';

describe('renderInline', () => {
	it('renders emphasis, code and safe links', () => {
		expect(renderInline('**b** *i* ~~s~~ `x*y*`')).toBe(
			'<strong>b</strong> <em>i</em> <del>s</del> <code>x*y*</code>'
		);
		expect(renderInline('[site](https://a.b/c?d=1&e=2)')).toBe(
			'<a href="https://a.b/c?d=1&amp;e=2" target="_blank" rel="noreferrer noopener">site</a>'
		);
		expect(renderInline('see https://x.io/a.')).toContain('href="https://x.io/a"');
	});

	it('never lets raw HTML or unsafe links through', () => {
		expect(renderInline('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
		expect(renderInline('[x](javascript:alert(1))')).not.toContain('href');
		expect(renderInline('`<b>`')).toBe('<code>&lt;b&gt;</code>');
		expect(renderInline('"\'')).toBe('&quot;&#39;');
	});

	it('leaves snake_case and lone stars alone', () => {
		expect(renderInline('a_b_c and 2 * 3 * 4')).toBe('a_b_c and 2 * 3 * 4');
	});

	it('keeps code inside link labels', () => {
		expect(renderInline('[`run`](https://x.io)')).toContain('><code>run</code></a>');
	});
});

describe('renderMarkdown', () => {
	it('renders headings, paragraphs and rules', () => {
		expect(renderMarkdown('# Title\n\nline one\nline two\n\n---')).toBe(
			'<h1>Title</h1><p>line one<br>line two</p><hr>'
		);
	});

	it('renders nested and task lists', () => {
		const html = renderMarkdown('- a\n  - b\n- [x] done\n\n1. one\n2. two');
		expect(html).toBe(
			'<ul><li>a<ul><li>b</li></ul></li><li class="task"><input type="checkbox" disabled checked> done</li></ul>' +
				'<ol><li>one</li><li>two</li></ol>'
		);
	});

	it('renders fenced code (also unterminated, while streaming)', () => {
		const html = renderMarkdown('```js\nif (a < b) {}\n');
		expect(html).toContain('<span>js</span>');
		expect(html).toContain('<pre><code>if (a &lt; b) {}</code></pre>');
	});

	it('renders quotes and tables', () => {
		expect(renderMarkdown('> **q**')).toBe('<blockquote><p><strong>q</strong></p></blockquote>');
		const t = renderMarkdown('| a | b |\n|---|--:|\n| 1 | 2 |');
		expect(t).toContain('<th>a</th><th style="text-align:right">b</th>');
		expect(t).toContain('<td>1</td><td style="text-align:right">2</td>');
	});

	it('escapes HTML blocks', () => {
		expect(renderMarkdown('<script>alert(1)</script>')).toBe(
			'<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
		);
	});
});

describe('JSON', () => {
	it('pretty-prints a JSON reply', () => {
		expect(asJson('{"a":1}')).toBe('{\n  "a": 1\n}');
		expect(asJson('not json')).toBeNull();
		expect(renderReply('[1, true]')).toContain('<span class="j-num">1</span>');
	});

	it('highlights keys, strings and literals, escaped', () => {
		expect(highlightJson('{"k": "<v>", "n": null}')).toBe(
			'{<span class="j-key">&quot;k&quot;</span>: <span class="j-str">&quot;&lt;v&gt;&quot;</span>, ' +
				'<span class="j-key">&quot;n&quot;</span>: <span class="j-lit">null</span>}'
		);
	});
});
