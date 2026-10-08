<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import { reducedMotion } from '../portal';

	const app = getAppState();
	const req = $derived(app.promptRequest);
	const dur = reducedMotion() ? 0 : 1;
	const phone = $derived(app.layout === 'phone');

	/** The field, fresh for every request; `failed` is the error `submit` returned. */
	const form = $derived.by(() => {
		const fresh = $state({
			value: req?.value ?? '',
			touched: false,
			failed: null as string | null
		});
		return fresh;
	});
	/** `submit` running. */
	let busy = $state(false);
	// The scrim cancels only for a press that started on it (see ConfirmDialog).
	let scrimPressed = false;

	const error = $derived(req?.check?.(form.value) ?? form.failed);

	function onKey(e: KeyboardEvent): void {
		if (!req || e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		cancel();
	}

	/** Attachment: focus the field for each request, its text selected unless secret. */
	function focusField(input: HTMLInputElement): void {
		if (!req) return;
		input.focus();
		if (!req.secret) input.select();
	}

	async function submit(e?: Event): Promise<void> {
		e?.preventDefault();
		const r = req;
		const f = form;
		f.touched = true;
		if (error || busy || !r) return;
		if (r.submit) {
			busy = true;
			f.failed = await r.submit(f.value);
			busy = false;
			if (f.failed) return;
		}
		const out = f.value;
		if (r.secret) f.value = '';
		// Unchanged: nothing to do, same as Cancel.
		app.answerPrompt(out.trim() === r.value ? null : out);
	}

	function cancel(): void {
		if (req?.secret) form.value = '';
		app.answerPrompt(null);
	}
</script>

<!-- Escape cancels. -->
<svelte:window onkeydowncapture={onKey} />

{#if req}
	<div class={['root', { sheet: phone }]}>
		<button
			class="scrim"
			aria-label="Cancel"
			tabindex="-1"
			onpointerdown={() => (scrimPressed = true)}
			onclick={() => {
				if (scrimPressed) cancel();
				scrimPressed = false;
			}}
			transition:fade={{ duration: 160 * dur }}
		></button>
		<div
			class="dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="prompt-title"
			in:fly={phone ? { y: 60, duration: 240 * dur, opacity: 0 } : { y: 0, duration: 0 }}
			out:fade={{ duration: 120 * dur }}
		>
			<form onsubmit={submit} in:scale={{ start: 0.96, duration: phone ? 0 : 180 * dur }}>
				<h2 id="prompt-title">{req.title}</h2>
				<label>
					<span class="lbl">{req.label}</span>
					<input
						{@attach focusField}
						bind:value={form.value}
						oninput={() => {
							form.touched = true;
							form.failed = null;
						}}
						type={req.secret ? 'password' : 'text'}
						spellcheck="false"
						autocomplete="off"
						enterkeyhint="done"
						dir="auto"
						aria-invalid={form.touched && !!error}
						aria-describedby="prompt-error"
					/>
				</label>
				<p id="prompt-error" class="err" role="status">{form.touched && error ? error : ''}</p>
				<div class="actions">
					<button type="button" class="btn" onclick={cancel}>Cancel</button>
					<button type="submit" class="btn primary" disabled={!!error || busy} aria-busy={busy}
						>{req.confirm}</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.root {
		position: fixed;
		inset: 0;
		z-index: 140;
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
	.dialog {
		position: relative;
		width: min(400px, 100%);
		padding: 20px 20px 16px;
		border-radius: 14px;
		background: var(--bg-editor);
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
	}
	.sheet .dialog {
		width: 100%;
		border-radius: 18px 18px 0 0;
		padding: 22px 18px calc(16px + env(safe-area-inset-bottom, 0px));
	}
	h2 {
		margin: 0 0 12px;
		font-size: 16px;
		font-weight: 700;
		color: var(--text-strong);
	}
	label {
		display: grid;
		gap: 6px;
	}
	.lbl {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
	}
	input {
		width: 100%;
		height: 38px;
		padding: 0 11px;
		border-radius: 9px;
		border: 1px solid var(--bg-active);
		background: var(--bg-list);
		color: var(--text);
		font: inherit;
		font-size: 14px;
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}
	input[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.sheet input {
		height: 46px;
		font-size: 16px;
	}
	.err {
		min-height: 18px;
		margin: 6px 0 0;
		font-size: 12.5px;
		color: var(--danger);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 10px;
	}
	.sheet .actions {
		flex-direction: column-reverse;
	}
	.btn {
		min-height: 36px;
		padding: 0 16px;
		border-radius: 9px;
		background: var(--bg-hover);
		color: var(--text);
		font-size: 13.5px;
		font-weight: 600;
		transition:
			background var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	.sheet .btn {
		min-height: 50px;
		font-size: 16px;
	}
	.btn:hover:not(:disabled) {
		background: var(--bg-active);
	}
	.btn:active:not(:disabled) {
		transform: scale(0.97);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn.primary,
	.btn.primary:hover:not(:disabled) {
		background: var(--accent);
		color: #fff;
	}
</style>
