import { describe, expect, it } from 'vitest';
import type { NoteMeta } from '../../../shared/types';
import { buildNoteGraph, parseWikiLinks, resolveWikiLink } from './linkedNotes';

const note = (id: string, title = id.replace(/\.md$/, '')): NoteMeta => ({
	id,
	absPath: `/${id}`,
	title,
	snippet: '',
	mtime: 0,
	tags: [],
	pinned: false,
	locked: false,
	aiLocal: false,
	encrypted: false
});

describe('linked notes', () => {
	it('parses wiki targets and aliases', () => {
		expect(parseWikiLinks('See [[Ideas]] and [[work/spec|the spec]].')).toEqual([
			{ target: 'Ideas', label: 'Ideas' },
			{ target: 'work/spec', label: 'the spec' }
		]);
	});

	it('skips links inside inline and fenced code', () => {
		expect(
			parseWikiLinks(
				'`[[Inline]]` and [[Real]]\n```\n[[Fenced]]\n```\n~~~md\n[[Tilde]]\n~~~\n[[After]]'
			)
		).toEqual([
			{ target: 'Real', label: 'Real' },
			{ target: 'After', label: 'After' }
		]);
	});

	it('prefers a note beside the source before a same-named root note', () => {
		const notes = [note('Plan.md'), note('work/Plan.md')];
		expect(resolveWikiLink(notes, 'Plan', 'work/Meeting.md')?.id).toBe('work/Plan.md');
	});

	it('deduplicates edges and keeps unresolved links visible', () => {
		const notes = [note('a.md', 'A'), note('b.md', 'B')];
		const graph = buildNoteGraph(
			notes,
			new Map([
				['a.md', '[[B]] [[B]] [[Missing]]'],
				['b.md', '']
			])
		);
		expect(graph.edges).toEqual([
			{ from: 'a.md', to: 'b.md' },
			{ from: 'a.md', to: '?missing' }
		]);
		expect(graph.nodes.find((n) => n.id === '?missing')?.missing).toBe(true);
	});
});
