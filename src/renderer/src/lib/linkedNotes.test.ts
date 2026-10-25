import { describe, expect, it } from 'vitest';
import type { NoteMeta } from '../../../shared/types';
import {
	buildNoteGraph,
	isNoteHref,
	layoutGraph,
	parseNoteLinks,
	resolveNoteHref
} from './linkedNotes';
import { relativeLink } from './editor/images';

const note = (id: string, title = id.replace(/\.md$/, ''), tags: string[] = []): NoteMeta => ({
	id,
	absPath: `/${id}`,
	title,
	snippet: '',
	mtime: 0,
	tags,
	pinned: false,
	locked: false,
	aiLocal: false,
	encrypted: false
});

describe('linked notes', () => {
	it('parses Markdown note links, in order; [[…]] is plain text', () => {
		expect(
			parseNoteLinks('See [the spec](work/spec.md), [[Ideas]] and [plan](../plan.md).')
		).toEqual([
			{ target: 'work/spec.md', label: 'the spec' },
			{ target: '../plan.md', label: 'plan' }
		]);
	});

	it('leaves web links, images and non-note files out', () => {
		expect(
			parseNoteLinks(
				'[site](https://x.com/a.md) ![pic](a.md) [img](assets/a.png) [ok](<My note.md> "title")'
			)
		).toEqual([{ target: 'My note.md', label: 'ok' }]);
		expect(isNoteHref('../a%20b.md#part')).toBe(true);
		expect(isNoteHref('mailto:a.md')).toBe(false);
	});

	it('skips links inside inline and fenced code', () => {
		expect(
			parseNoteLinks(
				'`[i](inline.md)` and [r](real.md)\n```\n[x](fenced.md)\n```\n~~~md\n[t](tilde.md)\n~~~\n[a](after.md)'
			).map((l) => l.target)
		).toEqual(['real.md', 'after.md']);
	});

	it('resolves note paths from the note’s folder, then the root, then by name', () => {
		const notes = [note('a/b/target note.md'), note('top.md'), note('moved/away.md')];
		expect(resolveNoteHref(notes, 'b/target%20note.md', 'a/src.md')?.id).toBe('a/b/target note.md');
		expect(resolveNoteHref(notes, '../top.md', 'a/src.md')?.id).toBe('top.md');
		expect(resolveNoteHref(notes, '/a/b/target%20note.md', 'x/y.md')?.id).toBe(
			'a/b/target note.md'
		);
		expect(resolveNoteHref(notes, 'a/b/target note.md', 'z/src.md')?.id).toBe('a/b/target note.md');
		expect(resolveNoteHref(notes, 'old/away.md', 'src.md')?.id).toBe('moved/away.md');
		expect(resolveNoteHref(notes, 'nothing.md', 'src.md')).toBeNull();
	});

	it('writes a link that resolves back to the note', () => {
		const md = `[My draft](${relativeLink('a/x', 'a/b/my (draft).md')})`;
		expect(md).toBe('[My draft](../b/my%20%28draft%29.md)');
		const [link] = parseNoteLinks(md);
		expect(resolveNoteHref([note('a/b/my (draft).md')], link.target, 'a/x/src.md')?.id).toBe(
			'a/b/my (draft).md'
		);
	});

	it('resolves Arabic, spaces, parentheses and escaped reserved path characters after moves', () => {
		const moved = note('Archive/بحث (نسخة) #1.md');
		const href = 'Old/%D8%A8%D8%AD%D8%AB%20%28%D9%86%D8%B3%D8%AE%D8%A9%29%20%231.md';
		expect(resolveNoteHref([moved], href, 'Maps/Atlas.md')?.id).toBe(moved.id);
		expect(parseNoteLinks('[Draft](draft(1).md)')).toEqual([
			{ target: 'draft(1).md', label: 'Draft' }
		]);
	});

	it('joins notes to their tags and nested tags to their parent', () => {
		const graph = buildNoteGraph(
			[note('a.md', 'A', ['work/x']), note('b.md', 'B', ['work'])],
			new Map([
				['a.md', '[B](b.md) [again](./b.md) [[B]] [gone](Missing%20one.md)'],
				['b.md', '']
			])
		);
		expect(graph.edges).toEqual([
			{ from: 'a.md', to: 'b.md', kind: 'link' },
			{ from: 'a.md', to: '?missing one', kind: 'link' },
			{ from: '#work/x', to: '#work', kind: 'nest' },
			{ from: 'a.md', to: '#work/x', kind: 'tag' },
			{ from: 'b.md', to: '#work', kind: 'tag' }
		]);
		const byId = new Map(graph.nodes.map((n) => [n.id, n]));
		expect(byId.get('#work/x')).toMatchObject({ kind: 'tag', title: 'x', degree: 2 });
		expect(byId.get('?missing one')).toMatchObject({ kind: 'missing', title: 'Missing one' });
		expect(byId.get('a.md')).toMatchObject({ degree: 3, links: 2 });
	});

	it('lays the graph out deterministically, linked notes close together', async () => {
		const notes = Array.from({ length: 30 }, (_, i) => note(`n${i}.md`, `N${i}`, [`t${i % 3}`]));
		const contents = new Map(notes.map((n, i) => [n.id, i === 0 ? '[x](n1.md)' : '']));
		const a = buildNoteGraph(notes, contents);
		const b = buildNoteGraph(notes, contents);
		await layoutGraph(a);
		await layoutGraph(b);
		expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
		for (const n of a.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
		const at = new Map(a.nodes.map((n) => [n.id, n]));
		const dist = (p: string, q: string) =>
			Math.hypot(at.get(p)!.x - at.get(q)!.x, at.get(p)!.y - at.get(q)!.y);
		// A note sits nearer its own tag than another tag's hub.
		expect(dist('n3.md', '#t0')).toBeLessThan(dist('n3.md', '#t1'));
	});
});
