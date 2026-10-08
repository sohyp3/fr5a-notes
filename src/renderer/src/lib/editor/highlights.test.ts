import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import {
	applyRange,
	coveredRanges,
	findHighlights,
	highlightComment,
	parseHighlight
} from './highlights';
import { highlightPlugin, toggleHighlight } from './HighlightBehavior';

describe('highlight comments', () => {
	it('parses the whole-line and ranged forms', () => {
		expect(parseHighlight('<!-- highlight -->')).toEqual({ ranges: null });
		expect(parseHighlight(' <!--highlight: 4-12, 20 - 25-->')).toEqual({
			ranges: [
				[4, 12],
				[20, 25]
			]
		});
		expect(parseHighlight('<!-- highlight: abc -->')).toBeNull();
		expect(parseHighlight('<!-- highlights -->')).toBeNull();
		expect(highlightComment([[1, 3]])).toBe('<!-- highlight: 1-3 -->');
	});

	it('marks the line below, or above when no text follows', () => {
		const lines = [
			'<!-- highlight -->',
			'one',
			'two',
			'<!-- highlight: 0-1 -->',
			'',
			'three',
			'<!-- highlight -->',
			'four',
			'',
			'<!-- highlight -->',
			''
		];
		expect(findHighlights(lines).map((h) => [h.comment, h.target])).toEqual([
			[0, 1],
			[3, 2],
			[6, 7]
		]);
		expect(findHighlights(['```', '<!-- highlight -->', 'x', '```'])).toEqual([]);
	});

	it('leaves the block prefix out of a whole-line highlight', () => {
		expect(coveredRanges('- item  ', [null])).toEqual([[2, 6]]);
		expect(coveredRanges('## Head', [[[0, 4]], null])).toEqual([[0, 7]]);
	});

	it('adds, clears and folds stretches into a whole line', () => {
		const text = 'hello world';
		expect(applyRange(text, [], 0, 5, true)).toEqual([[0, 5]]);
		expect(applyRange(text, [[0, 5]], 5, 11, true)).toBeNull();
		expect(applyRange(text, [[0, 11]], 2, 4, false)).toEqual([
			[0, 2],
			[4, 11]
		]);
		expect(applyRange(text, [[0, 5]], 0, 5, false)).toBeUndefined();
	});
});

// --- editing, on a bare ProseMirror state (one paragraph per line) ---------------

const schema = new Schema({
	nodes: {
		doc: { content: 'paragraph+' },
		paragraph: { content: 'text*', toDOM: () => ['p', 0] },
		text: {}
	}
});

function stateOf(text: string): EditorState {
	const doc = schema.node(
		'doc',
		null,
		text.split('\n').map((l) => schema.node('paragraph', null, l ? schema.text(l) : undefined))
	);
	return EditorState.create({ doc, plugins: [highlightPlugin()] });
}

const textOf = (s: EditorState) => {
	const out: string[] = [];
	s.doc.forEach((n) => out.push(n.textContent));
	return out.join('\n');
};

/** Position of `offset` in line `line`. */
function at(s: EditorState, line: number, offset: number): number {
	let pos = 1;
	for (let k = 0; k < line; k++) pos += s.doc.child(k).nodeSize;
	return pos + offset;
}

function toggle(s: EditorState, from: number, to = from): EditorState {
	let next = s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));
	toggleHighlight(next, (tr) => (next = next.apply(tr)));
	return next;
}

describe('toggling highlights', () => {
	it('marks the caret’s whole line, and clears it again', () => {
		const s = stateOf('a\n- item\nb');
		const on = toggle(s, at(s, 1, 3));
		expect(textOf(on)).toBe('a\n<!-- highlight -->\n- item\nb');
		expect(textOf(toggle(on, at(on, 2, 3)))).toBe('a\n- item\nb');
	});

	it('marks a selection as offsets, and merges with what is there', () => {
		const s = stateOf('hello brave world');
		const one = toggle(s, at(s, 0, 0), at(s, 0, 5));
		expect(textOf(one)).toBe('<!-- highlight: 0-5 -->\nhello brave world');
		const two = toggle(one, at(one, 1, 12), at(one, 1, 17));
		expect(textOf(two)).toBe('<!-- highlight: 0-5, 12-17 -->\nhello brave world');
		const cleared = toggle(two, at(two, 1, 1), at(two, 1, 3));
		expect(textOf(cleared)).toBe('<!-- highlight: 0-1, 3-5, 12-17 -->\nhello brave world');
	});

	it('marks each line of a selection across lines', () => {
		const s = stateOf('first line\nsecond line');
		const on = toggle(s, at(s, 0, 6), at(s, 1, 6));
		expect(textOf(on)).toBe(
			'<!-- highlight: 6-10 -->\nfirst line\n<!-- highlight: 0-6 -->\nsecond line'
		);
	});
});

describe('highlights follow edits', () => {
	const typed = (s: EditorState, pos: number, text: string) => s.apply(s.tr.insertText(text, pos));

	it('shifts offsets when text is typed before them, grows when typed inside', () => {
		const s = stateOf('<!-- highlight: 6-11 -->\nhello world');
		const before = typed(s, at(s, 1, 0), 'oh ');
		expect(textOf(before)).toBe('<!-- highlight: 9-14 -->\noh hello world');
		const inside = typed(before, at(before, 1, 11), 'XX');
		expect(textOf(inside)).toBe('<!-- highlight: 9-16 -->\noh hello woXXrld');
		const after = typed(inside, at(inside, 1, 16), '!');
		expect(textOf(after)).toBe('<!-- highlight: 9-16 -->\noh hello woXXrld!');
	});

	it('drops the comment when its text is deleted', () => {
		const s = stateOf('<!-- highlight: 0-3 -->\nabc def');
		const next = s.apply(s.tr.delete(at(s, 1, 0), at(s, 1, 4)));
		expect(textOf(next)).toBe('def');
	});

	it('leaves a hand edit of the comment alone', () => {
		const s = stateOf('<!-- highlight: 0-3 -->\nabc def');
		const next = s.apply(s.tr.insertText('7', at(s, 0, 18), at(s, 0, 19)));
		expect(textOf(next)).toBe('<!-- highlight: 0-7 -->\nabc def');
	});
});
