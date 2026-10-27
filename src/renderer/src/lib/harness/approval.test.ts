import { describe, expect, it } from 'vitest';
import { reviewProposal, type Approval, type ChangeHost } from './approval';
import type { PreparedWrite } from './apply';
import { AbortError } from './openai';

function host(decide: (a: Approval) => Promise<boolean>, entries: ChangeHost['entries'] = []) {
	const approvals: Approval[] = [];
	const h: ChangeHost = {
		approval: null,
		entries,
		confirm: async (a) => {
			h.approval = a;
			approvals.push(a);
			const ok = await decide(a);
			h.approval = null;
			return ok;
		}
	};
	return { h, approvals };
}

function prepared(overrides: Partial<PreparedWrite> = {}): PreparedWrite {
	return {
		label: 'mind map “Atlas”',
		summary: ['Added node “Design”'],
		before: 'before',
		after: 'after',
		apply: async () => 'Edited map “Atlas”.',
		...overrides
	};
}

describe('reviewProposal', () => {
	it('does not re-arm a card when Stop lands while prepare is running', async () => {
		const controller = new AbortController();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		let applied = false;
		const { h, approvals } = host(
			async () => true,
			[{ kind: 'tool', name: 'edit_map', result: null }]
		);
		const pending = reviewProposal(
			h,
			'edit_map',
			'edit-map',
			async () => {
				await gate;
				return prepared({
					apply: async () => {
						applied = true;
						return 'Edited';
					}
				});
			},
			controller.signal
		);
		controller.abort();
		release();
		await expect(pending).rejects.toBeInstanceOf(AbortError);
		expect(approvals).toEqual([]);
		expect(h.approval).toBeNull();
		expect(applied).toBe(false);
		expect(h.entries[0].write).toBeUndefined();
	});

	it('passes the run signal to apply and refuses a card approved after Stop', async () => {
		const controller = new AbortController();
		const { h } = host(async () => {
			controller.abort();
			return true;
		});
		const pending = reviewProposal(
			h,
			'write_note',
			'replace',
			async () => prepared(),
			controller.signal
		);
		await expect(pending).rejects.toBeInstanceOf(AbortError);
	});

	it('keeps the summary on the card and row, and returns the real rejection text', async () => {
		const entry: ChangeHost['entries'][number] = {
			kind: 'tool',
			name: 'edit_map',
			result: null
		};
		const { h, approvals } = host(async () => false, [entry]);
		const result = await reviewProposal(h, 'edit_map', 'edit-map', async () => prepared());
		expect(result).toMatch(/rejected this change/);
		expect(approvals[0].summary).toEqual(['Added node “Design”']);
		expect(entry.write).toMatchObject({ applied: false, summary: ['Added node “Design”'] });
	});

	it('applies an approved change with the run signal', async () => {
		const controller = new AbortController();
		let signal: AbortSignal | undefined;
		const { h } = host(async () => true);
		const result = await reviewProposal(
			h,
			'edit_map',
			'edit-map',
			async () =>
				prepared({
					apply: async (s) => {
						signal = s;
						return 'Edited map “Atlas”.';
					}
				}),
			controller.signal
		);
		expect(result).toBe('Edited map “Atlas”.');
		expect(signal).toBe(controller.signal);
	});
});
