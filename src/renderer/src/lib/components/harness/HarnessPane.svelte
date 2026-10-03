<script lang="ts">
	import { tick } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { getAppState } from '../../stores/app.svelte';
	import { getAiSettings } from '../../harness/config.svelte';
	import { getHarness, type Entry } from '../../harness/harness.svelte';
	import { fromKey, mentionText, type Mention } from '../../harness/mentions';
	import { describeError } from '../../harness/errors';
	import { flattenTagTree } from '../../editor/TagSuggest';
	import { OPENCODE_ZEN, SEARCH_KINDS, ZEN_KEY_URL, type SearchProfile } from '../../harness/types';
	import { reducedMotion } from '../../portal';
	import Markdown from './Markdown.svelte';
	import QuestionPanel from './QuestionPanel.svelte';
	import ToolRow from './ToolRow.svelte';
	import DiffView from '../DiffView.svelte';
	import Icon from '../Icon.svelte';
	import ActionMenu, { type MenuItem } from '../ActionMenu.svelte';
	import EmptyState from '../EmptyState.svelte';
	import mascotSearch from '$lib/assets/fr5a-search.png';

	const app = getAppState();
	const ai = getAiSettings();
	const h = getHarness();
	h.init();

	const tab = $derived(h.tab);
	const provider = $derived(tab ? h.providerFor(tab) : null);
	const skill = $derived(tab ? h.skill(tab.skill) : null);
	const ctx = $derived(tab ? h.context(tab) : null);
	const phone = $derived(app.layout === 'phone');
	const dur = reducedMotion() ? 0 : 1;

	let input = $state('');
	let inputEl: HTMLTextAreaElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let historyOpen = $state(false);
	let ctxOpen = $state(false);
	let confirmDelete = $state<string | null>(null);
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let suggestIndex = $state(0);
	let actMenu = $state<{ at: { x: number; y: number }; entry: Entry; last: boolean } | null>(null);
	let sessionBtn = $state<HTMLButtonElement | null>(null);
	let sessionMenu = $state<{ x: number; y: number } | null>(null);
	let saving = $state(false);

	// The default (OpenCode Zen) and other cloud providers need a key; say so up front.
	let keyMissing = $state(false);
	$effect(() => {
		const p = provider;
		void app.view; // re-check after visiting Settings
		if (!p || p.local) keyMissing = false;
		else void ai.apiKey(p.id).then((k) => (keyMissing = !k));
	});

	// Offline: say so before a send fails.
	let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
	$effect(() => {
		const up = () => (online = true);
		const down = () => (online = false);
		window.addEventListener('online', up);
		window.addEventListener('offline', down);
		return () => {
			window.removeEventListener('online', up);
			window.removeEventListener('offline', down);
		};
	});

	function flash(text: string): void {
		toast = text;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 2200);
	}

	// --- web search toggle (global setting, surfaced here) -----------------------

	let lastSearch: SearchProfile | null = ai.config.search;
	const searchLabel = $derived(
		ai.config.search
			? (SEARCH_KINDS.find((k) => k.kind === ai.config.search?.kind)?.label ?? 'on')
			: null
	);
	function toggleWeb(): void {
		if (ai.config.search) {
			lastSearch = ai.config.search;
			ai.update({ search: null });
			flash('Web search off');
		} else {
			// DuckDuckGo needs no key, so it works the moment it's switched on.
			ai.update({ search: lastSearch ?? { kind: 'duckduckgo', baseUrl: '' } });
			flash(`Web search on (${searchLabel ?? 'DuckDuckGo'})`);
		}
	}

	// --- / and @ suggestions ---------------------------------------------------

	type Suggestion = { label: string; hint: string; insert: string };

	const suggestions = $derived.by((): Suggestion[] => {
		const slash = /^\/([\w-]*)$/.exec(input);
		if (slash) {
			const q = slash[1].toLowerCase();
			return h.skills
				.filter((s) => s.name.startsWith(q))
				.map((s) => ({ label: `/${s.name}`, hint: s.description, insert: `/${s.name} ` }));
		}
		const at = /(?:^|\s)@([^\s"]*)$/.exec(input);
		if (at) {
			const raw = at[1];
			const head = input.slice(0, input.length - raw.length - 1);
			const insert = (m: Mention) => `${head}${mentionText(m)} `;
			// @#… → tags
			if (raw.startsWith('#')) {
				const q = raw.slice(1).toLowerCase();
				return flattenTagTree(app.tags)
					.filter((t) => t.toLowerCase().includes(q))
					.slice(0, 8)
					.map((t) => ({
						label: `#${t}`,
						hint: 'tag',
						insert: insert({ kind: 'tag', value: t })
					}));
			}
			const q = raw.toLowerCase();
			const folders = app.folders
				.filter((f) => f.toLowerCase().includes(q))
				.slice(0, 4)
				.map((f) => ({
					label: `${f}/`,
					hint: `folder · ${app.notes.filter((n) => n.id.startsWith(`${f}/`)).length} notes`,
					insert: insert({ kind: 'dir', value: f })
				}));
			const notes = app.notes
				.filter((n) => n.id.toLowerCase().includes(q) || n.title.toLowerCase().includes(q))
				.slice(0, 8 - folders.length)
				.map((n) => ({
					label: n.title,
					hint: n.id,
					insert: insert({ kind: 'note', value: n.id })
				}));
			const tagHint = raw ? [] : [{ label: '#tag', hint: 'type @# for tags', insert: `${head}@#` }];
			return [...folders, ...notes, ...tagHint];
		}
		return [];
	});

	$effect(() => {
		void suggestions.length;
		suggestIndex = 0;
	});

	function pick(s: Suggestion): void {
		input = s.insert;
		inputEl?.focus();
	}

	// --- sending -----------------------------------------------------------------

	async function submit(): Promise<void> {
		const t = tab;
		if (!t) return;
		const text = input.trim();
		if (!text || t.running) return;
		const before = t.entries.length;
		input = '';
		pinned = true;
		await h.send(text);
		// Nothing went out (no provider, unknown skill…): keep the draft.
		if (!t.entries.slice(before).some((e) => e.kind === 'you') && !input) input = text;
	}

	function retry(): void {
		pinned = true;
		void h.retry(tab);
	}

	function onKeydown(e: KeyboardEvent): void {
		if (suggestions.length) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				const n = suggestions.length;
				suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
				return;
			}
			if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
				e.preventDefault();
				pick(suggestions[suggestIndex]);
				return;
			}
		}
		// Enter sends; Shift+Enter (hardware keyboards) adds a line.
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			void submit();
		} else if (e.key === 'Escape' && tab?.running) {
			e.preventDefault();
			tab.stop();
		}
	}

	function autosize(el: HTMLTextAreaElement): void {
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
	}
	$effect(() => {
		void input;
		if (inputEl) autosize(inputEl);
	});

	// --- transcript -------------------------------------------------------------

	// Follow the stream only while the user is at the bottom.
	let pinned = $state(true);
	function onScroll(): void {
		if (!scroller) return;
		pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
	}
	function jumpToLatest(): void {
		pinned = true;
		scroller?.scrollTo({
			top: scroller.scrollHeight,
			behavior: reducedMotion() ? 'auto' : 'smooth'
		});
	}
	$effect(() => {
		const t = tab;
		if (!t) return;
		// Track the length + the last entry's text so streaming keeps us pinned.
		void t.entries.length;
		const last = t.entries[t.entries.length - 1];
		void (last && 'text' in last ? last.text : null);
		void t.question;
		void t.approval;
		if (pinned) void tick().then(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
	});

	async function act(e: Entry, mode: 'insert' | 'append' | 'new' | 'copy'): Promise<void> {
		if (e.kind !== 'ai') return;
		try {
			if (mode === 'copy') {
				await navigator.clipboard.writeText(e.text);
				flash('Copied');
			} else flash(await h.applyText(e.text, mode));
		} catch (err) {
			flash(err instanceof Error ? err.message : String(err));
		}
	}

	function sessionLabel(file: string): string {
		return file.replace(/\.md$/, '').replace(/^(\d{4}-\d{2}-\d{2})-\d{6}-/, '$1 · ');
	}

	/** The one output action a skill recommends; Copy otherwise. */
	const primary = $derived<'insert' | 'new' | 'copy'>(
		skill?.output === 'insert' ? 'insert' : skill?.output === 'new-note' ? 'new' : 'copy'
	);
	const hasNote = $derived(!!app.activeId || app.draft);
	const ACT_LABEL = { insert: 'Insert', append: 'Append', new: 'New note', copy: 'Copy' } as const;

	const lastAi = $derived.by(() => {
		if (!tab) return -1;
		for (let i = tab.entries.length - 1; i >= 0; i--) if (tab.entries[i].kind === 'ai') return i;
		return -1;
	});
	/** Index of the newest entry; Retry lives on the last error / stop / reply. */
	const lastIndex = $derived(tab ? tab.entries.length - 1 : -1);

	function openActs(ev: MouseEvent, e: Entry, last: boolean): void {
		const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
		actMenu = { at: { x: r.left, y: r.bottom + 4 }, entry: e, last };
	}

	const actItems = $derived.by((): MenuItem[] => {
		if (!actMenu) return [];
		const e = actMenu.entry;
		const items: MenuItem[] = (['copy', 'insert', 'append', 'new'] as const)
			.filter((m) => m !== primary)
			.map((m) => ({
				label: ACT_LABEL[m],
				icon: m === 'copy' ? 'copy' : m === 'new' ? 'note' : m === 'insert' ? 'insert' : 'append',
				disabled: (m === 'insert' || m === 'append') && !hasNote,
				action: () => void act(e, m)
			}));
		if (actMenu.last && !tab?.running)
			items.push({ label: 'Retry', icon: 'retry', divider: true, action: retry });
		return items;
	});

	// --- session menu: save to notes, fork ----------------------------------------

	const savedNote = $derived(
		tab?.session.saved ? app.notes.find((n) => n.id === tab.session.saved) : undefined
	);
	const chatsFolder = $derived(ai.config.chatsFolder?.trim() || 'top level');
	const hiddenCount = $derived(app.notes.filter((n) => app.hiddenFromAi(n)).length);

	async function saveChat(asNew = false): Promise<void> {
		if (saving) return;
		saving = true;
		try {
			const msg = await h.saveToNotes(tab, asNew);
			if (msg) flash(msg);
		} catch (err) {
			flash(err instanceof Error ? err.message : String(err));
		} finally {
			saving = false;
		}
	}

	function forkChat(): void {
		h.fork(tab);
		flash('Forked — the original is unchanged');
	}

	function openSessionMenu(): void {
		if (sessionMenu) {
			sessionMenu = null;
			return;
		}
		const r = sessionBtn!.getBoundingClientRect();
		sessionMenu = { x: r.right - 220, y: r.bottom + 4 };
	}

	const sessionItems = $derived.by((): MenuItem[] => {
		const empty = !tab?.entries.some((e) => e.kind === 'ai' || e.kind === 'you');
		const busy = !!tab?.running || saving;
		const items: MenuItem[] = savedNote
			? [
					{
						label: 'Update saved note',
						icon: 'save',
						hint:
							savedNote.title.length > 22 ? `${savedNote.title.slice(0, 21)}…` : savedNote.title,
						disabled: empty || busy,
						action: () => void saveChat()
					},
					{
						label: 'Save as new note',
						icon: 'note',
						disabled: empty || busy,
						action: () => void saveChat(true)
					},
					{
						label: 'Open saved note',
						icon: 'eye',
						action: () => void app.openNote(savedNote.id)
					}
				]
			: [
					{
						label: 'Save to notes',
						icon: 'save',
						hint: `${chatsFolder}/`,
						disabled: empty || busy,
						action: () => void saveChat()
					}
				];
		items.push({
			label: 'Fork conversation',
			icon: 'fork',
			divider: true,
			disabled: empty || !!tab?.running,
			action: forkChat
		});
		return items;
	});

	async function deleteSession(file: string): Promise<void> {
		confirmDelete = null;
		try {
			await h.deleteSession(file);
		} catch (err) {
			flash(err instanceof Error ? err.message : String(err));
		}
	}

	function openHistory(): void {
		historyOpen = !historyOpen;
		confirmDelete = null;
		if (historyOpen) void h.refreshSessions();
	}
</script>

{#snippet retryBtn()}
	<button class="chip-btn" onclick={retry} disabled={tab?.running}>
		<Icon name="retry" size={14} /> Retry
	</button>
{/snippet}

<section class="harness" class:phone aria-label="AI harness">
	<header class="tabs">
		<div class="tab-strip" role="tablist">
			{#each h.tabs as t, i (t)}
				<div class="tab" class:on={i === h.active} role="tab" aria-selected={i === h.active}>
					<button class="tab-name" onclick={() => (h.active = i)} title={t.title}>
						{#if t.running}<span class="dot" aria-label="running"></span>{/if}
						<span class="idx">{i + 1}</span><span class="ttl">{t.title}</span>
					</button>
					<button class="tab-x" aria-label="Close tab" onclick={() => h.closeTab(i)}>×</button>
				</div>
			{/each}
		</div>
		<button class="icon" title="New session" aria-label="New session" onclick={() => h.newTab()}>
			<Icon name="plus" size={17} />
		</button>
		<button
			class="icon"
			class:on={historyOpen}
			title="Past sessions"
			aria-label="Past sessions"
			aria-expanded={historyOpen}
			onclick={openHistory}
		>
			<Icon name="history" size={16} />
		</button>
		<button
			bind:this={sessionBtn}
			class="icon"
			class:on={!!sessionMenu}
			title="Save to notes, fork"
			aria-label="Session actions"
			aria-haspopup="menu"
			aria-expanded={!!sessionMenu}
			onclick={openSessionMenu}
		>
			<Icon name="more" size={16} />
		</button>
		<button
			class="icon"
			title="Close (Mod+J)"
			aria-label="Close AI pane"
			onclick={() => app.closeHarness()}
		>
			<Icon name="close" size={16} />
		</button>
	</header>

	{#if historyOpen}
		<div
			class="history"
			class:sheet={phone}
			transition:fly={{ y: phone ? 24 : -6, duration: 180 * dur }}
		>
			<div class="hist-head">
				<strong>Sessions</strong>
				<span class="muted">{h.sessionFiles.length || ''}</span>
				<button class="icon" aria-label="Close sessions" onclick={() => (historyOpen = false)}>
					<Icon name="close" size={15} />
				</button>
			</div>
			<div class="hist-list">
				{#if h.sessionsLoading && !h.sessionFiles.length}
					<p class="muted pad">Loading…</p>
				{:else if h.sessionsError}
					<div class="pad">
						<p class="err-text">Couldn't list sessions: {h.sessionsError}</p>
						<button class="chip-btn" onclick={() => h.refreshSessions()}>
							<Icon name="retry" size={14} /> Try again
						</button>
					</div>
				{:else}
					{#each h.sessionFiles as f (f)}
						<div class="hist-row" transition:slide={{ duration: 140 * dur }}>
							{#if confirmDelete === f}
								<span class="confirm">Delete this session?</span>
								<button class="chip-btn danger" onclick={() => deleteSession(f)}>Delete</button>
								<button class="chip-btn" onclick={() => (confirmDelete = null)}>Keep</button>
							{:else}
								<button
									class="hist-open"
									onclick={() => {
										historyOpen = false;
										void h.openSession(f);
									}}>{sessionLabel(f)}</button
								>
								<button
									class="icon small"
									aria-label="Delete session"
									title="Delete"
									onclick={() => (confirmDelete = f)}><Icon name="trash" size={14} /></button
								>
							{/if}
						</div>
					{:else}
						<p class="muted pad">
							No sessions yet. Every chat is kept in <code>.fr5a/sessions/</code>; use ⋯ → Save to
							notes to put one in your notes.
						</p>
					{/each}
				{/if}
			</div>
		</div>
	{/if}

	{#if tab}
		<div class="context">
			<button class="ctx-sum" aria-expanded={ctxOpen} onclick={() => (ctxOpen = !ctxOpen)}>
				<span class="prov">
					{#if provider?.local}<span class="local" title="Local provider">●</span>{/if}
					{provider ? `${provider.name} · ${provider.model}` : 'No provider'}
				</span>
				{#if ctx}
					<span class="pill" title="Notes sent with the next message"
						>{ctx.ids.length}{ctx.omitted ? `+${ctx.omitted}` : ''}
						{ctx.ids.length === 1 && !ctx.omitted ? 'note' : 'notes'}</span
					>
				{/if}
				{#if tab.attached.length}
					<span class="pill" title={tab.attached.join(', ')}>+{tab.attached.length} attached</span>
				{/if}
				{#if skill}<span class="pill accent">/{skill.name}</span>{/if}
				{#if searchLabel}<span class="pill" title="Web search on"
						><Icon name="web" size={11} /> web</span
					>{/if}
				<span class="tokens" title="Approximate tokens in history + open note"
					>~{h.estimate(tab).toLocaleString()}</span
				>
				<span class="chev" class:open={ctxOpen}><Icon name="chevron" size={13} /></span>
			</button>
			{#if ctxOpen}
				<div class="ctx-more" transition:slide={{ duration: 160 * dur }}>
					<label class="ctx-row">
						<span class="k">Model</span>
						<select
							class="provider"
							aria-label="Provider"
							value={provider?.id ?? ''}
							onchange={(e) =>
								(tab.providerId = (e.currentTarget as HTMLSelectElement).value || null)}
						>
							{#each ai.config.providers as p (p.id)}
								<option value={p.id}>{p.name} · {p.model}</option>
							{:else}
								<option value="">No provider</option>
							{/each}
						</select>
					</label>
					<div class="ctx-row">
						<span class="k">Context</span>
						<div class="chips">
							<button
								class="chip"
								class:off={!tab.useCurrent}
								aria-pressed={tab.useCurrent}
								title="Attach the open note"
								onclick={() => (tab.useCurrent = !tab.useCurrent)}
							>
								{tab.useCurrent ? '◉' : '○'} open note
							</button>
							{#each tab.attached as id (id)}
								{@const m = fromKey(id)}
								<span class="chip {m.kind}" title={id}>
									{m.kind === 'tag'
										? `#${m.value}`
										: m.kind === 'dir'
											? `▸ ${m.value || 'all'}/`
											: `@${m.value.split('/').pop()}`}
									<button
										aria-label="Detach"
										onclick={() => (tab.attached = tab.attached.filter((x) => x !== id))}>×</button
									>
								</span>
							{/each}
							{#if skill}
								<span class="chip skill" title={skill.description}>
									/{skill.name}
									<button aria-label="Clear skill" onclick={() => (tab.skill = null)}>×</button>
								</span>
							{/if}
						</div>
					</div>
					<div class="ctx-row">
						<span class="k">Web</span>
						<button
							class="chip"
							class:off={!searchLabel}
							aria-pressed={!!searchLabel}
							onclick={toggleWeb}
						>
							<Icon name="web" size={12} />
							{searchLabel ? `Search on · ${searchLabel}` : 'Search off — turn on'}
						</button>
						<button class="link" onclick={() => app.openSettings('ai')}>Settings…</button>
					</div>
					{#if provider && !provider.local}
						<p class="privacy">
							<strong>{provider.name}</strong> is a cloud provider. {hiddenCount
								? `${hiddenCount} ${hiddenCount === 1 ? 'note is' : 'notes are'} hidden from cloud AI and never sent.`
								: 'No notes are hidden from cloud AI.'}
							<button class="link" onclick={() => app.openSettings('ai')}>Manage…</button>
						</p>
					{:else if provider}
						<p class="privacy">
							<strong>{provider.name}</strong> runs on your hardware: it may read every note, including
							ones hidden from cloud AI.
						</p>
					{/if}
				</div>
			{/if}
		</div>

		<div class="transcript-wrap">
			<div class="transcript" bind:this={scroller} onscroll={onScroll}>
				{#if !tab.entries.length}
					<div class="welcome" in:fade={{ duration: 160 * dur }}>
						{#if keyMissing && provider}
							<p class="lead">
								{provider.name} needs an API key{provider.id === OPENCODE_ZEN.id
									? ' (free — big-pickle costs nothing)'
									: ''}.
							</p>
							{#if provider.id === OPENCODE_ZEN.id}
								<p class="muted">
									Get one at <a href={ZEN_KEY_URL} target="_blank" rel="noreferrer"
										>opencode.ai/zen</a
									>, then paste it in Settings → AI.
								</p>
							{/if}
							<button class="btn" onclick={() => app.openSettings('ai')}>Open Settings → AI</button>
						{:else if !ai.config.providers.length}
							<p class="lead">
								Add a provider (DeepSeek, OpenRouter, a local llama.cpp / Ollama over VPN…) to
								start.
							</p>
							<button class="btn" onclick={() => app.openSettings('ai')}>Open Settings → AI</button>
						{:else}
							<EmptyState
								small
								src={mascotSearch}
								title="Ask about {ctx?.ids.length ? 'this note' : 'your notes'}"
							/>
							<p class="muted">
								<kbd>/</kbd> skills · <kbd>@</kbd> note · <kbd>@folder/</kbd> · <kbd>@#tag</kbd>
								{#if !searchLabel}
									· <button class="link" onclick={toggleWeb}>turn on web search</button>
								{/if}
							</p>
							<div class="skills">
								{#each h.skills as s (s.name)}
									<button
										class="skill-btn"
										title={s.description}
										onclick={() => h.send(`/${s.name}`)}
									>
										<span>/{s.name}</span><small>{s.description}</small>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				{#each tab.entries as e, i (e)}
					{#if e.kind === 'you'}
						<div class="msg you" dir="auto"><span class="pre">{e.text}</span></div>
					{:else if e.kind === 'ai'}
						<div class="msg ai" class:streaming={e.streaming}>
							<Markdown text={e.text} />
							{#if e.streaming}<span class="caret" aria-hidden="true"></span>{/if}
							{#if !e.streaming && e.text.trim()}
								<div class="acts" class:show={i === lastAi}>
									<button
										class="primary"
										disabled={primary !== 'copy' && primary !== 'new' && !hasNote}
										onclick={() => act(e, primary)}
									>
										<Icon
											name={primary === 'copy' ? 'copy' : primary === 'new' ? 'note' : 'insert'}
											size={13}
										/>
										{ACT_LABEL[primary]}
									</button>
									{#if phone}
										<button
											aria-label="More actions"
											aria-haspopup="menu"
											onclick={(ev) => openActs(ev, e, i === lastIndex)}
										>
											<Icon name="more" size={15} />
										</button>
									{:else}
										{#each (['copy', 'insert', 'append', 'new'] as const).filter((m) => m !== primary) as m (m)}
											<button
												disabled={(m === 'insert' || m === 'append') && !hasNote}
												onclick={() => act(e, m)}>{ACT_LABEL[m]}</button
											>
										{/each}
										{#if i === lastIndex && !tab.running}
											<button title="Run the last message again" onclick={retry}>
												<Icon name="retry" size={13} /> Retry
											</button>
										{/if}
									{/if}
								</div>
							{/if}
						</div>
					{:else if e.kind === 'tool'}
						<ToolRow entry={e} running={tab.running} />
					{:else if e.kind === 'error'}
						{@const info = describeError(e.text, e.status, online)}
						<div class="note err" role="alert">
							<div class="err-head">
								<Icon name="close" size={14} stroke={2.2} />
								<strong>{info.title}</strong>
							</div>
							<p class="err-text" dir="auto">{e.text}</p>
							{#if info.hint}<p class="err-hint">{info.hint}</p>{/if}
							{#if i === lastIndex && (info.retry || info.settings)}
								<div class="err-acts">
									{#if info.retry}{@render retryBtn()}{/if}
									{#if info.settings}
										<button class="chip-btn" onclick={() => app.openSettings('ai')}>
											<Icon name="settings" size={14} /> Settings → AI
										</button>
									{/if}
								</div>
							{/if}
						</div>
					{:else if e.text === 'Stopped.'}
						<div class="note stopped">
							<span><Icon name="stop" size={11} stroke={2.4} /> Stopped.</span>
							{#if i === lastIndex}{@render retryBtn()}{/if}
						</div>
					{:else}
						<div class="note">{e.text}</div>
					{/if}
				{/each}

				{#if tab.running && !tab.question && !tab.approval && tab.entries[tab.entries.length - 1]?.kind !== 'ai'}
					<div class="thinking" role="status">
						<span class="spinner"></span> thinking<span class="dots"></span>
					</div>
				{/if}
			</div>
			{#if !pinned && tab.entries.length}
				<button class="jump" onclick={jumpToLatest} transition:fly={{ y: 8, duration: 140 * dur }}>
					<Icon name="down" size={14} /> Latest
				</button>
			{/if}
		</div>

		{#if !online}
			<div class="offline" role="status" transition:slide={{ duration: 160 * dur }}>
				You're offline — messages will fail until the connection is back.
			</div>
		{/if}

		{#if tab.question}
			<QuestionPanel
				question={tab.question}
				onanswer={(a) => tab.reply(a)}
				onstop={() => tab.stop()}
			/>
		{:else if tab.approval}
			{@const a = tab.approval}
			<div
				class="dock approval"
				role="group"
				aria-label="Review change"
				in:fly={{ y: 16, duration: 200 * dur }}
			>
				<div class="dock-head">
					<span class="dock-title">Review change</span>
					<span class="stat add">+{a.added}</span><span class="stat del">−{a.removed}</span>
				</div>
				<p class="what"><strong>{a.mode}</strong> → {a.label}</p>
				<div class="dock-body">
					<DiffView lines={a.diff} numbers={false} />
				</div>
				<div class="dock-foot">
					<button class="ghost" onclick={() => tab.stop()} title="Stop the run">Stop</button>
					<span class="spacer"></span>
					<button class="ghost" onclick={() => tab.settle(false)}>Reject</button>
					<button class="primary" onclick={() => tab.settle(true)}>Apply</button>
				</div>
			</div>
		{:else}
			<footer class="prompt">
				{#if suggestions.length}
					<ul class="suggest" role="listbox">
						{#each suggestions as s, k (s.label + s.hint)}
							<li role="option" aria-selected={k === suggestIndex}>
								<button
									class:on={k === suggestIndex}
									onmousedown={(ev) => ev.preventDefault()}
									onclick={() => pick(s)}
								>
									<span>{s.label}</span><small>{s.hint}</small>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				<span class="ps1" aria-hidden="true">›</span>
				<textarea
					bind:this={inputEl}
					bind:value={input}
					rows="1"
					dir="auto"
					aria-label="Message"
					enterkeyhint="send"
					placeholder={tab.running ? 'Running… draft your next message' : 'Ask, /skill, @note'}
					onkeydown={onKeydown}></textarea>
				{#if tab.running}
					<button class="send stop" aria-label="Stop" title="Stop (Esc)" onclick={() => tab.stop()}>
						<Icon name="stop" size={13} stroke={2.4} /><span>Stop</span>
					</button>
				{:else}
					<button
						class="send"
						aria-label="Send"
						title="Send (Enter)"
						disabled={!input.trim()}
						onclick={submit}
					>
						<Icon name="send" size={15} stroke={2.2} />
					</button>
				{/if}
			</footer>
		{/if}
	{/if}

	{#if toast}<div class="toast" role="status" transition:fade={{ duration: 120 * dur }}>
			{toast}
		</div>{/if}
</section>

{#if sessionMenu}
	<ActionMenu
		items={sessionItems}
		at={sessionMenu}
		sheet={phone}
		title={tab?.title ?? 'Session'}
		label="Session actions"
		trigger={sessionBtn}
		onclose={() => (sessionMenu = null)}
	/>
{/if}

{#if actMenu}
	<ActionMenu
		items={actItems}
		at={actMenu.at}
		sheet={phone}
		title="Reply"
		label="Reply actions"
		onclose={() => (actMenu = null)}
	/>
{/if}

<style>
	.harness {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-editor);
		border-radius: 12px;
		box-shadow: var(--shadow-pane);
		overflow: hidden;
		font-size: 13px;
		color: var(--text);
	}

	/* --- tab strip (tmux-like) --------------------------------------------- */
	.tabs {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 6px 6px 0;
		box-shadow: inset 0 -1px 0 var(--bg-active);
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.tab-strip {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: flex-end;
		gap: 2px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tab {
		display: flex;
		align-items: center;
		max-width: 180px;
		border-radius: 8px 8px 0 0;
		color: var(--text-muted);
		transition: background var(--dur-fast) ease;
	}
	.tab.on {
		background: var(--accent-soft);
		color: var(--text-strong);
	}
	.tab-name {
		display: flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		min-height: 30px;
		padding: 0 2px 0 9px;
		white-space: nowrap;
	}
	:global(html[data-touch]) .tab-name {
		min-height: 40px;
	}
	.ttl {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.idx {
		color: var(--accent);
		font-weight: 700;
	}
	.dot {
		flex: 0 0 auto;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse 1s ease-in-out infinite;
	}
	.tab-x {
		min-width: 24px;
		min-height: 30px;
		color: var(--text-faint);
		font-size: 15px;
		line-height: 1;
	}
	:global(html[data-touch]) .tab-x {
		min-width: 36px;
		min-height: 40px;
	}
	.tab-x:hover {
		color: var(--text-strong);
	}
	.icon {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		color: var(--text-muted);
		transition:
			background var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .icon {
		width: 44px;
		height: 44px;
	}
	.icon.small {
		width: 28px;
		height: 28px;
	}
	.icon:hover,
	.icon.on {
		background: var(--bg-hover);
		color: var(--text-strong);
	}
	.icon:active {
		transform: scale(0.93);
	}

	/* --- history: popover (wide) / full-height sheet (phone) ---------------- */
	.history {
		position: absolute;
		top: 44px;
		right: 8px;
		z-index: 12;
		width: min(340px, calc(100% - 16px));
		max-height: 60%;
		display: flex;
		flex-direction: column;
		border-radius: 12px;
		background: var(--bg-editor);
		box-shadow:
			0 0 0 1px var(--bg-active),
			0 14px 36px rgba(0, 0, 0, 0.2);
	}
	:global(html[data-touch]) .history {
		top: 52px;
	}
	.history.sheet {
		inset: 0;
		width: auto;
		max-height: none;
		border-radius: 0;
		box-shadow: none;
	}
	.hist-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 6px 6px 14px;
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	.hist-head strong {
		flex: 1;
		font-size: 13px;
		color: var(--text-strong);
	}
	.hist-list {
		overflow-y: auto;
		padding: 6px;
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.hist-row {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 34px;
	}
	:global(html[data-touch]) .hist-row {
		min-height: 48px;
	}
	.hist-open {
		flex: 1;
		min-width: 0;
		align-self: stretch;
		text-align: start;
		padding: 0 8px;
		border-radius: 7px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hist-open:hover,
	.hist-open:active {
		background: var(--bg-hover);
	}
	.confirm {
		flex: 1;
		padding: 0 8px;
		font-family: var(--font-ui);
		color: var(--text);
	}
	.pad {
		padding: 10px;
		font-family: var(--font-ui);
	}

	/* --- context summary ----------------------------------------------------- */
	.context {
		flex: 0 0 auto;
		box-shadow: inset 0 -1px 0 var(--bg-active);
		font-size: 11.5px;
	}
	.ctx-sum {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		min-height: 32px;
		padding: 0 10px;
		text-align: start;
		color: var(--text-muted);
	}
	:global(html[data-touch]) .ctx-sum {
		min-height: 42px;
		font-size: 12.5px;
	}
	.ctx-sum:hover {
		background: var(--bg-hover);
	}
	.prov {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-weight: 500;
	}
	.local {
		color: var(--ok);
		font-size: 9px;
	}
	.pill {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--bg-hover);
		white-space: nowrap;
	}
	.pill.accent {
		background: var(--accent-soft);
		font-family: var(--font-mono);
	}
	.tokens {
		margin-inline-start: auto;
		flex: 0 0 auto;
		color: var(--text-faint);
		font-family: var(--font-mono);
		font-size: 10.5px;
	}
	.chev {
		flex: 0 0 auto;
		display: grid;
		color: var(--text-faint);
		transition: transform var(--dur-pane) var(--ease-out);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.ctx-more {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 4px 10px 10px;
	}
	.ctx-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}
	.k {
		flex: 0 0 54px;
		color: var(--text-faint);
	}
	.chips {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.provider {
		flex: 1;
		min-width: 0;
		max-width: 280px;
		min-height: 28px;
		padding: 0 6px;
		border-radius: 7px;
		border: 1px solid var(--bg-active);
		background: var(--bg-list);
		color: var(--text);
		font: inherit;
	}
	:global(html[data-touch]) .provider {
		min-height: 40px;
		font-size: 14px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 24px;
		padding: 0 9px;
		border-radius: 999px;
		background: var(--bg-hover);
		color: var(--text);
		max-width: 200px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	:global(html[data-touch]) .chip {
		min-height: 34px;
	}
	.chip.off {
		color: var(--text-faint);
	}
	.chip.dir,
	.chip.tag {
		font-family: var(--font-mono);
	}
	.chip.skill {
		background: var(--accent-soft);
		font-family: var(--font-mono);
	}
	.chip button {
		color: var(--text-faint);
		padding: 0 2px;
	}
	.privacy {
		margin: 0;
		color: var(--text-muted);
		line-height: 1.45;
	}
	.link {
		color: var(--accent);
		font-weight: 600;
		font-size: inherit;
		padding: 0;
	}

	/* --- transcript -------------------------------------------------------- */
	.transcript-wrap {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.transcript {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 14px 14px 10px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.pre {
		white-space: pre-wrap;
	}
	.msg {
		overflow-wrap: anywhere;
		line-height: 1.55;
		font-family: var(--font-editor);
	}
	.msg.you {
		align-self: flex-end;
		max-width: 88%;
		padding: 8px 12px;
		border-radius: 14px 14px 4px 14px;
		background: var(--accent-soft);
		color: var(--text-strong);
		font-size: 14px;
		user-select: text;
	}
	:global(html[data-touch]) .msg.you {
		font-size: 15.5px;
	}
	.msg.ai {
		padding: 0 2px;
	}
	.caret {
		display: inline-block;
		width: 7px;
		height: 1em;
		margin-inline-start: 1px;
		vertical-align: text-bottom;
		background: var(--accent);
		animation: blink 1s steps(1) infinite;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 6px;
		opacity: 0;
		transition: opacity var(--dur-fast) ease;
	}
	.msg.ai:hover .acts,
	.msg.ai:focus-within .acts,
	.acts.show,
	:global(html[data-hover='none']) .acts {
		opacity: 1;
	}
	.acts button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 26px;
		padding: 0 9px;
		border-radius: 7px;
		box-shadow: inset 0 0 0 1px var(--bg-active);
		color: var(--text-muted);
		font-size: 11.5px;
		transition:
			background var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .acts button {
		min-height: 40px;
		padding: 0 14px;
		font-size: 13px;
	}
	.acts button:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text-strong);
	}
	.acts button:active:not(:disabled) {
		transform: scale(0.96);
	}
	.acts button:disabled {
		opacity: 0.4;
	}
	.acts button.primary {
		background: var(--accent-soft);
		box-shadow: none;
		color: var(--accent);
		font-weight: 600;
	}
	.note {
		font-size: 12px;
		color: var(--text-muted);
	}
	.note.stopped {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.note.stopped > span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.note.err {
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--danger-soft);
		color: var(--text);
	}
	.err-head {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--danger);
		font-size: 13px;
	}
	.err-text {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--text-muted);
		overflow-wrap: anywhere;
		max-height: 120px;
		overflow-y: auto;
	}
	.err-hint {
		margin: 6px 0 0;
		font-size: 12.5px;
		color: var(--text);
	}
	.err-acts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 10px;
	}
	.chip-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-height: 30px;
		padding: 0 12px;
		border-radius: 8px;
		background: var(--bg-editor);
		box-shadow: inset 0 0 0 1px var(--bg-active);
		font-family: var(--font-ui);
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text);
		transition: transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .chip-btn {
		min-height: 44px;
		padding: 0 16px;
		font-size: 14px;
	}
	.chip-btn:active:not(:disabled) {
		transform: scale(0.96);
	}
	.chip-btn:disabled {
		opacity: 0.5;
	}
	.chip-btn.danger {
		color: var(--danger);
	}
	.thinking {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--text-faint);
	}
	.spinner {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid var(--accent-soft);
		border-top-color: var(--accent);
		animation: spin 700ms linear infinite;
	}
	.dots::after {
		content: '';
		animation: dots 1.2s steps(4) infinite;
	}
	.jump {
		position: absolute;
		bottom: 10px;
		left: 50%;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-height: 30px;
		padding: 0 12px;
		border-radius: 999px;
		background: var(--text-strong);
		color: var(--bg-editor);
		font-size: 12px;
		font-weight: 600;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
	}
	:global(html[data-touch]) .jump {
		min-height: 40px;
		padding: 0 16px;
	}
	.offline {
		flex: 0 0 auto;
		padding: 7px 12px;
		background: var(--danger-soft);
		color: var(--text);
		font-size: 12px;
	}

	.welcome {
		margin: auto 0;
		text-align: center;
		color: var(--text-muted);
	}
	.welcome p {
		margin: 0 0 12px;
	}
	.lead {
		color: var(--text);
		font-size: 14px;
	}
	.skills {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 6px;
		text-align: start;
	}
	.skill-btn {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		border-radius: 9px;
		box-shadow: inset 0 0 0 1px var(--bg-active);
		transition:
			background var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .skill-btn {
		min-height: 56px;
	}
	.skill-btn:hover {
		background: var(--bg-hover);
	}
	.skill-btn:active {
		transform: scale(0.98);
	}
	.skill-btn span {
		font-family: var(--font-mono);
		color: var(--accent);
		font-size: 12px;
	}
	.skill-btn small {
		color: var(--text-muted);
		font-size: 11px;
	}
	.btn {
		min-height: 34px;
		padding: 0 14px;
		border-radius: 9px;
		background: var(--accent);
		color: #fff;
		font-weight: 600;
	}
	:global(html[data-touch]) .btn {
		min-height: 44px;
	}
	kbd {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--code-bg);
		font-family: var(--font-mono);
		font-size: 11px;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.95em;
	}
	.muted {
		color: var(--text-muted);
	}
	.stat {
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.stat.add {
		color: var(--add-fg);
	}
	.stat.del {
		color: var(--del-fg);
	}

	/* --- docked approval card (full width, controls always visible) --------- */
	.dock {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		max-height: min(70%, 560px);
		padding: 12px 14px calc(12px + env(safe-area-inset-bottom, 0px));
		background: var(--bg-editor);
		box-shadow:
			0 -1px 0 var(--bg-active),
			0 -10px 28px rgba(0, 0, 0, 0.08);
	}
	.dock-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.dock-title {
		flex: 1;
		font-size: 15px;
		font-weight: 650;
		color: var(--text-strong);
	}
	.what {
		margin: 4px 0 10px;
		font-size: 12.5px;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.what strong {
		color: var(--text);
	}
	.dock-body {
		min-height: 0;
		overflow-y: auto;
	}
	.dock-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
	}
	.spacer {
		flex: 1;
	}
	.dock-foot button {
		min-height: 34px;
		padding: 0 16px;
		border-radius: 9px;
		font-size: 13px;
		font-weight: 600;
		transition: transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .dock-foot button {
		min-height: 44px;
		font-size: 15px;
	}
	.dock-foot button:active {
		transform: scale(0.97);
	}
	.ghost {
		color: var(--text-muted);
	}
	.ghost:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.dock-foot .primary {
		background: var(--accent);
		color: #fff;
	}

	/* --- prompt ------------------------------------------------------------ */
	.prompt {
		flex: 0 0 auto;
		position: relative;
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 8px 10px calc(10px + env(safe-area-inset-bottom, 0px));
		box-shadow: inset 0 1px 0 var(--bg-active);
	}
	.ps1 {
		padding-bottom: 6px;
		font-family: var(--font-mono);
		font-weight: 700;
		color: var(--accent);
	}
	textarea {
		flex: 1;
		resize: none;
		border: none;
		outline: none;
		background: none;
		color: var(--text-strong);
		font-family: var(--font-mono);
		font-size: 12.5px;
		line-height: 1.5;
		padding: 4px 0;
		max-height: 180px;
	}
	/* ≥16px on touch: no zoom-on-focus, readable while drafting. */
	:global(html[data-touch]) textarea {
		font-size: 16px;
		font-family: var(--font-editor);
		padding: 9px 0;
	}
	textarea::placeholder {
		color: var(--text-faint);
	}
	.send {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-width: 30px;
		height: 30px;
		padding: 0 7px;
		border-radius: 8px;
		background: var(--accent);
		color: #fff;
		font-size: 12.5px;
		font-weight: 600;
		transition:
			opacity var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .send {
		min-width: 44px;
		height: 44px;
		border-radius: 12px;
	}
	.send:active:not(:disabled) {
		transform: scale(0.94);
	}
	.send:disabled {
		opacity: 0.35;
	}
	.send.stop {
		background: var(--text-strong);
		color: var(--bg-editor);
		padding: 0 12px;
	}
	.suggest {
		position: absolute;
		left: 8px;
		right: 8px;
		bottom: calc(100% + 4px);
		max-height: 240px;
		overflow-y: auto;
		margin: 0;
		padding: 4px;
		list-style: none;
		border-radius: 10px;
		background: var(--bg-editor);
		box-shadow:
			var(--shadow-pane),
			0 0 0 1px var(--bg-active);
		z-index: 5;
	}
	.suggest button {
		display: flex;
		width: 100%;
		gap: 8px;
		align-items: baseline;
		padding: 5px 8px;
		border-radius: 6px;
		text-align: start;
	}
	:global(html[data-touch]) .suggest button {
		min-height: 44px;
		align-items: center;
	}
	.suggest button.on {
		background: var(--accent-soft);
	}
	.suggest span {
		font-family: var(--font-mono);
		font-size: 12px;
		white-space: nowrap;
	}
	.suggest small {
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toast {
		position: absolute;
		left: 50%;
		bottom: 72px;
		transform: translateX(-50%);
		max-width: 90%;
		padding: 7px 13px;
		border-radius: 9px;
		background: var(--text-strong);
		color: var(--bg-editor);
		font-size: 12px;
		pointer-events: none;
		z-index: 20;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes dots {
		0% {
			content: '';
		}
		25% {
			content: '.';
		}
		50% {
			content: '..';
		}
		75% {
			content: '...';
		}
	}
</style>
