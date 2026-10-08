<script lang="ts">
	import type { DiffLine } from '../harness/diff';

	type Line = DiffLine | { op: 'gap'; count: number };

	interface Props {
		/** A compacted line diff (see harness/diff.ts `compactDiff`). */
		lines: Line[];
		/** Show old / new line numbers in a gutter. */
		numbers?: boolean;
	}

	let { lines, numbers = true }: Props = $props();

	const SIGN = { add: '+', del: '−', same: ' ' } as const;

	// Old/new line numbers, advancing past collapsed (unchanged) gaps.
	const rows = $derived.by(() => {
		let a = 1;
		let b = 1;
		return lines.map((l) => {
			if (l.op === 'gap') {
				a += l.count;
				b += l.count;
				return { line: l, a: 0, b: 0 };
			}
			const row = { line: l, a: l.op === 'add' ? 0 : a, b: l.op === 'del' ? 0 : b };
			if (l.op !== 'add') a++;
			if (l.op !== 'del') b++;
			return row;
		});
	});
</script>

<div class={['diff', { numbers }]} role="table" aria-label="Changes">
	{#each rows as { line, a, b }, k (k)}
		{#if line.op === 'gap'}
			<div class="gap" role="row">
				⋯ {line.count} unchanged {line.count === 1 ? 'line' : 'lines'}
			</div>
		{:else}
			<div class="dl {line.op}" role="row">
				{#if numbers}
					<span class="no" aria-hidden="true">{a || ''}</span>
					<span class="no" aria-hidden="true">{b || ''}</span>
				{/if}
				<span
					class="sign"
					aria-label={line.op === 'add' ? 'added' : line.op === 'del' ? 'removed' : undefined}
					>{SIGN[line.op]}</span
				><span class="txt" dir="auto">{line.text || ' '}</span>
			</div>
		{/if}
	{:else}
		<div class="gap">No differences.</div>
	{/each}
</div>

<style>
	.diff {
		padding: 6px 0;
		border-radius: 8px;
		background: var(--code-bg);
		font-family: var(--font-mono);
		font-size: 11.5px;
		line-height: 1.55;
		overflow-x: auto;
		user-select: text;
	}
	.dl {
		display: flex;
		min-width: max-content;
		padding-inline-end: 10px;
	}
	.no {
		flex: 0 0 3.2em;
		padding-inline-end: 6px;
		text-align: end;
		color: var(--text-faint);
		user-select: none;
		font-variant-numeric: tabular-nums;
	}
	.sign {
		flex: 0 0 1.6em;
		text-align: center;
		user-select: none;
	}
	.diff:not(.numbers) .dl {
		padding-inline-start: 4px;
	}
	.txt {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.dl.add {
		background: var(--add-bg);
		color: var(--add-fg);
	}
	.dl.del {
		background: var(--del-bg);
		color: var(--del-fg);
	}
	.dl.del .txt {
		text-decoration: line-through;
		text-decoration-color: var(--del-strike);
	}
	.dl.same {
		color: var(--text-muted);
	}
	.gap {
		padding: 2px 12px;
		color: var(--text-faint);
		font-style: italic;
		font-family: var(--font-ui);
		font-size: 11px;
	}
</style>
