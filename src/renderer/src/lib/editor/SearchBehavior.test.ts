import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { searchMatches } from './SearchBehavior';

const schema = new Schema({
	nodes: {
		doc: { content: 'paragraph+' },
		paragraph: { content: 'text*' },
		text: {}
	}
});

const doc = (...lines: string[]) =>
	schema.node(
		'doc',
		null,
		lines.map((line) => schema.node('paragraph', null, schema.text(line)))
	);

describe('in-note search', () => {
	it('finds every literal match case-insensitively and maps document positions', () => {
		expect(searchMatches(doc('Alpha alpha', 'beta ALPHA'), 'alpha')).toEqual([
			{ from: 1, to: 6 },
			{ from: 7, to: 12 },
			{ from: 19, to: 24 }
		]);
	});

	it('treats punctuation literally and ignores a blank query', () => {
		expect(searchMatches(doc('a.b a-b a.b'), 'a.b')).toEqual([
			{ from: 1, to: 4 },
			{ from: 9, to: 12 }
		]);
		expect(searchMatches(doc('anything'), '   ')).toEqual([]);
	});
});
