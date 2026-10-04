<script lang="ts">
	import { getAppState } from '../stores/app.svelte';
	import Icon from './Icon.svelte';

	const app = getAppState();
	const v = $derived(app.vault);
	const encryptedCount = $derived(app.notes.filter((n) => n.encrypted).length);

	/** With a key set up, the create / import forms stay folded until "Replace". */
	let replacing = $state(false);
	let name = $state('');
	let pass = $state('');
	let pass2 = $state('');
	let pasted = $state('');
	let pastedPass = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let shown = $state(false);
	let copied = $state(false);

	const AUTO_LOCK = [
		{ min: 0, label: 'Never' },
		{ min: 1, label: 'After 1 minute' },
		{ min: 5, label: 'After 5 minutes' },
		{ min: 15, label: 'After 15 minutes' },
		{ min: 30, label: 'After 30 minutes' },
		{ min: 60, label: 'After 1 hour' }
	];

	/** "AB12 CD34 …": the fingerprint's last 16 digits, as gpg shows a long key id. */
	const keyId = $derived(
		(v?.info?.fingerprint.slice(-16).toUpperCase().match(/.{4}/g) ?? []).join(' ')
	);

	function reset(): void {
		name = pass = pass2 = pasted = pastedPass = '';
		error = null;
		replacing = false;
	}

	async function replaceOk(): Promise<boolean> {
		if (!v?.hasKey) return true;
		return app.confirm({
			title: 'Replace your key?',
			body: encryptedCount
				? `${encryptedCount} encrypted ${encryptedCount === 1 ? 'note opens' : 'notes open'} only with the current key. Copy it somewhere safe first, or you won't be able to read them again.`
				: 'The current key is removed from this device.',
			confirm: 'Replace key',
			danger: true
		});
	}

	async function run(op: () => Promise<void>, done: string): Promise<void> {
		error = null;
		busy = true;
		try {
			await op();
			reset();
			app.notify('ok', done);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function create(): Promise<void> {
		if (pass.length < 8) {
			error = 'Use a passphrase of at least 8 characters.';
			return;
		}
		if (pass !== pass2) {
			error = 'The passphrases don’t match.';
			return;
		}
		if (!(await replaceOk())) return;
		await run(() => v!.generate(name, pass), 'Key created and unlocked');
	}

	async function useExisting(): Promise<void> {
		if (!pasted.trim() || !pastedPass) {
			error = 'Paste the key and enter its passphrase.';
			return;
		}
		if (!(await replaceOk())) return;
		await run(() => v!.importKey(pasted, pastedPass), 'Key added and unlocked');
	}

	async function copyKey(): Promise<void> {
		const key = v?.exportKey();
		if (!key) return;
		try {
			await navigator.clipboard.writeText(key);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			shown = true; // no clipboard access: select it by hand
		}
	}

	/** On: ask for the passphrase (checked) and keep it; off: delete it from this device. */
	async function toggleRemember(): Promise<void> {
		if (!v) return;
		if (v.remembered) {
			await v.forgetPassphrase();
			app.notify('ok', 'Passphrase deleted from this device');
			return;
		}
		const vault = v;
		const saved = await app.prompt({
			title: 'Remember the passphrase',
			label: 'Key passphrase',
			value: '',
			confirm: 'Remember',
			secret: true,
			check: (p) => (p ? null : 'Enter your passphrase.'),
			submit: (p) => vault.remember(p)
		});
		if (saved !== null) app.notify('ok', 'Passphrase remembered on this device');
	}

	async function remove(): Promise<void> {
		const ok = await app.confirm({
			title: 'Remove the key from this device?',
			body: encryptedCount
				? `${encryptedCount} encrypted ${encryptedCount === 1 ? 'note stays' : 'notes stay'} encrypted and can't be read here until you add the key again. Make sure you have a copy.`
				: 'You can add it again later from a copy.',
			confirm: 'Remove key',
			danger: true
		});
		if (ok) await v?.removeKey();
	}
</script>

{#if v}
	{#if v.hasKey}
		<section class="group">
			<h3>Your key</h3>
			<div class="row">
				<div class="label">
					<span class="name">{v.info?.userId || 'PGP key'}</span>
					<span class="desc mono" title={v.info?.fingerprint}>{keyId}</span>
				</div>
				<span class="status" class:open={v.unlocked}>
					<Icon name={v.unlocked ? 'unlock' : 'lock'} size={13} stroke={2} />
					{v.unlocked ? 'Unlocked' : 'Locked'}
				</span>
			</div>
			<div class="row">
				<div class="label">
					<span class="name">Encrypted notes</span>
					<span class="desc"
						>{encryptedCount}
						{encryptedCount === 1 ? 'note' : 'notes'}. Encrypt a note from its menu.</span
					>
				</div>
				{#if v.unlocked}
					<button class="btn" onclick={() => app.lockVault()}>Lock now</button>
				{:else}
					<button class="btn primary" onclick={() => app.ensureUnlocked()}>Unlock…</button>
				{/if}
			</div>
			<div class="row">
				<div class="label">
					<label class="name" for="autolock">Lock automatically</label>
					<span class="desc">When the app sits unused, or in the background, this long.</span>
				</div>
				<select
					id="autolock"
					value={app.settings.autoLockMinutes}
					onchange={(e) => app.updateSettings({ autoLockMinutes: Number(e.currentTarget.value) })}
				>
					{#each AUTO_LOCK as o (o.min)}<option value={o.min}>{o.label}</option>{/each}
				</select>
			</div>
			<div class="row">
				<div class="label">
					<span class="name">Remember passphrase</span>
					<span class="desc"
						>Kept in the {app.touch ? 'Android Keystore' : 'system keyring'} so notes unlock without typing
						it, also after an auto-lock. Anyone who can use this device can then read them. Turning it
						off deletes it from this device.</span
					>
				</div>
				<button
					class="toggle"
					class:on={v.remembered}
					role="switch"
					aria-checked={v.remembered}
					aria-label="Remember passphrase"
					onclick={toggleRemember}><span class="knob"></span></button
				>
			</div>
			{#if app.settings.ai}
				<div class="row">
					<div class="label">
						<span class="name">AI can read encrypted notes</span>
						<span class="desc"
							>While they're unlocked. A chat that reads one is kept on this device, out of sync,
							until you sync it (⋯ → Sync this chat); saved to notes, it's encrypted. Hide a note
							from cloud AI to keep it to providers on your own hardware.</span
						>
					</div>
					<button
						class="toggle"
						class:on={app.settings.aiReadsEncrypted}
						role="switch"
						aria-checked={app.settings.aiReadsEncrypted}
						aria-label="AI can read encrypted notes"
						onclick={() => app.updateSettings({ aiReadsEncrypted: !app.settings.aiReadsEncrypted })}
						><span class="knob"></span></button
					>
				</div>
			{/if}
		</section>

		<section class="group">
			<h3>Other devices</h3>
			<p class="lead">
				Copy the key here and add it on your other devices under “Use a key you already have”. It
				stays protected by your passphrase. Keep a copy somewhere safe, such as a password manager:
				without the key, encrypted notes can't be opened. Never put it in your notes folder.
			</p>
			<div class="actions">
				<button class="btn" onclick={copyKey}>
					<Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied' : 'Copy key'}
				</button>
				<button class="btn" onclick={() => (shown = !shown)}
					>{shown ? 'Hide key' : 'Show key'}</button
				>
			</div>
			{#if shown}
				<textarea
					class="key"
					readonly
					rows="6"
					aria-label="Your key (passphrase-protected)"
					onfocus={(e) => e.currentTarget.select()}>{v.exportKey()}</textarea
				>
			{/if}
		</section>

		<section class="group">
			<h3>Change key</h3>
			<div class="actions">
				<button class="btn" onclick={() => (replacing = !replacing)}
					>{replacing ? 'Cancel' : 'Replace…'}</button
				>
				<button class="btn danger" onclick={remove}>Remove from this device</button>
			</div>
		</section>
	{:else}
		<p class="lead">
			You need one key for all your devices. Create it on this device, then copy it to the others.
			Or use a key you already have, from another device or from gpg.
		</p>
	{/if}

	{#if !v.hasKey || replacing}
		<section class="group">
			<h3>Create a key</h3>
			<div class="form">
				<label class="field">
					<span class="small">Name (optional)</span>
					<input bind:value={name} autocomplete="off" spellcheck="false" placeholder="fr5a" />
				</label>
				<label class="field">
					<span class="small">Passphrase</span>
					<input type="password" bind:value={pass} autocomplete="new-password" />
				</label>
				<label class="field">
					<span class="small">Repeat passphrase</span>
					<input
						type="password"
						bind:value={pass2}
						autocomplete="new-password"
						onkeydown={(e) => e.key === 'Enter' && create()}
					/>
				</label>
				<div class="actions">
					<button class="btn primary" disabled={busy} onclick={create}>Create key</button>
				</div>
			</div>
		</section>

		<section class="group">
			<h3>Use a key you already have</h3>
			<div class="form">
				<label class="field">
					<span class="small"
						>Private key (from another device, or <code>gpg --armor --export-secret-keys</code
						>)</span
					>
					<textarea
						class="key"
						rows="5"
						bind:value={pasted}
						spellcheck="false"
						placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----"></textarea>
				</label>
				<label class="field">
					<span class="small">Its passphrase</span>
					<input
						type="password"
						bind:value={pastedPass}
						autocomplete="off"
						onkeydown={(e) => e.key === 'Enter' && useExisting()}
					/>
				</label>
				<div class="actions">
					<button class="btn primary" disabled={busy} onclick={useExisting}>Add key</button>
				</div>
			</div>
		</section>
	{/if}

	{#if error}<p class="msg error" role="alert">{error}</p>{/if}
{/if}

<style>
	.group {
		margin-bottom: 28px;
	}
	.group h3 {
		font-size: 11.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		margin: 0 0 4px;
	}
	.lead {
		margin: 0 0 12px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-muted);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 2px;
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
		font-weight: 500;
		color: var(--text-strong);
	}
	.desc {
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.mono {
		font-family: var(--font-mono, monospace);
		letter-spacing: 0.02em;
	}
	.small {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex-shrink: 0;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-muted);
	}
	.status.open {
		color: var(--accent);
	}
	.toggle {
		flex: 0 0 auto;
		width: 42px;
		height: 24px;
		border-radius: 999px;
		background: var(--bg-active);
		position: relative;
		transition: background var(--dur-pane) ease;
	}
	:global(html[data-touch]) .toggle {
		width: 50px;
		height: 30px;
	}
	.toggle.on {
		background: var(--accent);
	}
	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
		transition: transform var(--dur-pane) var(--ease-spring);
	}
	:global(html[data-touch]) .knob {
		width: 24px;
		height: 24px;
	}
	.toggle.on .knob {
		transform: translateX(18px);
	}
	:global(html[data-touch]) .toggle.on .knob {
		transform: translateX(20px);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 460px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	input,
	select,
	textarea {
		font: inherit;
		font-size: 13.5px;
		min-height: 34px;
		padding: 0 10px;
		border-radius: 8px;
		border: 1px solid var(--bg-hover);
		background: var(--bg-secondary);
		color: var(--text-main);
	}
	textarea {
		padding: 8px 10px;
		resize: vertical;
	}
	textarea.key {
		width: 100%;
		margin-top: 10px;
		font-family: var(--font-mono, monospace);
		font-size: 11.5px;
		line-height: 1.4;
	}
	.field textarea.key {
		margin-top: 0;
	}
	:global(html[data-touch]) input,
	:global(html[data-touch]) select {
		min-height: 44px;
		font-size: 16px;
	}
	input:focus,
	select:focus,
	textarea:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}
	code {
		font-family: var(--font-mono, monospace);
		font-size: 11.5px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 32px;
		padding: 0 14px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text-main);
		font-size: 13px;
		font-weight: 500;
		transition:
			background var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .btn {
		min-height: 44px;
	}
	.btn:hover {
		background: var(--bg-active);
	}
	.btn:active:not(:disabled) {
		transform: scale(0.97);
	}
	.btn.primary {
		background: var(--accent);
		color: #fff;
	}
	.btn.danger {
		color: var(--danger);
	}
	.btn:disabled {
		opacity: 0.5;
	}
	.msg {
		margin: 0;
		font-size: 13px;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.msg.error {
		color: var(--danger);
	}
</style>
