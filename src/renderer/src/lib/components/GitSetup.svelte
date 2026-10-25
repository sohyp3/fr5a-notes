<script lang="ts">
	import { onMount } from 'svelte';
	import { platform } from '../platform';
	import { syncErrorMessage } from '../sync';
	import EmptyState from './EmptyState.svelte';
	import mascotSynced from '$lib/assets/fr5a-synced.png';

	// Hosts that own the working copy (Android): connect it to an HTTPS remote.
	let remote = $state<string | null>(null);
	let hasToken = $state(false);
	let url = $state('');
	let token = $state('');
	let working = $state(false);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	async function loadStatus(): Promise<void> {
		const status = await platform.syncStatus?.();
		remote = status?.remote ?? null;
		hasToken = status?.hasToken ?? false;
		if (remote && !url) url = remote;
	}

	onMount(loadStatus);

	async function connect(): Promise<void> {
		if (!platform.syncSetup) return;
		working = true;
		message = null;
		const res = await platform.syncSetup(url, token);
		token = '';
		working = false;
		if (!res.ok) message = { kind: 'error', text: syncErrorMessage(res.error) };
		else if (res.result.status === 'conflict')
			message = {
				kind: 'error',
				text: 'Connected, but some notes conflict. Resolve them to finish.'
			};
		else message = { kind: 'ok', text: 'Connected and up to date.' };
		await loadStatus();
	}

	async function forget(): Promise<void> {
		await platform.syncForgetToken?.();
		await loadStatus();
	}
</script>

<section class="group">
	<h2>Git sync</h2>
	<div class="row">
		<div class="label">
			<span class="name">Remote</span>
			<span class="desc">{remote ?? 'Not connected'}</span>
		</div>
	</div>
	<div class="row stack">
		<label class="field">
			<span class="name">HTTPS clone URL</span>
			<input
				type="url"
				inputmode="url"
				autocomplete="off"
				spellcheck="false"
				placeholder="https://github.com/you/notes.git"
				bind:value={url}
			/>
		</label>
		<label class="field">
			<span class="name">GitHub personal access token</span>
			<input
				type="password"
				autocomplete="off"
				placeholder={hasToken ? 'Saved in secure storage' : 'ghp_…'}
				bind:value={token}
			/>
		</label>
		<div class="actions">
			{#if hasToken}
				<button class="btn" onclick={forget} disabled={working}>Forget token</button>
			{/if}
			<button class="btn primary" onclick={connect} disabled={working || !url.trim()}>
				{working ? 'Connecting…' : remote ? 'Save & pull' : 'Connect'}
			</button>
		</div>
		{#if message}
			{#if message.kind === 'ok'}
				<EmptyState small src={mascotSynced} title={message.text} />
			{:else}
				<p class="msg error">{message.text}</p>
			{/if}
		{/if}
	</div>
</section>

<style>
	.group {
		margin-bottom: 30px;
	}
	.group h2 {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		margin: 0 0 6px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 12px 2px;
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	.row.stack {
		flex-direction: column;
		align-items: stretch;
		gap: 12px;
		box-shadow: none;
	}
	.label,
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.name {
		font-size: 14px;
		color: var(--text-strong);
	}
	.desc {
		font-size: 12.5px;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	input {
		font: inherit;
		font-size: 14px;
		padding: 9px 11px;
		border-radius: 8px;
		border: 1px solid var(--bg-hover);
		background: var(--bg-secondary);
		color: var(--text-main);
	}
	input:focus {
		outline: 2px solid var(--focus-ring);
		outline-offset: -1px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.btn {
		padding: 0 14px;
		border-radius: var(--btn-radius);
		background: var(--bg-hover);
		color: var(--text-main);
		font-size: 13.5px;
		font-weight: 500;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--btn-h-dense);
		transition:
			background var(--dur-fast) ease,
			filter var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .btn {
		min-height: var(--tap);
	}
	@media (hover: hover) {
		.btn:hover:not(:disabled) {
			background: var(--bg-active);
		}
		.btn.primary:hover:not(:disabled) {
			background: var(--accent);
			filter: brightness(1.08);
		}
	}
	.btn:active:not(:disabled) {
		transform: scale(var(--press));
	}
	.btn.primary {
		background: var(--accent);
		color: var(--on-accent);
	}
	.btn:disabled {
		opacity: 0.5;
	}
	.msg {
		margin: 0;
		font-size: 13px;
		color: var(--text-muted);
	}
	.msg.error {
		color: var(--danger, #c0392b);
	}
</style>
