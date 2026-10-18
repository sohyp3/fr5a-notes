import { describe, it, expect } from 'vitest';
import { ACCENTS, DEFAULT_ACCENT, accentById, onColor } from './accents';

/** WCAG contrast between two `#rrggbb` colors (the modules' helpers are private). */
function contrast(a: string, b: string): number {
	const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
	const luminance = (hex: string): number => {
		const [r, g, b] = [0, 1, 2].map((i) => {
			const c = channel(hex, i) / 255;
			return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

describe('onColor', () => {
	it('keeps white for mid-tones where dark ink is no clearer', () => {
		expect(onColor('#d4433a')).toBe('#ffffff');
		expect(onColor('#2c76d5')).toBe('#ffffff');
		expect(onColor('#6b6862')).toBe('#ffffff');
	});

	it('switches to dark ink on bright fills', () => {
		expect(onColor('#c99700')).toBe('#1e1d1b');
		expect(onColor('#f0b429')).toBe('#1e1d1b');
		expect(onColor('#5fc27e')).toBe('#1e1d1b');
	});

	it('gives every palette fill an AA-contrast ink', () => {
		for (const accent of ACCENTS) {
			for (const hex of [accent.light, accent.dark])
				expect(contrast(hex, onColor(hex))).toBeGreaterThanOrEqual(4.5);
		}
		expect(
			contrast(accentById(DEFAULT_ACCENT).light, onColor(accentById(DEFAULT_ACCENT).light))
		).toBeGreaterThanOrEqual(4.5);
	});
});
