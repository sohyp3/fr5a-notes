<script lang="ts">
	import { getAppState } from '../stores/app.svelte';

	const app = getAppState();

	function folderName(path: string | null): string {
		if (!path) return 'No folder';
		const parts = path.replace(/\/+$/, '').split('/');
		return parts[parts.length - 1] || path;
	}
</script>

<header class="titlebar">
	<div class="left no-drag">
		<button
			class="icon-btn"
			title="Toggle sidebar"
			aria-label="Toggle sidebar"
			onclick={() => app.toggleSidebar()}
		>
			<svg width="17" height="17" viewBox="0 0 24 24" fill="none">
				<rect
					x="3"
					y="4"
					width="18"
					height="16"
					rx="2.5"
					stroke="currentColor"
					stroke-width="1.8"
				/>
				<line x1="9" y1="4" x2="9" y2="20" stroke="currentColor" stroke-width="1.8" />
			</svg>
		</button>
	</div>

	<div class="center">
		<span class="workspace" title={app.workspace ?? ''}>{folderName(app.workspace)}</span>
		{#if app.saving}
			<span class="saving">saving…</span>
		{/if}
	</div>

	<div class="right no-drag">
		<button
			class="icon-btn"
			title="Toggle theme"
			aria-label="Toggle theme"
			onclick={() => app.toggleTheme()}
		>
			{#if app.theme === 'light'}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
					<path
						d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linejoin="round"
					/>
				</svg>
			{:else}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.8" />
					<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
						<line x1="12" y1="2.5" x2="12" y2="5" />
						<line x1="12" y1="19" x2="12" y2="21.5" />
						<line x1="2.5" y1="12" x2="5" y2="12" />
						<line x1="19" y1="12" x2="21.5" y2="12" />
						<line x1="5.2" y1="5.2" x2="6.9" y2="6.9" />
						<line x1="17.1" y1="17.1" x2="18.8" y2="18.8" />
						<line x1="5.2" y1="18.8" x2="6.9" y2="17.1" />
						<line x1="17.1" y1="6.9" x2="18.8" y2="5.2" />
					</g>
				</svg>
			{/if}
		</button>

		<div class="win-controls">
			<button class="win-btn min" aria-label="Minimize" onclick={() => window.api.minimize()}>
			</button>
			<button class="win-btn max" aria-label="Maximize" onclick={() => window.api.maximize()}>
			</button>
			<button class="win-btn close" aria-label="Close" onclick={() => window.api.close()}> </button>
		</div>
	</div>
</header>

<style>
	.titlebar {
		height: 46px;
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 12px;
		-webkit-app-region: drag;
		user-select: none;
	}
	.no-drag {
		-webkit-app-region: no-drag;
	}
	.left,
	.right {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.center {
		display: flex;
		align-items: baseline;
		gap: 10px;
		font-size: 13px;
		color: var(--text-muted);
		font-weight: 500;
	}
	.workspace {
		max-width: 40vw;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.saving {
		font-size: 11px;
		color: var(--text-faint);
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		color: var(--text-muted);
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.win-controls {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-left: 6px;
		padding-left: 4px;
	}
	.win-btn {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		transition: filter 120ms ease;
	}
	.win-btn:hover {
		filter: brightness(0.9);
	}
	.win-btn.min {
		background: #f5bd4f;
	}
	.win-btn.max {
		background: #61c554;
	}
	.win-btn.close {
		background: #ed6a5e;
	}
</style>
