import { describe, it, expect } from 'vitest';
import { buildFolderTree } from './folders';
import type { NoteMeta } from '../../../shared/types';

function note(id: string): NoteMeta {
	return {
		id,
		absPath: '/' + id,
		title: id,
		snippet: '',
		mtime: 0,
		tags: [],
		pinned: false,
		locked: false
	};
}

describe('buildFolderTree', () => {
	it('nests sub-directories and counts descendants', () => {
		const tree = buildFolderTree([
			note('root.md'), // root note → no folder node
			note('work/a.md'),
			note('work/project1/b.md'),
			note('work/project1/c.md')
		]);

		expect(tree).toHaveLength(1);
		const work = tree[0];
		expect(work.path).toBe('work');
		expect(work.count).toBe(3); // a + b + c
		const p1 = work.children.find((n) => n.name === 'project1')!;
		expect(p1.path).toBe('work/project1');
		expect(p1.count).toBe(2);
	});

	it('ignores root-level notes (covered by All Notes)', () => {
		expect(buildFolderTree([note('a.md'), note('b.md')])).toEqual([]);
	});

	it('sorts sibling folders alphabetically', () => {
		const tree = buildFolderTree([note('zeta/x.md'), note('alpha/y.md')]);
		expect(tree.map((n) => n.name)).toEqual(['alpha', 'zeta']);
	});

	it('materialises explicit empty folders (count 0)', () => {
		const tree = buildFolderTree([], ['ideas', 'work/drafts']);
		expect(tree.map((n) => n.name)).toEqual(['ideas', 'work']);
		const ideas = tree.find((n) => n.name === 'ideas')!;
		expect(ideas.count).toBe(0);
		const drafts = tree.find((n) => n.name === 'work')!.children[0];
		expect(drafts.path).toBe('work/drafts');
		expect(drafts.count).toBe(0);
	});
});
