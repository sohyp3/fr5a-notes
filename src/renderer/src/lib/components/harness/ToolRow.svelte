<script lang="ts">
	import { slide } from 'svelte/transition';
	import type { Entry } from '../../harness/harness.svelte';
	import { asJson, highlightJson } from '../../harness/render';
	import DiffView from '../DiffView.svelte';
	import Icon from '../Icon.svelte';
	import { reducedMotion } from '../../portal';

	let { entry, running }: { entry: Extract<Entry, { kind: 'tool' }>; running: boolean } = $props();

	const LABEL: Record<string, string> = {
		read_note: 'Read note',
		list_notes: 'Listed notes',
		search_notes: 'Searched notes',
		ask_user: 'Asked you',
		write_note: 'Change',
		web_search: 'Web search',
		fetch_url: 'Read page'
	};

	let open = $state(false);
	const dur = reducedMotion() ? 0 : 1;

	const args = $derived.by((): [string, string][] => {
		try {
			const o = JSON.parse(entry.args || '{}') as Record<string, unknown>;
			return Object.entries(o).map(([k, v]) => [
				k,
				typeof v === 'string'
					? v
					: // ask_user: the questions, one per line, not their JSON.
						k === 'questions' && Array.isArray(v)
						? v.map((q) => (q as { question?: unknown })?.question ?? '').join('\n')
						: JSON.stringify(v)
			]);
		} catch {
			return entry.args ? [['args', entry.args]] : [];
		}
	});

	/** One-line summary: the most telling argument. */
	const summary = $derived.by(() => {
		const pick = args.find(([k]) =>
			['query', 'id', 'url', 'target', 'folder', 'question', 'questions'].includes(k)
		);
		const text = (pick ?? args[0])?.[1] ?? '';
		return text.replace(/\s+/g, ' ').slice(0, 120);
	});

	type Status = 'running' | 'ok' | 'failed' | 'cancelled' | 'rejected';
	const status = $derived.by((): Status => {
		const r = entry.result;
		if (r === null) return running ? 'running' : 'cancelled';
		if (r === '(cancelled)') return 'cancelled';
		if (entry.write && !entry.write.applied) return /rejected/i.test(r) ? 'rejected' : 'failed';
		if (
			/^(Error:|Not written|Unknown tool|Invalid JSON|No note with id|Search failed|HTTP \d|Withheld)/.test(
				r
			)
		)
			return 'failed';
		return 'ok';
	});

	const resultJson = $derived(entry.result ? asJson(entry.result) : null);
</script>

<div class="tool {status}">
	<button class="row" aria-expanded={open} onclick={() => (open = !open)}>
		<span class="st" aria-label={status}>
			{#if status === 'running'}
				<span class="spinner"></span>
			{:else if status === 'ok'}
				<Icon name="check" size={13} stroke={2.4} />
			{:else if status === 'cancelled'}
				<Icon name="stop" size={11} stroke={2.4} />
			{:else}
				<Icon name="close" size={12} stroke={2.4} />
			{/if}
		</span>
		<span class="name">{LABEL[entry.name] ?? entry.name}</span>
		{#if entry.write}
			<span class="target">{entry.write.label}</span>
			<span class="stat add">+{entry.write.added}</span>
			<span class="stat del">−{entry.write.removed}</span>
			<span class="tag"
				>{entry.write.applied
					? 'applied'
					: status === 'rejected'
						? 'rejected'
						: 'not applied'}</span
			>
		{:else}
			<span class="args" dir="auto">{summary}</span>
		{/if}
		<span class={['chev', { open }]}><Icon name="chevron" size={13} /></span>
	</button>
	{#if open}
		<div class="details" transition:slide={{ duration: 160 * dur }}>
			{#if entry.write}
				<DiffView lines={entry.write.diff} />
			{/if}
			{#if args.length && !entry.write}
				<dl class="kv">
					{#each args as [k, v] (k)}
						<dt>{k}</dt>
						<dd dir="auto">{v}</dd>
					{/each}
				</dl>
			{/if}
			{#if entry.result !== null}
				{#if resultJson}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- highlightJson escapes everything -->
					<pre class="result json">{@html highlightJson(resultJson)}</pre>
				{:else}
					<pre class="result" dir="auto">{entry.result}</pre>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.tool {
		border-radius: 9px;
		background: var(--bg-list);
		font-size: 12px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 32px;
		padding: 4px 8px;
		border-radius: 9px;
		text-align: start;
		color: var(--text-muted);
		transition: background var(--dur-fast) ease;
	}
	:global(html[data-touch]) .row {
		min-height: 44px;
	}
	.row:hover {
		background: var(--bg-hover);
	}
	.st {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		color: #fff;
		background: var(--text-faint);
	}
	.ok .st {
		background: var(--ok);
	}
	.failed .st,
	.rejected .st {
		background: var(--danger);
	}
	.running .st {
		background: none;
	}
	.spinner {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid var(--accent-soft);
		border-top-color: var(--accent);
		animation: spin 700ms linear infinite;
	}
	.name {
		flex: 0 0 auto;
		font-weight: 600;
		color: var(--text);
	}
	.args,
	.target {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-faint);
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.target {
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--text-muted);
	}
	.stat {
		flex: 0 0 auto;
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.add {
		color: var(--add-fg);
	}
	.del {
		color: var(--del-fg);
	}
	.tag {
		flex: 0 0 auto;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--bg-active);
		font-size: 10.5px;
		font-weight: 600;
	}
	.ok .tag {
		background: var(--add-bg);
		color: var(--add-fg);
	}
	.chev {
		flex: 0 0 auto;
		display: grid;
		color: var(--text-faint);
		transition: transform var(--dur-pane) var(--ease-out);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.details {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 2px 8px 8px;
	}
	.kv {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 10px;
		margin: 0;
		font-size: 11.5px;
	}
	dt {
		color: var(--text-faint);
		font-family: var(--font-mono);
	}
	dd {
		margin: 0;
		color: var(--text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 140px;
		overflow-y: auto;
	}
	.result {
		margin: 0;
		max-height: 240px;
		overflow: auto;
		padding: 8px 10px;
		border-radius: 7px;
		background: var(--code-bg);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--text);
		user-select: text;
	}
	.json :global(.j-key) {
		color: var(--accent);
	}
	.json :global(.j-str) {
		color: var(--add-fg);
	}
	.json :global(.j-num),
	.json :global(.j-lit) {
		color: #7c6ff0;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
