import { describe, it, expect } from 'vitest';
import {
	textToDoc,
	detectDir,
	setDir,
	detectPinned,
	setPinned,
	detectLocked,
	setLocked
} from './markdown';

describe('textToDoc', () => {
	it('maps each line to a paragraph so the buffer is the Markdown', () => {
		const doc = textToDoc('# Title\n\nbody text');
		expect(doc.type).toBe('doc');
		expect(doc.content).toHaveLength(3);
		expect(doc.content![0]).toEqual({
			type: 'paragraph',
			content: [{ type: 'text', text: '# Title' }]
		});
		// Blank line becomes an empty paragraph (no text node).
		expect(doc.content![1]).toEqual({ type: 'paragraph' });
		expect(doc.content![2].content![0].text).toBe('body text');
	});

	it('normalises CRLF line endings', () => {
		const doc = textToDoc('a\r\nb');
		expect(doc.content).toHaveLength(2);
		expect(doc.content![0].content![0].text).toBe('a');
		expect(doc.content![1].content![0].text).toBe('b');
	});

	it('represents an empty file as a single empty paragraph', () => {
		const doc = textToDoc('');
		expect(doc.content).toEqual([{ type: 'paragraph' }]);
	});
});

describe('directionality metadata', () => {
	it('detects the dir comment on the first lines', () => {
		expect(detectDir('<!-- dir: rtl -->\n# مرحبا')).toBe('rtl');
		expect(detectDir('<!--dir:ltr-->\nhi')).toBe('ltr');
		expect(detectDir('# just a note')).toBeNull();
	});

	it('prepends a dir comment when none exists', () => {
		expect(setDir('# hi', 'rtl')).toBe('<!-- dir: rtl -->\n# hi');
	});

	it('replaces an existing dir comment in place', () => {
		const src = '<!-- dir: ltr -->\n# hi';
		expect(setDir(src, 'rtl')).toBe('<!-- dir: rtl -->\n# hi');
		// round-trip stays stable (no duplicate comments)
		expect(setDir(setDir(src, 'rtl'), 'ltr')).toBe('<!-- dir: ltr -->\n# hi');
	});
});

describe('pinning metadata', () => {
	it('detects the pinned flag', () => {
		expect(detectPinned('<!-- pinned: true -->\n# hi')).toBe(true);
		expect(detectPinned('# hi')).toBe(false);
	});

	it('adds and removes the pin comment cleanly', () => {
		const pinned = setPinned('# hi', true);
		expect(pinned).toBe('<!-- pinned: true -->\n# hi');
		expect(setPinned(pinned, false)).toBe('# hi');
	});

	it('keeps the pin marker below a dir comment', () => {
		const src = '<!-- dir: rtl -->\n# مرحبا';
		expect(setPinned(src, true)).toBe('<!-- dir: rtl -->\n<!-- pinned: true -->\n# مرحبا');
	});

	it('is idempotent when already pinned', () => {
		const once = setPinned('# hi', true);
		expect(setPinned(once, true)).toBe(once);
	});
});

describe('locking metadata', () => {
	it('detects the locked flag', () => {
		expect(detectLocked('<!-- locked: true -->\n# hi')).toBe(true);
		expect(detectLocked('<!-- locked: false -->\n# hi')).toBe(false);
		expect(detectLocked('# hi')).toBe(false);
	});

	it('adds and removes the lock comment cleanly', () => {
		const locked = setLocked('# hi', true);
		expect(locked).toBe('<!-- locked: true -->\n# hi');
		expect(setLocked(locked, false)).toBe('# hi');
	});

	it('keeps the lock marker below dir and pinned comments', () => {
		const src = '<!-- dir: rtl -->\n<!-- pinned: true -->\n# مرحبا';
		expect(setLocked(src, true)).toBe(
			'<!-- dir: rtl -->\n<!-- pinned: true -->\n<!-- locked: true -->\n# مرحبا'
		);
	});

	it('is idempotent when already locked', () => {
		const once = setLocked('# hi', true);
		expect(setLocked(once, true)).toBe(once);
	});
});
