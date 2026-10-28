import { describe, expect, it } from 'vitest';
import { freePosition, snapPoint } from './placement';
import { tidyLayout } from './tidy';

describe('map placement', () => {
	it('finds room for mixed card sizes and keeps snapped additions on the grid', () => {
		const occupied = [{ x: 0, y: 0, width: 500, height: 300 }];
		for (let i = 0; i < 35; i++) {
			const size = { width: i % 2 ? 240 : 180, height: i % 3 ? 72 : 180 };
			const p = freePosition({ x: 3, y: 7, ...size }, occupied, true);
			expect(Math.abs(p.x % 20)).toBe(0);
			expect(Math.abs(p.y % 20)).toBe(0);
			for (const r of occupied)
				expect(
					p.x + size.width + 24 <= r.x ||
						r.x + r.width + 24 <= p.x ||
						p.y + size.height + 24 <= r.y ||
						r.y + r.height + 24 <= p.y
				).toBe(true);
			occupied.push({ ...p, ...size });
		}
	});
	it('rounds negative coordinates consistently', () => {
		expect(snapPoint({ x: -33, y: 27 })).toEqual({ x: -40, y: 20 });
	});
	it('tidies connected and disconnected cards without overlap, preserving the origin', async () => {
		const items = Array.from({ length: 12 }, (_, i) => ({
			id: String(i),
			x: 100,
			y: -50,
			width: i % 2 ? 300 : 180,
			height: i % 3 ? 80 : 220
		}));
		const result = await tidyLayout(items, [
			{ source: '0', target: '1' },
			{ source: '0', target: '2' },
			{ source: '2', target: '3' },
			{ source: '4', target: '5' }
		]);
		expect(Math.min(...[...result.values()].map((p) => p.x))).toBe(100);
		expect(Math.min(...[...result.values()].map((p) => p.y))).toBe(-50);
		for (let i = 0; i < items.length; i++)
			for (let j = i + 1; j < items.length; j++) {
				const a = { ...items[i], ...result.get(items[i].id)! },
					b = { ...items[j], ...result.get(items[j].id)! };
				expect(
					a.x + a.width <= b.x ||
						b.x + b.width <= a.x ||
						a.y + a.height <= b.y ||
						b.y + b.height <= a.y
				).toBe(true);
			}
		expect(await tidyLayout([], [])).toEqual(new Map());
	});
});
