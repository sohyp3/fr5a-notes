import { describe, expect, it } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter';

describe('frontmatter', () => {
	it('parses scalars and lists, and round-trips quoted values', () => {
		const text = stringifyFrontmatter({ name: 'a: b', tools: ['x', 'y, z'], empty: [] }) + 'body';
		expect(parseFrontmatter(text)).toEqual({
			data: { name: 'a: b', tools: ['x', 'y, z'], empty: [] },
			body: 'body'
		});
	});

	it('returns the whole text as body without a header', () => {
		expect(parseFrontmatter('# hi')).toEqual({ data: {}, body: '# hi' });
	});
});
