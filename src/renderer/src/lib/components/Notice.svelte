<script lang="ts">
	import { fly } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import { portal, reducedMotion } from '../portal';
	import Icon from './Icon.svelte';

	const app = getAppState();
	const dur = reducedMotion() ? 0 : 1;
</script>

{#if app.notice}
	{@const n = app.notice}
	<div
		{@attach portal}
		class={['notice', { error: n.kind === 'error' }]}
		role={n.kind === 'error' ? 'alert' : 'status'}
		transition:fly={{ y: 12, duration: 160 * dur }}
	>
		<span>{n.text}</span>
		{#if n.kind === 'error'}
			<button aria-label="Dismiss" onclick={() => (app.notice = null)}
				><Icon name="close" size={15} stroke={2} /></button
			>
		{/if}
	</div>
{/if}

<style>
	.notice {
		position: fixed;
		left: 50%;
		bottom: calc(18px + env(safe-area-inset-bottom, 0px));
		transform: translateX(-50%);
		z-index: 150;
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: min(480px, calc(100vw - 32px));
		padding: 9px 14px;
		border-radius: 10px;
		background: var(--text-strong);
		color: var(--bg-editor);
		font-size: 13px;
		font-weight: 500;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
		overflow-wrap: anywhere;
	}
	.notice.error {
		background: var(--danger);
		color: #fff;
	}
	button {
		display: grid;
		place-items: center;
		color: inherit;
		opacity: 0.8;
	}
</style>
