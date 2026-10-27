import type { PreparedWrite } from './apply';
import { compactDiff, diffLines } from './diff';
import { AbortError } from './openai';
import type { WriteProposal } from './tools';

/**
 * One approval card, from prepare to apply. Kept pure of Svelte state so the
 * Stop race (a late prepare must not re-arm a stopped run) is unit-tested.
 */

export type ApprovalMode =
	WriteProposal['mode'] | 'edit' | 'delete' | 'create-map' | 'edit-map' | 'delete-map';

export interface Approval {
	label: string;
	mode: ApprovalMode;
	diff: ReturnType<typeof compactDiff>;
	added: number;
	removed: number;
	/** Readable changes for map approvals; the raw diff still lives on the tool row. */
	summary?: string[];
}

/** The parts of a harness tab the review flow touches. */
export interface ChangeToolEntry {
	kind: string;
	name?: string;
	result?: string | null;
	write?: Approval & { applied: boolean };
}

export interface ChangeHost {
	approval: Approval | null;
	entries: ChangeToolEntry[];
	confirm(a: Approval): Promise<boolean>;
}

/**
 * Prepare → review → apply. `signal` is the run's own signal, not `tab.ctl`:
 * after Stop, `ctl` is null but this flow may still be resolving.
 */
export async function reviewProposal(
	host: ChangeHost,
	name: string,
	mode: ApprovalMode,
	prepare: () => Promise<PreparedWrite>,
	signal?: AbortSignal
): Promise<string> {
	let prepared: PreparedWrite;
	try {
		prepared = await prepare();
	} catch (err) {
		// A stopped run never left a card behind, so keep the unwind an abort.
		if (signal?.aborted) throw new AbortError();
		return `Not applied: ${err instanceof Error ? err.message : String(err)}`;
	}
	// Stop landed while prepare() was reading/flushing: do not arm a card.
	if (signal?.aborted) throw new AbortError();
	const lines = diffLines(prepared.before, prepared.after);
	const approval: Approval = {
		label: prepared.label,
		mode,
		diff: compactDiff(lines),
		added: lines.filter((l) => l.op === 'add').length,
		removed: lines.filter((l) => l.op === 'del').length,
		...(prepared.summary?.length ? { summary: prepared.summary } : {})
	};
	// The current tool row belongs to this call even when the user presses Stop.
	let row: ChangeToolEntry | null = null;
	for (let i = host.entries.length - 1; i >= 0 && !row; i--) {
		const e = host.entries[i];
		if (e.kind === 'tool' && e.name === name && e.result === null) row = e;
	}
	if (row) row.write = { ...approval, applied: false };
	if (signal?.aborted) throw new AbortError();
	const ok = await host.confirm(approval);
	if (signal?.aborted) throw new AbortError();
	// Keep the reviewed diff on the tool row, so the transcript shows what changed.
	if (!ok) return 'The user rejected this change. Ask what they want instead.';
	try {
		if (signal?.aborted) throw new AbortError();
		const result = await prepared.apply(signal);
		if (row?.write) row.write.applied = !/rejected/i.test(result);
		return result;
	} catch (err) {
		if (err instanceof AbortError) throw err;
		return `Not applied: ${err instanceof Error ? err.message : String(err)}`;
	}
}
