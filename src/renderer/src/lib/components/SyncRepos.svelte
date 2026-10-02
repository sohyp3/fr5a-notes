<script lang="ts">
	import { onMount } from 'svelte';
	import { getAppState } from '../stores/app.svelte';
	import { platform } from '../platform';
	import { syncErrorMessage } from '../sync';
	import type { SyncRepo } from '../../../../shared/types';

	// Root + nested repos, each syncing to its own remote. Desktop discovers
	// nested repos on disk; Android can add them here (clone into a folder).
	const app = getAppState();
	const android = platform.platform === 'android';
	let repos = $state<SyncRepo[]>([]);
	let adding = $state(false);
	let folder = $state('');
	let url = $state('');
	let token = $state('');
	let working = $state(false);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	async function load(): Promise<void> {
		repos = (await platform.syncRepos?.()) ?? [];
	}
	onMount(load);

	async function add(): Promise<void> {
		if (!platform.syncAddRepo) return;
		working = true;
		message = null;
		const res = await platform.syncAddRepo(folder, url, token);
		token = '';
		working = false;
		if (!res.ok) message = { kind: 'error', text: syncErrorMessage(res.error) };
		else {
			message = { kind: 'ok', text: `Connected ${folder}.` };
			adding = false;
			folder = url = '';
			await app.refresh();
		}
		await load();
	}

	async function remove(path: string): Promise<void> {
		await platform.syncRemoveRepo?.(path);
		await load();
	}
</script>

<section class="group">
	<h2>Sync repositories</h2>
	{#each repos as r (r.path)}
		<div class="row">
			<div class="label">
				<span class="name">{r.path || 'All notes (root)'}</span>
				<span class="desc">{r.remote ?? 'Not connected'}</span>
			</div>
			{#if r.path && platform.syncRemoveRepo}
				<button class="btn" onclick={() => remove(r.path)}>Stop syncing</button>
			{/if}
		</div>
	{/each}
	<p class="hint">
		A folder with its own git repo syncs to its own remote and is kept out of the root repo (added
		to <code>.gitignore</code>). Use it to send <code>private/</code> or <code>.fr5a/</code>
		(AI sessions) only to your server.
		{#if !android}Clones use your system git credentials (SSH keys / credential helper); a
			<code>git clone</code> inside the notes folder works too.{/if}
	</p>
	{#if platform.syncAddRepo}
		{#if adding}
			<div class="row stack">
				<label class="field">
					<span class="name">Folder</span>
					<input bind:value={folder} placeholder="private  or  .fr5a" autocomplete="off" />
				</label>
				<label class="field">
					<span class="name">{android ? 'HTTPS clone URL' : 'Clone URL (https or SSH)'}</span>
					<input
						type="url"
						inputmode="url"
						bind:value={url}
						autocomplete="off"
						placeholder="https://git.example.com/me/private.git"
					/>
				</label>
				{#if android}
					<label class="field">
						<span class="name">Token</span>
						<input type="password" bind:value={token} autocomplete="off" />
					</label>
				{/if}
				{#if message}<p class="msg" class:error={message.kind === 'error'}>{message.text}</p>{/if}
				<div class="actions">
					<button class="btn" onclick={() => (adding = false)}>Cancel</button>
					<button
						class="btn primary"
						disabled={working || !folder.trim() || !url.trim()}
						onclick={add}
					>
						{working ? 'Connecting…' : 'Connect'}
					</button>
				</div>
			</div>
		{:else}
			<div class="actions">
				<button class="btn" onclick={() => (adding = true)}>Add folder repo…</button>
			</div>
		{/if}
	{/if}
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
	.desc,
	.hint {
		font-size: 12px;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.hint {
		margin: 10px 2px;
		line-height: 1.5;
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
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.btn {
		padding: 7px 14px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text-main);
		font-size: 13px;
		font-weight: 500;
	}
	.btn.primary {
		background: var(--accent);
		color: #fff;
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
		color: #c0392b;
	}
	code {
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
</style>
