import { describe, expect, it } from 'vitest';
import { layoutFor } from './layout';

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
