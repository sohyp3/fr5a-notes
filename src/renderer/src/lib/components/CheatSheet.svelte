<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import { SHORTCUTS, VIM_SHORTCUTS } from '../shortcuts';

	const app = getAppState();
</script>

<!-- Global cheat-sheet overlay, toggled from anywhere with Mod+/. -->
<div
	class="scrim"
	role="button"
	tabindex="-1"
	aria-label="Close shortcuts"
	transition:fade={{ duration: 140 }}
	onclick={(e) => e.target === e.currentTarget && app.toggleCheatSheet()}
	onkeydown={(e) => e.key === 'Escape' && app.toggleCheatSheet()}
>
	<div
		class="sheet"
		role="dialog"
		tabindex="-1"
		aria-label="Keyboard shortcuts"
		transition:scale={{ duration: 180, start: 0.94 }}
	>
		<header>
			<h2>Keyboard shortcuts</h2>
			<button class="close" aria-label="Close" onclick={() => app.toggleCheatSheet()}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
					<path
						d="M6 6l12 12M18 6L6 18"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</header>

		<div class="grid">
			{#each SHORTCUTS as sc (sc.desc)}
				<div class="sc-row">
					<span class="sc-desc">{sc.desc}</span>
					<span class="keys">
						{#each sc.keys as k, i (i)}
							{#if i > 0}<span class="plus">+</span>{/if}
							<kbd>{k}</kbd>
						{/each}
					</span>
				</div>
			{/each}
		</div>

		{#if app.settings.vim}
			<h3>Vim motions</h3>
			<div class="grid">
				{#each VIM_SHORTCUTS as sc (sc.desc)}
					<div class="sc-row">
						<span class="sc-desc">{sc.desc}</span>
						<span class="keys">
							{#each sc.keys as k, i (i)}
								<kbd>{k}</kbd>
							{/each}
						</span>
					</div>
				{/each}
			</div>
		{/if}

		<p class="note">
			<strong>Mod</strong> is <kbd>⌘</kbd> on macOS and <kbd>Ctrl</kbd> on Linux / Windows.
		</p>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		padding: 24px;
		background: rgba(0, 0, 0, 0.34);
		backdrop-filter: blur(2px);
		cursor: default;
	}
	.sheet {
		width: 100%;
		max-width: 460px;
		max-height: 82vh;
		overflow-y: auto;
		padding: 20px 24px 24px;
		border-radius: 16px;
		background: var(--bg-editor);
		box-shadow: var(--shadow-pane);
		cursor: default;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 700;
		color: var(--text-strong);
	}
	.close {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		color: var(--text-muted);
		transition: background 120ms ease;
	}
	.close:hover {
		background: var(--bg-hover);
	}
	h3 {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		margin: 18px 0 2px;
	}
	.grid {
		display: flex;
		flex-direction: column;
	}
	.sc-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 9px 2px;
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	.sc-desc {
		font-size: 13px;
		color: var(--text);
		font-family: var(--font-mono);
	}
	.keys {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: 0 0 auto;
	}
	.plus {
		color: var(--text-faint);
		font-size: 11px;
	}
	.note {
		font-size: 12px;
		color: var(--text-faint);
		margin: 16px 0 0;
	}
	kbd {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text);
		background: var(--bg-hover);
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.12);
		padding: 2px 6px;
		border-radius: 5px;
		min-width: 18px;
		text-align: center;
	}
</style>
