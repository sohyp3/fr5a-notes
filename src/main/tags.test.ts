import { describe, it, expect } from 'vitest';
import { parseTags, buildTagTree } from './tags';

describe('parseTags', () => {
	it('extracts simple and nested tags', () => {
		const tags = parseTags('a #work note about #work/project1 and #personal/journal/2024');
		expect(tags).toEqual(['work', 'work/project1', 'personal/journal/2024']);
	});

	it('requires whitespace or start-of-string before the hash', () => {
		// URLs and CSS colors must not register as tags.
		expect(parseTags('see https://x.com#anchor and color #fff0')).toEqual(['fff0']);
		expect(parseTags('inline`#nope`')).toEqual([]);
	});

	it('deduplicates repeated tags', () => {
		expect(parseTags('#work then #work again')).toEqual(['work']);
	});

	it('ignores a hash with no word after it', () => {
		expect(parseTags('a lone # symbol')).toEqual([]);
	});

	it('supports Unicode (Arabic) tags, including nesting', () => {
		expect(parseTags('موسوم بـ #عمل و #عربي/تجربة')).toEqual(['عمل', 'عربي/تجربة']);
	});
});

describe('buildTagTree', () => {
	it('nests tags and counts each note toward every prefix', () => {
		const tree = buildTagTree([
			{ tag: 'work/project1', noteId: 'a' },
			{ tag: 'work/project2', noteId: 'b' },
			{ tag: 'work/project1', noteId: 'c' }
		]);

		expect(tree).toHaveLength(1);
		const work = tree[0];
		expect(work.name).toBe('work');
		expect(work.path).toBe('work');
		// Three distinct notes carry a `work/*` tag.
		expect(work.count).toBe(3);
		expect(work.children.map((c) => c.name)).toEqual(['project1', 'project2']);

		const project1 = work.children.find((c) => c.name === 'project1')!;
		expect(project1.path).toBe('work/project1');
		expect(project1.count).toBe(2); // notes a + c
	});

	it('does not double-count a note tagged twice under the same prefix', () => {
		const tree = buildTagTree([
			{ tag: 'work/a', noteId: 'n1' },
			{ tag: 'work/b', noteId: 'n1' }
		]);
		expect(tree[0].count).toBe(1); // one distinct note, despite two work/* tags
	});

	it('sorts siblings alphabetically', () => {
		const tree = buildTagTree([
			{ tag: 'zeta', noteId: 'a' },
			{ tag: 'alpha', noteId: 'b' }
		]);
		expect(tree.map((n) => n.name)).toEqual(['alpha', 'zeta']);
	});
});
