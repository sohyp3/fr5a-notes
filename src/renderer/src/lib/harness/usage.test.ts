import { describe, expect, it } from 'vitest';
import {
	addUsage,
	formatRecord,
	formatTokens,
	formatUsd,
	parseRecord,
	readUsage,
	recordCost,
	runRecord,
	usageLine,
	usageReport,
	type UsageRecord
} from './usage';

const rec = (at: string, over: Partial<UsageRecord> = {}): UsageRecord => ({
	at,
	provider: 'p',
	model: 'm',
	input: 1000,
	output: 100,
	cost: 0.01,
	...over
});

describe('usage', () => {
	it('reads OpenAI-style usage, with an optional reported cost', () => {
		expect(readUsage({ prompt_tokens: 10, completion_tokens: 2 })).toEqual({
			input: 10,
			output: 2
		});
		expect(readUsage({ prompt_tokens: 10, completion_tokens: 2, cost: 0.5 })).toEqual({
			input: 10,
			output: 2,
			cost: 0.5
		});
		expect(readUsage({ input_tokens: 3, output_tokens: 4 })).toEqual({ input: 3, output: 4 });
		expect(readUsage(null)).toBeNull();
		expect(readUsage({ total: 3 })).toBeNull();
	});

	it('sums usage; the cost stays known only while every call had one', () => {
		const a = addUsage(null, { input: 1, output: 2, cost: 0.1 });
		expect(addUsage(a, { input: 3, output: 4, cost: 0.2 })).toEqual({
			input: 4,
			output: 6,
			cost: 0.30000000000000004
		});
		expect(addUsage(a, { input: 3, output: 4 })).toEqual({ input: 4, output: 6 });
	});

	it('prices a run: reported cost, else the price, else free when local, else unknown', () => {
		const base = { id: 'p', model: 'm' };
		const u = { input: 2_000_000, output: 1_000_000 };
		const price = { input: 0.5, output: 2 };
		expect(runRecord({ ...u, cost: 1.5 }, base, { price }).cost).toBe(1.5);
		expect(runRecord(u, base, { price }).cost).toBe(3);
		expect(runRecord(u, base, { local: true }).cost).toBe(0);
		expect(runRecord(u, base, {}).cost).toBeNull();
		expect(runRecord(u, base, undefined).cost).toBeNull();
		// An unpriced record picks up a price set later.
		expect(
			recordCost(rec('2026-01-01T00:00:00Z', { cost: null }), { price: { input: 1, output: 1 } })
		).toBe(0.0011);
	});

	it('round-trips records through the session file form', () => {
		const r = rec('2026-10-04T10:00:00.000Z', { model: 'qwen3:8b', cost: null });
		expect(parseRecord(formatRecord(r))).toEqual(r);
		expect(parseRecord(formatRecord(rec('2026-10-04T10:00:00.000Z')))?.cost).toBe(0.01);
		expect(parseRecord('nonsense')).toBeNull();
	});

	it('adds up today, this month, all time, per model and per chat', () => {
		const now = new Date(2026, 9, 4, 15, 0);
		const today = new Date(2026, 9, 4, 9, 0).toISOString();
		const earlier = new Date(2026, 9, 1, 9, 0).toISOString();
		const lastMonth = new Date(2026, 8, 20, 9, 0).toISOString();
		const report = usageReport(
			[
				{ file: 'a.md', title: 'A', records: [rec(lastMonth), rec(today)] },
				{
					file: 'b.md',
					title: 'B',
					records: [rec(earlier, { provider: 'q', model: 'big', cost: null })]
				},
				{ file: 'c.md', title: 'Empty', records: [] }
			],
			// Priced per provider + model (models.dev prices differ by model).
			(p, m) => (p === 'q' && m === 'big' ? { price: { input: 10, output: 10 } } : undefined),
			now
		);
		expect(report.today).toMatchObject({ runs: 1, cost: 0.01 });
		expect(report.month).toMatchObject({ runs: 2, unpriced: 0 });
		expect(report.month.cost).toBeCloseTo(0.021);
		expect(report.all).toMatchObject({ runs: 3, input: 3000, output: 300 });
		expect(report.byChat.map((c) => c.title)).toEqual(['A', 'B']);
		expect(report.byModel.map((m) => m.model)).toEqual(['m', 'big']);
	});

	it('formats money and tokens', () => {
		expect(formatUsd(0)).toBe('$0');
		expect(formatUsd(0.00004)).toBe('<$0.0001');
		expect(formatUsd(0.0042)).toBe('$0.0042');
		expect(formatUsd(0.123)).toBe('$0.123');
		expect(formatUsd(12.345)).toBe('$12.35');
		expect(formatTokens(950)).toBe('950');
		expect(formatTokens(1234)).toBe('1.2k');
		expect(formatTokens(45_600)).toBe('46k');
		expect(formatTokens(3_200_000)).toBe('3.2M');
		expect(usageLine(1234, 56, 0.0004)).toBe('1.2k in · 56 out · $0.0004');
		expect(usageLine(1234, 56, null)).toBe('1.2k in · 56 out');
	});
});
