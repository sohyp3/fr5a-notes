<script lang="ts">
	import { getAppState } from '../stores/app.svelte';
	import { slide } from 'svelte/transition';
	import { UI_FONTS, EN_FONTS, AR_FONTS } from '../fonts';
	import { ACCENTS } from '../accents';
	import { SHORTCUTS as shortcuts, VIM_SHORTCUTS as vimShortcuts } from '../shortcuts';

	const app = getAppState();
	const s = $derived(app.settings);

	// The shortcuts section starts collapsed (Mod+/ opens the full overlay).
	let shortcutsOpen = $state(false);

	function folderName(path: string | null): string {
		if (!path) return 'Not set';
		return path;
	}
</script>

<div class="settings">
	<header class="head">
		<h1>Settings</h1>
		<button class="close" aria-label="Close settings" onclick={() => app.setView('editor')}>
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

	<div class="body">
		<!-- Library -->
		<section class="group">
			<h2>Library</h2>
			<div class="row">
				<div class="label">
					<span class="name">Default folder</span>
					<span class="desc" title={app.workspace ?? ''}>{folderName(app.workspace)}</span>
				</div>
				<button class="btn" onclick={() => app.pickWorkspace()}>Change…</button>
			</div>
		</section>

		<!-- Appearance -->
		<section class="group">
			<h2>Appearance</h2>
			<div class="row">
				<div class="label">
					<span class="name">Theme</span>
					<span class="desc">Light or dark interface</span>
				</div>
				<div class="segmented" role="radiogroup" aria-label="Theme">
					<button
						class="seg"
						class:on={app.theme === 'light'}
						role="radio"
						aria-checked={app.theme === 'light'}
						onclick={() => app.setTheme('light')}>Light</button
					>
					<button
						class="seg"
						class:on={app.theme === 'dark'}
						role="radio"
						aria-checked={app.theme === 'dark'}
						onclick={() => app.setTheme('dark')}>Dark</button
					>
				</div>
			</div>
			<div class="row">
				<div class="label">
					<span class="name">Accent color</span>
					<span class="desc">Highlights, links and the caret</span>
				</div>
				<div class="swatches" role="radiogroup" aria-label="Accent color">
					{#each ACCENTS as a (a.id)}
						<button
							class="swatch"
							class:on={s.accent === a.id}
							role="radio"
							aria-checked={s.accent === a.id}
							aria-label={a.label}
							title={a.label}
							style="--sw:{app.theme === 'dark' ? a.dark : a.light}"
							onclick={() => app.updateSettings({ accent: a.id })}
						></button>
					{/each}
				</div>
			</div>
		</section>

		<!-- Typography -->
		<section class="group">
			<h2>Typography</h2>
			<div class="row">
				<div class="label">
					<span class="name">Interface font</span>
					<span class="desc">Sidebar, lists and controls</span>
				</div>
				<select
					value={s.uiFont}
					onchange={(e) => app.updateSettings({ uiFont: e.currentTarget.value })}
				>
					{#each UI_FONTS as f (f.id)}
						<option value={f.id}>{f.label}</option>
					{/each}
				</select>
			</div>
			<div class="row">
				<div class="label">
					<span class="name">English font</span>
					<span class="desc">Editor body for LTR notes</span>
				</div>
				<select
					value={s.enFont}
					onchange={(e) => app.updateSettings({ enFont: e.currentTarget.value })}
				>
					{#each EN_FONTS as f (f.id)}
						<option value={f.id}>{f.label}</option>
					{/each}
				</select>
			</div>
			<div class="row">
				<div class="label">
					<span class="name">Arabic font</span>
					<span class="desc">Editor body for RTL notes</span>
				</div>
				<select
					value={s.arFont}
					onchange={(e) => app.updateSettings({ arFont: e.currentTarget.value })}
				>
					{#each AR_FONTS as f (f.id)}
						<option value={f.id}>{f.label}</option>
					{/each}
				</select>
			</div>
			<div class="preview" dir="rtl">
				<span style="font-family:var(--font-editor)">نموذج للخط العربي — the quick brown fox</span>
			</div>
		</section>

		<!-- Preferences -->
		<section class="group">
			<h2>Preferences</h2>
			<div class="row">
				<div class="label">
					<span class="name">Vim motions</span>
					<span class="desc">Modal editing (normal · insert · visual)</span>
				</div>
				<button
					class="toggle"
					class:on={s.vim}
					role="switch"
					aria-checked={s.vim}
					aria-label="Vim motions"
					onclick={() => app.updateSettings({ vim: !s.vim })}
				>
					<span class="knob"></span>
				</button>
			</div>
			<div class="row">
				<div class="label">
					<span class="name">Ghost Syntax</span>
					<span class="desc">Fade Markdown symbols until hover or caret</span>
				</div>
				<button
					class="toggle"
					class:on={s.ghost}
					role="switch"
					aria-checked={s.ghost}
					aria-label="Ghost Syntax"
					onclick={() => app.updateSettings({ ghost: !s.ghost })}
				>
					<span class="knob"></span>
				</button>
			</div>
		</section>

		<!-- Shortcuts (collapsible) -->
		<section class="group">
			<button
				class="collapse-head"
				aria-expanded={shortcutsOpen}
				onclick={() => (shortcutsOpen = !shortcutsOpen)}
			>
				<svg class="chev" class:open={shortcutsOpen} width="10" height="10" viewBox="0 0 10 10">
					<path d="M3 2l4 3-4 3z" fill="currentColor" />
				</svg>
				<h2>Keyboard shortcuts</h2>
				<span class="hint">Mod+/ anywhere</span>
			</button>

			{#if shortcutsOpen}
				<div transition:slide={{ duration: 160 }}>
					{#each shortcuts as sc (sc.desc)}
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

					{#if s.vim}
						<h3 class="sub">Vim motions</h3>
						{#each vimShortcuts as sc (sc.desc)}
							<div class="sc-row">
								<span class="sc-desc">{sc.desc}</span>
								<span class="keys">
									{#each sc.keys as k, i (i)}
										<kbd>{k}</kbd>
									{/each}
								</span>
							</div>
						{/each}
					{/if}

					<p class="note">
						<strong>Mod</strong> is <kbd>⌘</kbd> on macOS and <kbd>Ctrl</kbd> on Linux / Windows.
					</p>
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.settings {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-editor);
		border-radius: 12px;
		box-shadow: var(--shadow-pane);
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 22px 28px 14px;
	}
	.head h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 700;
		color: var(--text-strong);
	}
	.close {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		color: var(--text-muted);
		transition: background 120ms ease;
	}
	.close:hover {
		background: var(--bg-hover);
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 6px 28px 40px;
		max-width: 640px;
		width: 100%;
		margin: 0 auto;
	}
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
	.row:last-of-type {
		box-shadow: none;
	}
	.label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-size: 14px;
		font-weight: 500;
		color: var(--text-strong);
	}
	.desc {
		font-size: 12px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 320px;
	}
	.btn {
		flex: 0 0 auto;
		padding: 7px 14px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text);
		font-size: 13px;
		font-weight: 500;
		transition: background 120ms ease;
	}
	.btn:hover {
		background: var(--bg-active);
	}
	select {
		flex: 0 0 auto;
		font-family: inherit;
		font-size: 13px;
		color: var(--text);
		background: var(--bg-hover);
		border: none;
		border-radius: 8px;
		padding: 7px 10px;
		cursor: pointer;
	}
	select:focus {
		outline: 2px solid var(--accent-soft);
	}
	.segmented {
		flex: 0 0 auto;
		display: flex;
		gap: 2px;
		padding: 2px;
		border-radius: 8px;
		background: var(--bg-hover);
	}
	.seg {
		padding: 5px 14px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.seg.on {
		background: var(--bg-editor);
		color: var(--text-strong);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
	}
	.swatches {
		flex: 0 0 auto;
		display: flex;
		gap: 8px;
	}
	.swatch {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--sw);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
		transition: transform 120ms var(--ease-spring);
	}
	.swatch:hover {
		transform: scale(1.12);
	}
	.swatch.on {
		box-shadow:
			0 0 0 2px var(--bg-editor),
			0 0 0 4px var(--sw);
	}
	.preview {
		margin-top: 14px;
		padding: 14px 16px;
		border-radius: 10px;
		background: var(--bg-list);
		font-size: 20px;
		line-height: 1.8;
		color: var(--text);
	}
	.toggle {
		flex: 0 0 auto;
		width: 42px;
		height: 24px;
		border-radius: 999px;
		background: var(--bg-active);
		position: relative;
		transition: background 160ms ease;
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
		transition: transform 160ms var(--ease-spring);
	}
	.toggle.on .knob {
		transform: translateX(18px);
	}
	.collapse-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 2px 0;
		margin-bottom: 6px;
		color: inherit;
	}
	.collapse-head h2 {
		margin: 0;
	}
	.collapse-head .chev {
		color: var(--text-faint);
		transition: transform 140ms var(--ease-spring);
		flex: 0 0 auto;
	}
	.collapse-head .chev.open {
		transform: rotate(90deg);
	}
	.collapse-head .hint {
		margin-left: auto;
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--text-faint);
	}
	.sub {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		margin: 16px 0 4px;
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
		margin-top: 14px;
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
