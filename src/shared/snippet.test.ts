import { describe, expect, it } from 'vitest';
import { noteSnippet } from './snippet';

describe('noteSnippet', () => {
	it('drops Markdown syntax but keeps hyphenated words', () => {
		expect(
			noteSnippet('# Title\n\n*AI chat · 2026-10-03 · well-known*\n- item one\n---\n> quoted #tag')
		).toBe('AI chat · 2026-10-03 · well-known item one quoted tag');
	});

	it('reads tables as their cells', () => {
		expect(noteSnippet('# T\n| Plan | Price |\n|---|--:|\n| **Lite** | 10k |')).toBe(
			'Plan Price Lite 10k'
		);
	});

	it('strips task boxes and ordered markers', () => {
		expect(noteSnippet('1. first\n- [x] done')).toBe('first done');
	});

	it('drops images, comment lines and spaced rules', () => {
		expect(
			noteSnippet(
				'# T\n![chart](assets/a.png)\n<!-- size: 50% -->\n<!-- highlight: 0-4 -->\nkeep this\n* * *\nend'
			)
		).toBe('keep this end');
	});
});
