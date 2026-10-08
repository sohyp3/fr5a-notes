<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import { reducedMotion } from '../portal';

	const app = getAppState();
	const req = $derived(app.confirmRequest);
	const dur = reducedMotion() ? 0 : 1;
	// The scrim cancels only for a press that started on it: the tap that
	// opened the dialog can still deliver its click here (a "ghost click").
	let scrimPressed = false;

	function onKey(e: KeyboardEvent): void {
		if (!req || e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		app.answerConfirm(false);
	}
</script>

<!-- Escape cancels. -->
<svelte:window onkeydowncapture={onKey} />

{#if req}
	<div class={['root', { sheet: app.layout === 'phone' }]}>
		<button
			class="scrim"
			aria-label="Cancel"
			tabindex="-1"
			onpointerdown={() => (scrimPressed = true)}
			onclick={() => {
				if (scrimPressed) app.answerConfirm(false);
				scrimPressed = false;
			}}
			transition:fade={{ duration: 160 * dur }}
		></button>
		<div
			class="dialog"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
			in:fly={app.layout === 'phone'
				? { y: 60, duration: 240 * dur, opacity: 0 }
				: { y: 0, duration: 0 }}
			out:fade={{ duration: 120 * dur }}
		>
			<div in:scale={{ start: 0.96, duration: app.layout === 'phone' ? 0 : 180 * dur }}>
				<h2 id="confirm-title">{req.title}</h2>
				{#if req.body}<p>{req.body}</p>{/if}
				<div class="actions">
					<!-- The safe choice has focus first. -->
					<button {@attach (b) => b.focus()} class="btn" onclick={() => app.answerConfirm(false)}
						>Cancel</button
					>
					<button
						class={['btn primary', { danger: req.danger }]}
						onclick={() => app.answerConfirm(true)}>{req.confirm}</button
					>
				</div>
			</div>
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
		margin: 0 0 6px;
		font-size: 16px;
		font-weight: 700;
		color: var(--text-strong);
	}
	p {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 18px;
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
	.btn:hover {
		background: var(--bg-active);
	}
	.btn:active {
		transform: scale(0.97);
	}
	.btn.primary {
		background: var(--accent);
		color: #fff;
	}
	.btn.primary.danger {
		background: var(--danger);
	}
</style>
