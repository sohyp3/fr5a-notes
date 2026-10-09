import { describe, expect, it } from 'vitest';
import { BAR_ITEMS, defaultSpot, fitBar, spotOf } from './noteBar';

describe('note toolbar placement', () => {
	it('defaults to the bars as they were: phones keep note extras in ⋯, touch shows Highlight', () => {
		const bar = (phone: boolean, touch: boolean) =>
			BAR_ITEMS.filter((id) => defaultSpot(id, phone, touch) === 'bar');
		const format = ['bold', 'heading', 'list', 'outdent', 'indent', 'tag', 'undo'];
		expect(bar(false, false)).toEqual([
			'insert',
			'edit',
			'ai',
			'pin',
			'dir',
			'lock',
			'changes',
			'trash',
			...format
		]);
		expect(bar(false, true)).toEqual([
			'insert',
			'highlight',
			'edit',
			'ai',
			'pin',
			'dir',
			'lock',
			'changes',
			'trash',
			...format
		]);
		expect(bar(true, true)).toEqual(['insert', 'highlight', 'edit', 'ai', 'pin', ...format]);
	});

	it('a choice wins over the default; anything malformed falls back to it', () => {
		expect(spotOf({ highlight: 'bar' }, 'highlight', false, false)).toBe('bar');
		expect(spotOf({ pin: 'menu' }, 'pin', true, true)).toBe('menu');
		expect(spotOf({ pin: 'nowhere' }, 'pin', false, false)).toBe('bar');
		expect(spotOf(null, 'trash', true, true)).toBe('menu');
		expect(spotOf('bar', 'trash', true, true)).toBe('menu');
	});
});

describe('fitBar', () => {
	it('keeps every button while they fit, with or without the menu button', () => {
		expect(fitBar([30, 30, 30], 102, 30, 4, false)).toBe(3);
		expect(fitBar([30, 30, 30], 136, 30, 4, true)).toBe(3);
	});

	it('folds from the end, leaving room for the menu button', () => {
		// 3 × 34 = 102 > 100: the menu button (30) is needed, so only 2 fit.
		expect(fitBar([30, 30, 30], 100, 30, 4, false)).toBe(2);
		expect(fitBar([30, 30, 30], 130, 30, 4, true)).toBe(2);
		expect(fitBar([84, 44, 44], 120, 44, 4, true)).toBe(0);
	});

	it('folds everything when there is no room at all', () => {
		expect(fitBar([30, 30], -20, 30, 4, true)).toBe(0);
	});
});
