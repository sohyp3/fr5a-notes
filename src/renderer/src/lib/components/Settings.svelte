<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { getAppState, type OpenIn, type SettingsSection } from '../stores/app.svelte';
	import { platform } from '../platform';
	import GitSetup from './GitSetup.svelte';
	import SyncRepos from './SyncRepos.svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from '../icons';
	import { UI_FONTS, EN_FONTS, AR_FONTS } from '../fonts';
	import { ACCENTS } from '../accents';
	import { SHORTCUTS, VIM_SHORTCUTS as vimShortcuts } from '../shortcuts';
	import { reducedMotion } from '../portal';

	const app = getAppState();
	const s = $derived(app.settings);
	const phone = $derived(app.layout === 'phone');
	const dur = reducedMotion() ? 0 : 1;

	const SECTIONS: { id: SettingsSection; label: string; icon: IconName; desc: string }[] = [
		{ id: 'general', label: 'General', icon: 'note', desc: 'Notes folder, opening notes' },
		{ id: 'appearance', label: 'Appearance', icon: 'sun', desc: 'Theme, accent, fonts' },
		{ id: 'editor', label: 'Editor', icon: 'edit', desc: 'Ghost syntax, Vim' },
		{ id: 'sync', label: 'Sync', icon: 'pull', desc: 'Git remotes, changes' },
		{ id: 'ai', label: 'AI assistant', icon: 'web', desc: 'Providers, web search, skills' },
		{ id: 'encryption', label: 'Encryption', icon: 'key', desc: 'Encrypt notes with your key' },
		{ id: 'shortcuts', label: 'Shortcuts', icon: 'list', desc: 'Keyboard shortcuts' }
	];

	const shortcuts = $derived(SHORTCUTS.filter((sc) => !sc.feature || s[sc.feature]));

	const section = $derived(SECTIONS.find((x) => x.id === app.settingsSection) ?? SECTIONS[0]);
	// Phones: a list of sections first, then one section at a time.
	const showIndex = $derived(phone && !app.settingsDrill);

	function go(id: SettingsSection): void {
		app.settingsSection = id;
		app.settingsDrill = true;
	}

	const OPEN_IN: { id: OpenIn; label: string }[] = [
		{ id: 'auto', label: 'Auto' },
		{ id: 'view', label: 'View' },
		{ id: 'edit', label: 'Edit' }
	];
</script>

