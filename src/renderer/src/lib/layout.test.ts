import { describe, expect, it } from 'vitest';
import { fitDesktopPanes, layoutFor } from './layout';

describe('layoutFor', () => {
	it('keeps mouse windows on the desktop layout at any width', () => {
		for (const w of [360, 720, 800, 1180, 2560]) expect(layoutFor(w, false)).toBe('desktop');
	});

	it('maps touch widths: phone, tablet portrait, tablet landscape', () => {
		expect(layoutFor(390, true)).toBe('phone'); // phone portrait
		expect(layoutFor(599, true)).toBe('phone');
		expect(layoutFor(600, true)).toBe('tablet');
		expect(layoutFor(844, true)).toBe('tablet'); // phone landscape
		expect(layoutFor(800, true)).toBe('tablet'); // tablet portrait
		expect(layoutFor(1023, true)).toBe('tablet');
		expect(layoutFor(1280, true)).toBe('desktop'); // tablet landscape
	});
});

describe('tag results pane fitting', () => {
	const mins = { side: 180, list: 220, ai: 300 };
	const requested = { side: 250, list: 300, ai: 0 };
	it('keeps navigation and results together when space permits', () => {
		expect(fitDesktopPanes(1100, requested, mins, true)).toEqual(requested);
	});
	it('gives the results priority over navigation at narrow desktop widths', () => {
		expect(fitDesktopPanes(700, requested, mins, true)).toEqual({ side: 0, list: 220, ai: 0 });
		expect(fitDesktopPanes(390, requested, mins, true).list).toBeGreaterThan(0);
		expect(fitDesktopPanes(390, requested, mins, true).side).toBe(0);
		// Hiding the results with the title-bar control reveals navigation again.
		expect(fitDesktopPanes(390, { ...requested, list: 0 }, mins).side).toBeGreaterThan(0);
	});
	it('preserves editor-first fitting outside the tag scope and handles AI pane', () => {
		expect(fitDesktopPanes(390, requested, mins).list).toBe(0);
		const fit900 = fitDesktopPanes(900, { ...requested, ai: 400 }, mins, true);
		expect(fit900.side).toBeGreaterThan(0);
		expect(fit900.list).toBeGreaterThan(0);
		expect(fit900.ai).toBe(0);
		const narrow = fitDesktopPanes(720, { ...requested, ai: 400 }, mins, true);
		expect(narrow.side).toBe(0);
		expect(narrow.list).toBeGreaterThan(0);
		expect(narrow.ai).toBe(0);
		expect(720 - narrow.side - narrow.list - narrow.ai - 40).toBeGreaterThanOrEqual(320);
		for (const width of [1100, 1280]) {
			const fit = fitDesktopPanes(width, { ...requested, ai: 400 }, mins, true);
			expect(fit.side).toBeGreaterThan(0);
			expect(fit.list).toBeGreaterThan(0);
			expect(fit.ai).toBeGreaterThan(0);
			expect(width - fit.side - fit.list - fit.ai - 40).toBeGreaterThanOrEqual(320);
		}
	});
});
