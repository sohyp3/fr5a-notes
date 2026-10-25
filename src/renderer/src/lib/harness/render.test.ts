import { describe, expect, it } from 'vitest';
import {
	asJson,
	highlightJson,
	renderInline,
	renderMarkdown,
	renderReply,
	renderReplyBlocks,
	type RenderedReply
} from './render';

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

	it('renders a compact one-line fence without treating its content as a language', () => {
		const html = renderMarkdown('``` code block ```');
		expect(html).toContain('<span>text</span>');
		expect(html).toContain('<pre><code>code block</code></pre>');
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

/** Small seeded PRNG, so a failure replays. */
function rng(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('renderReplyBlocks', () => {
	const reply = [
		'# Title',
		'Intro **bold** line',
		'second a|b line',
		'| a | b |',
		'|---|---|',
		'| 1 | 2 |',
		'',
		'- one',
		'',
		'- two',
		'  more of two',
		'1. first',
		'---',
		'> quoted',
		'> still',
		'',
		'```ts',
		'const x = 1;',
		'',
		'```',
		'``` inline ```',
		'tail *em*',
		'{"not": "json"}'
	].join('\n');

	it('matches renderReply at every point of a stream', () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const rand = rng(seed);
			let prev: RenderedReply | undefined;
			for (let at = 0; at < reply.length;) {
				at = Math.min(reply.length, at + 1 + Math.floor(rand() * 12));
				const text = reply.slice(0, at);
				prev = renderReplyBlocks(text, prev);
				expect(prev.html.join(''), `seed ${seed} at ${at}`).toBe(renderReply(text));
			}
		}
	});

	it('keeps settled blocks and starts over on a non-append', () => {
		const a = renderReplyBlocks('# A\n\npara\n\nmore\n\nx');
		const b = renderReplyBlocks('# A\n\npara\n\nmore\n\nxy', a);
		expect(b.html[0]).toBe(a.html[0]);
		expect(renderReplyBlocks('{"a":1}', b).html.join('')).toBe(renderReply('{"a":1}'));
	});
});
