<script lang="ts">
	import { platform } from '../platform';
	import { getAppState } from '../stores/app.svelte';

	const app = getAppState();
	// macOS draws native traffic lights (top-left); don't duplicate them.
	const isMac = platform.platform === 'darwin';

	function folderName(path: string | null): string {
		if (!path) return 'No folder';
		const parts = path.replace(/\/+$/, '').split('/');
		return parts[parts.length - 1] || path;
	}
</script>

<header
	class="titlebar"
	class:mac={isMac}
	class:touch={app.touch}
	class:phone={app.layout === 'phone'}
>
	<div class="left no-drag">
		{#if app.layout === 'tablet'}
			<button
				class="icon-btn"
				class:on={app.drawerOpen}
				title="Folders"
				aria-label="Open folders"
				aria-expanded={app.drawerOpen}
				onclick={() => app.toggleDrawer()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
					<path
						d="M4 7h16M4 12h16M4 17h16"
						stroke="currentColor"
						stroke-width="1.9"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		{:else if app.layout === 'phone'}
			{#if app.canGoBack}
				<button class="icon-btn back" title="Back" aria-label="Back" onclick={() => app.back()}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
						<path
							d="M15 5l-7 7 7 7"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
			{/if}
		{:else}
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
		{/if}
	</div>

	<div class="center">
		<span class="workspace" title={app.workspace ?? ''}>{folderName(app.workspace)}</span>
		{#if app.saving}
			<span class="saving">saving…</span>
		{/if}
		{#if app.syncing}
			<span class="sync-msg" role="status">{app.syncing === 'pull' ? 'pulling…' : 'pushing…'}</span>
		{:else if app.syncMessage}
			<span
				class="sync-msg no-drag"
				class:error={app.syncMessage.kind === 'error'}
				class:conflict={app.syncMessage.kind === 'conflict'}
				role={app.syncMessage.kind === 'ok' ? 'status' : 'alert'}
				title={app.syncMessage.text}
			>
				{app.syncMessage.text}
				{#if app.syncMessage.kind !== 'ok'}
					<button
						class="dismiss"
						aria-label="Dismiss sync message"
						onclick={() => app.showSyncMessage(null)}>×</button
					>
				{/if}
			</span>
		{/if}
	</div>

	<div class="right no-drag">
		{#if app.workspace}
			<button
				class="icon-btn"
				class:busy={app.syncing === 'pull'}
				title="Pull (git)"
				aria-label="Pull"
				aria-busy={app.syncing === 'pull'}
				disabled={app.syncing !== null}
				onclick={() => app.sync('pull')}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
					<path
						d="M12 4v12m0 0-5-5m5 5 5-5M5 20h14"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
			<button
				class="icon-btn"
				class:busy={app.syncing === 'push'}
				title="Push (git)"
				aria-label="Push"
				aria-busy={app.syncing === 'push'}
				disabled={app.syncing !== null}
				onclick={() => app.sync('push')}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
					<path
						d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
		{/if}
		{#if app.layout === 'tablet' && (app.activeId || app.draft)}
			<!-- Desktop uses Mod+\; touch has no shortcut, so offer a button. -->
			<button
				class="icon-btn"
				class:on={app.zen}
				title="Zen mode"
				aria-label="Toggle zen mode"
				aria-pressed={app.zen}
				onclick={() => app.toggleZen()}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
					<path
						d={app.zen
							? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'
							: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'}
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
		{/if}
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

		{#if !isMac && platform.close}
			<div class="win-controls">
				<button class="win-btn min" aria-label="Minimize" onclick={() => platform.minimize?.()}>
				</button>
				<button class="win-btn max" aria-label="Maximize" onclick={() => platform.maximize?.()}>
				</button>
				<button class="win-btn close" aria-label="Close" onclick={() => platform.close?.()}>
				</button>
			</div>
		{/if}
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
	/* Touch: finger-sized targets. Phones: the workspace name gives way to sync status. */
	.titlebar.touch {
		height: 52px;
		padding: 0 6px;
	}
	.titlebar.touch .icon-btn {
		width: 44px;
		height: 44px;
	}
	.titlebar.touch .icon-btn.on {
		background: var(--bg-hover);
		color: var(--text);
	}
	.titlebar.phone .workspace {
		max-width: 28vw;
	}
	.titlebar.phone .sync-msg {
		max-width: 30vw;
	}
	/* Leave room for the native traffic lights. */
	.titlebar.mac {
		padding-left: 84px;
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
	.icon-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text);
	}
	.icon-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.icon-btn.busy {
		opacity: 1;
		color: var(--accent);
		animation: sync-pulse 900ms ease-in-out infinite alternate;
	}
	@keyframes sync-pulse {
		from {
			opacity: 1;
		}
		to {
			opacity: 0.35;
		}
	}
	.sync-msg {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 38vw;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		color: var(--text-faint);
	}
	.sync-msg.error {
		color: #d4513f;
	}
	.sync-msg.conflict {
		color: var(--accent);
	}
	.dismiss {
		font-size: 13px;
		line-height: 1;
		color: inherit;
		opacity: 0.7;
	}
	.dismiss:hover {
		opacity: 1;
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
