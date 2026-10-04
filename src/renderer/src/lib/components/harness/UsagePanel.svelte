<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { getAppState } from '../../stores/app.svelte';
	import { getAiSettings } from '../../harness/config.svelte';
	import { getHarness } from '../../harness/harness.svelte';
	import {
		formatTokens,
		formatUsd,
		usageReport,
		type Totals,
		type UsageReport
	} from '../../harness/usage';
	import { portal, reducedMotion } from '../../portal';
	import Icon from '../Icon.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const app = getAppState();
	const ai = getAiSettings();
	const h = getHarness();
	const phone = $derived(app.layout === 'phone');
	const dur = reducedMotion() ? 0 : 1;

	let report = $state<UsageReport | null>(null);
	let error = $state<string | null>(null);
	let scrimPressed = false;

	const priced = (id: string, model: string) => ai.priced(id, model);
	const providerName = (id: string) => ai.config.providers.find((p) => p.id === id)?.name ?? id;

	onMount(() => {
		Promise.all([h.loadUsage(), ai.loadPrices()])
			.then(([chats]) => (report = usageReport(chats, priced)))
			.catch((err) => (error = err instanceof Error ? err.message : String(err)));
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			onclose();
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});

	/** "$0.12", "$0.12+" when some runs have no price, "no price" when none do. */
	function money(t: Totals): string {
		if (!t.runs) return '$0';
		if (t.unpriced === t.runs) return 'no price';
		return `${formatUsd(t.cost)}${t.unpriced ? '+' : ''}`;
	}

	const day = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

	async function openChat(file: string): Promise<void> {
		onclose();
		app.setView('editor');
		app.openHarness();
		await h.openSession(file);
	}
</script>

{#snippet card(label: string, t: Totals)}
	<div class="card">
		<span class="k">{label}</span>
		<strong class="v">{money(t)}</strong>
		<span class="sub"
			>{formatTokens(t.input + t.output)} tokens · {t.runs} {t.runs === 1 ? 'run' : 'runs'}</span
		>
	</div>
{/snippet}

<div use:portal class="root" class:sheet={phone}>
	<button
		class="scrim"
		aria-label="Close usage"
		tabindex="-1"
		onpointerdown={() => (scrimPressed = true)}
		onclick={() => {
			if (scrimPressed) onclose();
			scrimPressed = false;
		}}
		transition:fade={{ duration: 140 * dur }}
	></button>
	<div
		class="panel"
		role="dialog"
		aria-modal="true"
		aria-labelledby="usage-title"
		in:fly={{ y: phone ? 60 : 8, duration: 200 * dur, opacity: phone ? 1 : 0 }}
		out:fade={{ duration: 120 * dur }}
	>
		<header>
			<h2 id="usage-title">Usage</h2>
			<button class="icon-btn" aria-label="Close" onclick={onclose}
				><Icon name="close" size={17} /></button
			>
		</header>

		<div class="body">
			{#if error}
				<p class="muted">{error}</p>
			{:else if !report}
				<p class="muted">Adding up your chats…</p>
			{:else if !report.all.runs}
				<p class="muted">
					No usage yet. Each reply shows its tokens and cost once the provider reports them.
				</p>
			{:else}
				<div class="cards">
					{@render card('Today', report.today)}
					{@render card('This month', report.month)}
					{@render card('All time', report.all)}
				</div>
				{#if report.all.unpriced}
					<p class="note">
						{report.all.unpriced}
						{report.all.unpriced === 1 ? 'run has' : 'runs have'} no price: its tokens count, the cost
						doesn't. Neither the provider nor models.dev gave one; add a price to the provider in Settings
						→ AI.
					</p>
				{/if}

				<h3>By model</h3>
				<div class="table">
					{#each report.byModel as m (`${m.provider}/${m.model}`)}
						<div class="trow">
							<span class="name"
								>{m.model}<span class="dim"> · {providerName(m.provider)}</span></span
							>
							<span class="num">{formatTokens(m.input)} in · {formatTokens(m.output)} out</span>
							<span class="cost">{money(m)}</span>
						</div>
					{/each}
				</div>

				<h3>By chat</h3>
				<div class="table">
					{#each report.byChat as c (c.file)}
						<button class="trow link" onclick={() => openChat(c.file)} title="Open this chat">
							<span class="name">{c.title}<span class="dim"> · {day(c.last)}</span></span>
							<span class="num">{formatTokens(c.input + c.output)} tokens</span>
							<span class="cost">{money(c)}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.root {
		position: fixed;
		inset: 0;
		z-index: 130;
		display: grid;
		place-items: center;
		padding: 16px;
	}
	.root.sheet {
		place-items: end stretch;
		padding: 0;
	}
	.scrim {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.34);
		cursor: default;
	}
	.panel {
		position: relative;
		display: flex;
		flex-direction: column;
		width: min(640px, 100%);
		max-height: min(720px, 100%);
		border-radius: 14px;
		background: var(--bg-editor);
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
		overflow: hidden;
	}
	.sheet .panel {
		width: 100%;
		max-height: 92%;
		border-radius: 18px 18px 0 0;
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 14px 6px 20px;
	}
	h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
		color: var(--text-strong);
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		color: var(--text-muted);
	}
	:global(html[data-touch]) .icon-btn {
		width: 44px;
		height: 44px;
	}
	.icon-btn:hover {
		background: var(--bg-hover);
	}
	.body {
		overflow-y: auto;
		padding: 6px 20px 20px;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px;
		border-radius: 10px;
		background: var(--bg-list);
		min-width: 0;
	}
	.k {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-faint);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.v {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-strong);
		font-variant-numeric: tabular-nums;
	}
	.sub {
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.note,
	.muted {
		margin: 12px 0 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-muted);
	}
	h3 {
		margin: 22px 0 6px;
		font-size: 11.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.table {
		display: flex;
		flex-direction: column;
		border-radius: 10px;
		background: var(--bg-list);
		overflow: hidden;
	}
	.trow {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 72px;
		align-items: center;
		gap: 12px;
		min-height: 40px;
		padding: 6px 12px;
		font-size: 13px;
		text-align: start;
		color: var(--text-main);
	}
	:global(html[data-touch]) .trow {
		min-height: 48px;
	}
	.trow + .trow {
		box-shadow: inset 0 1px 0 var(--bg-hover);
	}
	.trow.link:hover {
		background: var(--bg-hover);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dim {
		color: var(--text-muted);
	}
	.num {
		font-size: 12px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.cost {
		text-align: end;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 480px) {
		.cards {
			grid-template-columns: 1fr;
		}
		.trow {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.num {
			display: none;
		}
	}
</style>