{#snippet toggle(on: boolean, label: string, flip: () => void)}
	<button class="toggle" class:on role="switch" aria-checked={on} aria-label={label} onclick={flip}>
		<span class="knob"></span>
	</button>
{/snippet}

<div class="settings" class:phone>
	<header class="head">
		{#if phone && app.settingsDrill}
			<button
				class="icon-btn"
				aria-label="All settings"
				onclick={() => (app.settingsDrill = false)}
			>
				<Icon name="back" size={18} />
			</button>
		{/if}
		<h1>{phone && app.settingsDrill ? section.label : 'Settings'}</h1>
		<button
			class="icon-btn close"
			aria-label="Close settings"
			onclick={() => app.setView('editor')}
		>
			<Icon name="close" size={18} />
		</button>
	</header>

	<div class="frame">
		{#if !phone || showIndex}
			<nav class="nav" class:index={showIndex} aria-label="Settings sections">
				{#each SECTIONS as sec (sec.id)}
					<button
						class="nav-item"
						class:on={!phone && sec.id === app.settingsSection}
						aria-current={!phone && sec.id === app.settingsSection ? 'page' : undefined}
						onclick={() => go(sec.id)}
					>
						<span class="nav-ico"><Icon name={sec.icon} size={phone ? 18 : 15} /></span>
						<span class="nav-text">
							<span class="nav-label">{sec.label}</span>
							{#if phone}<span class="nav-desc">{sec.desc}</span>{/if}
						</span>
						{#if phone}<Icon name="chevron" size={16} />{/if}
					</button>
				{/each}
			</nav>
		{/if}

		{#if !showIndex}
			{#key app.settingsSection}
				<div
					class="pane-body"
					in:fly={{ x: phone ? 24 : 0, y: phone ? 0 : 6, duration: 180 * dur }}
					out:fade={{ duration: 0 }}
				>
					{#if !phone}<h2 class="section-title">{section.label}</h2>{/if}

					{#if section.id === 'general'}
						<section class="group">
							<h3>Library</h3>
							<div class="row">
								<div class="label">
									<span class="name">Notes folder</span>
									<span class="desc path" title={app.workspace ?? ''}
										>{app.workspace ?? 'Not set'}</span
									>
								</div>
								{#if !platform.syncSetup}
									<button class="btn" onclick={() => app.pickWorkspace()}>Change…</button>
								{/if}
							</div>
						</section>
						<section class="group">
							<h3>Notes</h3>
							<div class="row wrap">
								<div class="label">
									<span class="name">Open notes in</span>
									<span class="desc"
										>Auto: view mode on touch devices (no keyboard pops up), edit mode with a mouse.
										New notes always open for editing.</span
									>
								</div>
								<div class="segmented" role="radiogroup" aria-label="Open notes in">
									{#each OPEN_IN as o (o.id)}
										<button
											class="seg"
											class:on={s.openIn === o.id}
											role="radio"
											aria-checked={s.openIn === o.id}
											onclick={() => app.updateSettings({ openIn: o.id })}>{o.label}</button
										>
									{/each}
								</div>
							</div>
						</section>
					{:else if section.id === 'appearance'}
						<section class="group">
							<h3>Look</h3>
							<div class="row wrap">
								<div class="label">
									<span class="name">Theme</span>
									<span class="desc">Light or dark interface</span>
								</div>
								<div class="segmented" role="radiogroup" aria-label="Theme">
									{#each ['light', 'dark'] as const as t (t)}
										<button
											class="seg"
											class:on={app.theme === t}
											role="radio"
											aria-checked={app.theme === t}
											onclick={() => app.setTheme(t)}>{t === 'light' ? 'Light' : 'Dark'}</button
										>
									{/each}
								</div>
							</div>
							<div class="row wrap">
								<div class="label">
									<span class="name">Accent color</span>
									<span class="desc">Tints the whole window</span>
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
						<section class="group">
							<h3>Fonts</h3>
							<div class="row wrap">
								<label class="label" for="ui-font">
									<span class="name">Interface</span>
									<span class="desc">Sidebar, lists and controls</span>
								</label>
								<select
									id="ui-font"
									value={s.uiFont}
									onchange={(e) => app.updateSettings({ uiFont: e.currentTarget.value })}
								>
									{#each UI_FONTS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
								</select>
							</div>
							<div class="row wrap">
								<label class="label" for="en-font">
									<span class="name">English</span>
									<span class="desc">Latin text in notes</span>
								</label>
								<select
									id="en-font"
									value={s.enFont}
									onchange={(e) => app.updateSettings({ enFont: e.currentTarget.value })}
								>
									{#each EN_FONTS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
								</select>
							</div>
							<div class="row wrap">
								<label class="label" for="ar-font">
									<span class="name">Arabic</span>
									<span class="desc">Arabic text in notes</span>
								</label>
								<select
									id="ar-font"
									value={s.arFont}
									onchange={(e) => app.updateSettings({ arFont: e.currentTarget.value })}
								>
									{#each AR_FONTS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
								</select>
							</div>
							<div class="preview" dir="rtl">
								<span style="font-family:var(--font-editor)"
									>نموذج للخط العربي — the quick brown fox</span
								>
							</div>
						</section>
					{:else if section.id === 'editor'}
						<section class="group">
							<h3>Markdown</h3>
							<div class="row">
								<div class="label">
									<span class="name">Ghost Syntax</span>
									<span class="desc">Fade Markdown symbols until hover or caret</span>
								</div>
								{@render toggle(s.ghost, 'Ghost Syntax', () =>
									app.updateSettings({ ghost: !s.ghost })
								)}
							</div>
						</section>
						<!-- No Vim on Android (on-screen keyboard; the editor ignores the setting there). -->
						{#if platform.platform !== 'android'}
							<section class="group">
								<h3>Keyboard</h3>
								<div class="row">
									<div class="label">
										<span class="name">Vim motions</span>
										<span class="desc">Modal editing (normal · insert · visual)</span>
									</div>
									{@render toggle(s.vim, 'Vim motions', () => app.updateSettings({ vim: !s.vim }))}
								</div>
							</section>
						{/if}
					{:else if section.id === 'sync'}
						{#if platform.syncSetup}<GitSetup />{/if}
						{#if platform.syncRepos}<SyncRepos />{/if}
						{#if !platform.syncSetup}
							<section class="group">
								<h3>How sync works</h3>
								<p class="prose">
									Pull and Push in the top bar run the system <code>git</code> in your notes folder: local
									edits are committed, then merged with the remote (never force-pushed). The folder needs
									to be a git repository with a remote you can push to.
								</p>
							</section>
						{/if}
						<section class="group">
							<h3>Changes</h3>
							<div class="row">
								<div class="label">
									<span class="name">Changed since the last sync</span>
									<span class="desc"
										>{app.changes === null
											? 'Not a git repository'
											: `${app.changes.length} ${app.changes.length === 1 ? 'note' : 'notes'}`}</span
									>
								</div>
								<button class="btn" onclick={() => app.showChanges()}>Review…</button>
							</div>
						</section>
					{:else if section.id === 'ai'}
						<!-- AI off = no harness code loaded at all (AiSettings is a lazy chunk). -->
						<section class="group">
							<div class="row">
								<div class="label">
									<span class="name">Enable AI harness</span>
									<span class="desc">Chat, skills and fact-checking over your notes (Mod+J)</span>
								</div>
								{@render toggle(s.ai, 'Enable AI harness', () => app.updateSettings({ ai: !s.ai }))}
							</div>
						</section>
						{#if s.ai}
							{#await import('./harness/AiSettings.svelte') then m}
								<m.default />
							{/await}
						{/if}
					{:else if section.id === 'encryption'}
						<!-- Off = no crypto code or key loaded (EncryptionSettings + OpenPGP are lazy chunks). -->
						<section class="group">
							<div class="row">
								<div class="label">
									<span class="name">Encrypt notes</span>
									<span class="desc"
										>Keep chosen notes encrypted with your PGP key: only devices that have the key
										can read them, and git syncs the encrypted text.</span
									>
								</div>
								{@render toggle(s.encryption, 'Encrypt notes', () =>
									app.updateSettings({ encryption: !s.encryption })
								)}
							</div>
						</section>
						{#if s.encryption}
							{#await import('./EncryptionSettings.svelte') then m}
								<m.default />
							{/await}
						{/if}
					{:else if section.id === 'shortcuts'}
						<section class="group">
							<h3>Everywhere</h3>
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
						</section>
						{#if s.vim}
							<section class="group">
								<h3>Vim motions</h3>
								{#each vimShortcuts as sc (sc.desc)}
									<div class="sc-row">
										<span class="sc-desc">{sc.desc}</span>
										<span class="keys">
											{#each sc.keys as k, i (i)}<kbd>{k}</kbd>{/each}
										</span>
									</div>
								{/each}
							</section>
						{/if}
						<p class="note">
							<strong>Mod</strong> is <kbd>⌘</kbd> on macOS and <kbd>Ctrl</kbd> on Linux / Windows.
							<kbd>Mod</kbd> + <kbd>/</kbd> shows this list anywhere.
						</p>
					{/if}
				</div>
			{/key}
		{/if}
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
	.settings.phone {
		border-radius: 0;
		box-shadow: none;
	}
	.head {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 16px 16px 12px 24px;
		background: var(--bg-editor);
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	.phone .head {
		padding: 6px 6px 6px 10px;
	}
	.head h1 {
		flex: 1;
		margin: 0;
		font-size: 20px;
		font-weight: 700;
		color: var(--text-strong);
	}
	.phone .head h1 {
		font-size: 18px;
		padding-inline-start: 6px;
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 9px;
		color: var(--text-muted);
		transition: background var(--dur-fast) ease;
	}
	:global(html[data-touch]) .icon-btn {
		width: 44px;
		height: 44px;
	}
	.icon-btn:hover,
	.icon-btn:active {
		background: var(--bg-hover);
		color: var(--text);
	}
	.frame {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	/* --- section nav ------------------------------------------------------- */
	.nav {
		flex: 0 0 196px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 10px;
		overflow-y: auto;
		box-shadow: inset -1px 0 0 var(--bg-hover);
	}
	.nav.index {
		flex: 1;
		padding: 10px 10px calc(16px + env(safe-area-inset-bottom, 0px));
		box-shadow: none;
	}
	.nav-item {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 34px;
		padding: 0 10px;
		border-radius: 8px;
		font-size: 13.5px;
		font-weight: 500;
		color: var(--text-muted);
		text-align: start;
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}
	:global(html[data-touch]) .nav-item {
		min-height: 44px;
	}
	.nav-item:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.nav-item:active {
		background: var(--bg-active);
	}
	.nav-item.on {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.index .nav-item {
		min-height: 62px;
		gap: 14px;
		padding: 0 8px 0 12px;
		color: var(--text-muted);
	}
	.nav-ico {
		display: grid;
		place-items: center;
	}
	.index .nav-ico {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.nav-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.index .nav-label {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-strong);
	}
	.nav-desc {
		font-size: 12.5px;
		color: var(--text-muted);
	}

	/* --- section body ------------------------------------------------------ */
	.pane-body {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		padding: 18px 32px 48px;
	}
	.phone .pane-body {
		padding: 8px 16px calc(32px + env(safe-area-inset-bottom, 0px));
	}
	.pane-body > :global(*) {
		max-width: 640px;
	}
	.section-title {
		margin: 4px 0 18px;
		font-size: 17px;
		font-weight: 700;
		color: var(--text-strong);
	}
	.group {
		margin-bottom: 26px;
	}
	.group h3,
	.pane-body :global(.group h2) {
		font-size: 11.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		margin: 0 0 4px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 12px 2px;
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	.row:last-child {
		box-shadow: none;
	}
	/* Narrow screens: the control drops under its label instead of squeezing it. */
	.phone .row.wrap {
		flex-wrap: wrap;
		gap: 10px;
	}
	.phone .row.wrap > .label {
		flex: 1 1 100%;
	}
	.phone .row.wrap > select {
		flex: 1 1 100%;
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
	.phone .name {
		font-size: 15px;
	}
	.desc {
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-muted);
	}
	.desc.path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 360px;
	}
	.prose {
		margin: 4px 0 0;
		font-size: 13px;
		line-height: 1.6;
		color: var(--text-muted);
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.92em;
	}
	.btn {
		flex: 0 0 auto;
		min-height: 32px;
		padding: 0 14px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text);
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
	.btn:active {
		transform: scale(0.97);
	}
	select {
		flex: 0 0 auto;
		min-height: 32px;
		font-family: inherit;
		font-size: 13px;
		color: var(--text);
		background: var(--bg-hover);
		border: none;
		border-radius: 8px;
		padding: 0 10px;
		cursor: pointer;
	}
	:global(html[data-touch]) select {
		min-height: 44px;
		font-size: 15px;
	}
	select:focus {
		outline: 2px solid var(--accent-soft);
	}
	.segmented {
		flex: 0 0 auto;
		display: flex;
		gap: 2px;
		padding: 2px;
		border-radius: 9px;
		background: var(--bg-hover);
	}
	.seg {
		min-height: 28px;
		padding: 0 14px;
		border-radius: 7px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}
	:global(html[data-touch]) .seg {
		min-height: 40px;
		padding: 0 18px;
	}
	.seg.on {
		background: var(--bg-editor);
		color: var(--text-strong);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
	}
	.swatches {
		flex: 0 1 auto;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.swatch {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--sw);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
		transition: transform var(--dur-fast) var(--ease-spring);
	}
	:global(html[data-touch]) .swatch {
		width: 34px;
		height: 34px;
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
	.toggle:active {
		filter: brightness(0.95);
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
