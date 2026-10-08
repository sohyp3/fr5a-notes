<script lang="ts">
	import { platform } from '../platform';
	import { onMount } from 'svelte';
	import type { ConflictFile } from '../../../../shared/types';
	import { isEncryptedNote } from '../../../../shared/encrypted';
	import { accentById, applyPalette } from '../accents';
	import {
		applyConflicts,
		cancelConflicts,
		initialDrafts,
		syncErrorMessage,
		type ConflictDraft,
		type ConflictPick
	} from '../sync';

	let files = $state.raw<ConflictFile[]>([]);
	let drafts = $state<Record<string, ConflictDraft>>({});
	let loading = $state(true);
	let working = $state(false);
	let error = $state<string | null>(null);

	onMount(async () => {
		// Match the main window's theme + accent.
		const theme = ((await platform.getState<string>('theme')) ?? 'light') as 'light' | 'dark';
		const settings = await platform.getState<{ accent?: string }>('settings');
		document.documentElement.setAttribute('data-theme', theme);
		applyPalette(accentById(settings?.accent ?? ''), theme);

		files = await platform.syncConflicts();
		drafts = initialDrafts(files);
		loading = false;
	});

	function setPick(path: string, pick: ConflictPick): void {
		drafts[path].pick = pick;
	}

	// Apply/Cancel: main closes this window and tells the main window to reload.
	async function apply(): Promise<void> {
		working = true;
		error = null;
		const res = await applyConflicts(platform, files, $state.snapshot(drafts));
		working = false;
		if (!res.ok) error = syncErrorMessage(res.error);
		else if (res.result.status === 'conflict') {
			files = res.result.files;
			drafts = initialDrafts(files);
			error = 'Some files are still conflicted.';
		}
	}

	async function cancel(): Promise<void> {
		working = true;
		error = null;
		const res = await cancelConflicts(platform);
		working = false;
		if (!res.ok) error = syncErrorMessage(res.error);
	}

	const show = (text: string | null) =>
		text === null ? '(deleted)' : isEncryptedNote(text) ? '(encrypted)' : text;
	/** Ciphertext on a side (encrypted note, key locked): pick a side, no hand merge. */
	const sealed = (f: ConflictFile) =>
		[f.mine, f.theirs].some((t) => t !== null && isEncryptedNote(t));
</script>

<main class="conflicts">
	<header>
		<h1>Resolve sync conflicts</h1>
		<p>
			{#if loading}
				Loading…
			{:else}
				{files.length}
				{files.length === 1 ? 'file was' : 'files were'} changed both here and on the remote. Choose what
				to keep for each.
			{/if}
		</p>
	</header>

	<div class="list">
		{#each files as file (file.path)}
			{@const d = drafts[file.path]}
			<section class="file">
				<div class="file-head">
					<h2 title={file.path}>{file.path}</h2>
					<div class="picks" role="radiogroup" aria-label="Resolution for {file.path}">
						<button
							role="radio"
							aria-checked={d.pick === 'mine'}
							class={{ on: d.pick === 'mine' }}
							onclick={() => setPick(file.path, 'mine')}>Keep mine</button
						>
						<button
							role="radio"
							aria-checked={d.pick === 'theirs'}
							class={{ on: d.pick === 'theirs' }}
							onclick={() => setPick(file.path, 'theirs')}>Keep theirs</button
						>
						{#if !sealed(file)}
							<button
								role="radio"
								aria-checked={d.pick === 'manual'}
								class={{ on: d.pick === 'manual' }}
								onclick={() => setPick(file.path, 'manual')}>Edit manually</button
							>
						{/if}
					</div>
				</div>

				{#if d.pick === 'manual'}
					<textarea
						class="manual"
						spellcheck="false"
						aria-label="Merged content for {file.path}"
						bind:value={drafts[file.path].manual}></textarea>
				{:else}
					<div class="sides">
						<div class={['side', { chosen: d.pick === 'mine' }]}>
							<span class="label">Mine</span>
							<pre>{show(file.mine)}</pre>
						</div>
						<div class={['side', { chosen: d.pick === 'theirs' }]}>
							<span class="label">Theirs</span>
							<pre>{show(file.theirs)}</pre>
						</div>
					</div>
				{/if}
			</section>
		{/each}
	</div>

	<footer>
		{#if error}<span class="error" role="alert">{error}</span>{/if}
		<button class="btn" disabled={working} onclick={cancel}>Cancel</button>
		<button class="btn primary" disabled={working || loading || files.length === 0} onclick={apply}>
			{working ? 'Working…' : 'Apply'}
		</button>
	</footer>
</main>

<style>
	:global(body) {
		background: var(--bg-primary);
		color: var(--text);
		font-family: var(--font-ui);
		margin: 0;
	}
	.conflicts {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	header {
		padding: 18px 22px 10px;
	}
	h1 {
		margin: 0 0 4px;
		font-size: 17px;
		font-weight: 600;
		color: var(--text-strong);
	}
	header p {
		margin: 0;
		font-size: 13px;
		color: var(--text-muted);
	}
	.list {
		flex: 1;
		overflow: auto;
		padding: 6px 22px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.file {
		background: var(--bg-secondary);
		border-radius: 10px;
		box-shadow: var(--shadow-pane);
		padding: 12px 14px 14px;
	}
	.file-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 10px;
	}
	h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.picks {
		display: flex;
		gap: 4px;
		flex: 0 0 auto;
	}
	.picks button {
		font-size: 12px;
		padding: 5px 10px;
		border-radius: 7px;
		color: var(--text-muted);
	}
	.picks button:hover {
		background: var(--bg-hover);
	}
	.picks button.on {
		background: var(--accent-soft);
		color: var(--text-strong);
		font-weight: 600;
	}
	.sides {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.side {
		border: 1px solid var(--bg-active);
		border-radius: 8px;
		padding: 8px 10px;
		min-width: 0;
		opacity: 0.6;
	}
	.side.chosen {
		opacity: 1;
		border-color: var(--accent);
	}
	.label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
	pre,
	.manual {
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}
	pre {
		margin: 6px 0 0;
		max-height: 260px;
		overflow: auto;
	}
	.manual {
		box-sizing: border-box;
		width: 100%;
		min-height: 220px;
		resize: vertical;
		padding: 8px 10px;
		border-radius: 8px;
		border: 1px solid var(--accent);
		background: var(--bg-editor);
		color: var(--text);
	}
	footer {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 8px;
		padding: 12px 22px 16px;
	}
	.error {
		margin-right: auto;
		font-size: 12px;
		color: #d4513f;
	}
	.btn {
		font-size: 13px;
		padding: 7px 16px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text);
	}
	.btn.primary {
		background: var(--accent);
		color: #fff;
		font-weight: 600;
	}
	.btn:disabled {
		opacity: 0.5;
	}
</style>
