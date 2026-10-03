<script lang="ts">
	import { platform } from '../platform';
	import { getAppState } from '../stores/app.svelte';
	import ActionMenu, { type MenuItem } from './ActionMenu.svelte';
	import Icon from './Icon.svelte';

	const app = getAppState();
	// macOS draws native traffic lights (top-left); don't duplicate them.
	const isMac = platform.platform === 'darwin';
	const phone = $derived(app.layout === 'phone');
	const changeCount = $derived(app.changes?.length ?? 0);

	let moreBtn = $state<HTMLButtonElement | null>(null);
	let moreAt = $state<{ x: number; y: number } | null>(null);

	function folderName(path: string | null): string {
		if (!path) return 'No folder';
		const parts = path.replace(/\/+$/, '').split('/');
		return parts[parts.length - 1] || path;
	}

	/** Phones: the title names the screen you are on. */
	const screenTitle = $derived.by(() => {
		if (app.view === 'settings') return 'Settings';
		if (app.view === 'changes') return 'Changes';
		if (app.pane === 'harness') return 'AI';
		if (app.pane === 'editor')
			return app.notes.find((n) => n.id === app.activeId)?.title ?? (app.draft ? 'New note' : '');
		if (app.pane === 'list') {
			if (app.trashOpen) return 'Trash';
			if (app.selectedFolder) return app.selectedFolder.split('/').pop() ?? 'Folder';
			if (app.selectedTag) return `#${app.selectedTag.split('/').pop()}`;
			return 'All Notes';
		}
		return folderName(app.workspace);
	});

	function openMore(): void {
		if (moreAt) {
			moreAt = null;
			return;
		}
		const r = moreBtn!.getBoundingClientRect();
		moreAt = { x: r.right - 200, y: r.bottom + 4 };
	}

	const moreItems = $derived.by((): MenuItem[] => [
		{
			label: app.syncing === 'pull' ? 'Pulling…' : 'Pull',
			icon: 'pull',
			disabled: app.syncing !== null || !app.workspace,
			action: () => void app.sync('pull')
		},
		{
			label: app.syncing === 'push' ? 'Pushing…' : 'Push',
			icon: 'push',
			disabled: app.syncing !== null || !app.workspace,
			action: () => void app.sync('push')
		},
		{
			label: 'Changes',
			icon: 'diff',
			hint: app.changes === null ? undefined : String(changeCount),
			action: () => app.showChanges()
		},
		...(app.vault?.hasKey
			? [
					{
						label: app.vault.unlocked ? 'Lock encrypted notes' : 'Unlock encrypted notes',
						icon: app.vault.unlocked ? 'lock' : 'unlock',
						action: () => (app.vault?.unlocked ? app.lockVault() : void app.ensureUnlocked())
					} as MenuItem
				]
			: []),
		{
			label: app.theme === 'light' ? 'Dark theme' : 'Light theme',
			icon: app.theme === 'light' ? 'moon' : 'sun',
			divider: true,
			action: () => app.toggleTheme()
		},
		{ label: 'Settings', icon: 'settings', action: () => app.openSettings() }
	]);
</script>

