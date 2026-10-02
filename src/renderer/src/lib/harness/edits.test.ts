import { describe, expect, it } from 'vitest';
import { appendText, insertAfterLine, newNoteText, replaceText } from './edits';

describe('write_note edits', () => {
	it('appends with one blank line', () => {
		expect(appendText('# A\n\nbody\n\n\n', 'more')).toBe('# A\n\nbody\n\nmore\n');
		expect(appendText('', 'x')).toBe('x\n');
	});

	it('replaces the body but keeps metadata lines', () => {
		expect(replaceText('<!-- dir: rtl -->\n<!-- pinned: true -->\n# Old', '# New')).toBe(
			'<!-- dir: rtl -->\n<!-- pinned: true -->\n# New\n'
		);
		expect(replaceText('<!-- dir: rtl -->\nx', '<!-- dir: rtl -->\ny')).toBe(
			'<!-- dir: rtl -->\ny\n'
		);
	});

	it('inserts after the caret line', () => {
		expect(insertAfterLine('a\nb\nc', 0, 'X\nY')).toBe('a\nX\nY\nb\nc');
		expect(insertAfterLine('a', 9, 'X')).toBe('a\nX');
	});

	it('titles new notes', () => {
		expect(newNoteText('T', 'body')).toBe('# T\n\nbody\n');
		expect(newNoteText('T', '# Own\nbody')).toBe('# Own\nbody\n');
	});
});