<header class="titlebar" class:mac={isMac} class:touch={app.touch} class:phone>
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
				<Icon name="list" size={18} stroke={1.9} />
			</button>
		{:else if phone}
			{#if app.canGoBack}
				<button class="icon-btn back" title="Back" aria-label="Back" onclick={() => app.back()}>
					<Icon name="back" size={19} stroke={2} />
				</button>
			{/if}
		{:else}
			<button
				class="icon-btn"
				class:on={app.sidebarOpen && !app.zen}
				title="Toggle sidebar"
				aria-label="Toggle sidebar"
				aria-pressed={app.sidebarOpen}
				onclick={() => app.toggleSidebar()}
			>
				<Icon name="sidebar" size={17} />
			</button>
		{/if}
		{#if !phone}
			<!-- The note list can be hidden on any wide layout, landscape tablets included. -->
			<button
				class="icon-btn"
				class:on={app.listOpen && !app.zen}
				title="Toggle note list (Mod+Shift+L)"
				aria-label="Toggle note list"
				aria-pressed={app.listOpen}
				onclick={() => app.toggleList()}
			>
				<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<rect
						x="3"
						y="4"
						width="18"
						height="16"
						rx="2.5"
						stroke="currentColor"
						stroke-width="1.8"
					/>
					<path
						d="M7 9h5M7 12.5h5M7 16h3"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
					/>
					<line x1="15" y1="4" x2="15" y2="20" stroke="currentColor" stroke-width="1.8" />
				</svg>
			</button>
		{/if}
	</div>

	<div class="center">
		{#if phone}
			<span class="screen-title">{screenTitle}</span>
		{:else}
			<span class="workspace" title={app.workspace ?? ''}>{folderName(app.workspace)}</span>
		{/if}
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
		{#if phone}
			<button
				bind:this={moreBtn}
				class="icon-btn"
				class:on={!!moreAt}
				class:busy={app.syncing !== null}
				title="More"
				aria-label="More"
				aria-haspopup="menu"
				aria-expanded={!!moreAt}
				onclick={openMore}
			>
				<Icon name="more" size={20} />
				{#if changeCount}<span class="count-dot" aria-hidden="true"></span>{/if}
			</button>
		{:else}
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
					<Icon name="pull" size={16} />
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
					<Icon name="push" size={16} />
				</button>
				{#if app.changes !== null}
					<button
						class="icon-btn changes"
						class:on={app.view === 'changes'}
						title="Changes since the last sync (git status)"
						aria-label="Changes"
						onclick={() => (app.view === 'changes' ? app.setView('editor') : app.showChanges())}
					>
						<Icon name="diff" size={16} />
						{#if changeCount}<span class="count">{changeCount}</span>{/if}
					</button>
				{/if}
			{/if}
			{#if app.vault?.hasKey}
				<button
					class="icon-btn"
					class:on={app.vault.unlocked}
					title={app.vault.unlocked
						? 'Encrypted notes are unlocked — lock them (Mod+Shift+K)'
						: 'Unlock encrypted notes'}
					aria-label={app.vault.unlocked ? 'Lock encrypted notes' : 'Unlock encrypted notes'}
					onclick={() => (app.vault?.unlocked ? app.lockVault() : app.ensureUnlocked())}
				>
					<Icon name={app.vault.unlocked ? 'unlock' : 'lock'} size={16} />
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
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
				<Icon name={app.theme === 'light' ? 'moon' : 'sun'} size={16} />
			</button>
		{/if}

		{#if !isMac && platform.close}
			<div class="win-controls">
				<button class="win-btn min" aria-label="Minimize" onclick={() => platform.minimize?.()}
				></button>
				<button class="win-btn max" aria-label="Maximize" onclick={() => platform.maximize?.()}
				></button>
				<button class="win-btn close" aria-label="Close" onclick={() => platform.close?.()}
				></button>
			</div>
		{/if}
	</div>
</header>

{#if moreAt}
	<ActionMenu
		items={moreItems}
		at={moreAt}
		sheet
		title={folderName(app.workspace)}
		label="More"
		trigger={moreBtn}
		onclose={() => (moreAt = null)}
	/>
{/if}

<style>
	.titlebar {
		height: 46px;
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 0 12px;
		-webkit-app-region: drag;
		user-select: none;
	}
	/* Touch: finger-sized targets. */
	.titlebar.touch {
		height: 52px;
		padding: 0 6px;
	}
	.titlebar.touch .icon-btn {
		width: 44px;
		height: 44px;
	}
	.icon-btn.on {
		background: var(--bg-hover);
		color: var(--text);
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
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.phone .left {
		min-width: 44px;
	}
	.center {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 10px;
		font-size: 13px;
		color: var(--text-muted);
		font-weight: 500;
	}
	.phone .center {
		justify-content: flex-start;
	}
	.screen-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 17px;
		font-weight: 650;
		color: var(--text-strong);
	}
	.workspace {
		max-width: 40vw;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.saving {
		flex: 0 0 auto;
		font-size: 11px;
		color: var(--text-faint);
	}
	.icon-btn {
		position: relative;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		color: var(--text-muted);
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	.icon-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text);
	}
	.icon-btn:active:not(:disabled) {
		transform: scale(0.93);
		background: var(--bg-active);
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
	.icon-btn.changes {
		width: auto;
		min-width: 30px;
		grid-auto-flow: column;
		gap: 4px;
		padding: 0 7px;
	}
	.titlebar.touch .icon-btn.changes {
		width: auto;
		min-width: 44px;
	}
	.count {
		font-size: 11px;
		font-weight: 700;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
	.count-dot {
		position: absolute;
		top: 10px;
		right: 10px;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
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
	.phone .sync-msg {
		max-width: 30vw;
	}
	.sync-msg.error {
		color: var(--danger);
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
		transition: filter var(--dur-fast) ease;
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
