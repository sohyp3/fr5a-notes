<script lang="ts">
	import { tick } from 'svelte';
	import { getAppState } from '../../stores/app.svelte';
	import { getAiSettings } from '../../harness/config.svelte';
	import { getHarness, type Entry } from '../../harness/harness.svelte';
	import { fromKey, mentionText, type Mention } from '../../harness/mentions';
	import { flattenTagTree } from '../../editor/TagSuggest';
	import { OPENCODE_ZEN, ZEN_KEY_URL } from '../../harness/types';

	const app = getAppState();
	const ai = getAiSettings();
	const h = getHarness();
	h.init();

	const tab = $derived(h.tab);
	const provider = $derived(tab ? h.providerFor(tab) : null);
	const skill = $derived(tab ? h.skill(tab.skill) : null);
	const ctx = $derived(tab ? h.context(tab) : null);

	let input = $state('');
	let inputEl: HTMLTextAreaElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let historyOpen = $state(false);
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let suggestIndex = $state(0);

	// The default (OpenCode Zen) and other cloud providers need a key; say so up front.
	let keyMissing = $state(false);
	$effect(() => {
		const p = provider;
		void app.view; // re-check after visiting Settings
		if (!p || p.local) keyMissing = false;
		else void ai.apiKey(p.id).then((k) => (keyMissing = !k));
	});

	function flash(text: string): void {
		toast = text;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 2200);
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
		if (!tab) return;
		const text = input.trim();
		if (tab.question) {
			if (!text) return;
			input = '';
			tab.reply(text);
			return;
		}
		if (!text || tab.running) return;
		input = '';
		await h.send(text);
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
	let pinned = true;
	function onScroll(): void {
		if (!scroller) return;
		pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
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

	function toolArgs(raw: string): string {
		try {
			const o = JSON.parse(raw) as Record<string, unknown>;
			return Object.values(o)
				.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
				.join(' · ')
				.slice(0, 120);
		} catch {
			return raw.slice(0, 120);
		}
	}

	const SIGN = { add: '+', del: '−', same: ' ' } as const;

	const TOOL_LABEL: Record<string, string> = {
		read_note: 'read',
		list_notes: 'list',
		search_notes: 'search notes',
		ask_user: 'asked',
		write_note: 'write',
		web_search: 'web search',
		fetch_url: 'read page'
	};

	function sessionLabel(file: string): string {
		return file.replace(/\.md$/, '').replace(/^(\d{4}-\d{2}-\d{2})-\d{6}-/, '$1 · ');
	}

	function primaryFor(): 'insert' | 'new' | null {
		if (skill?.output === 'insert') return 'insert';
		if (skill?.output === 'new-note') return 'new';
		return null;
	}

	const lastAi = $derived.by(() => {
		if (!tab) return -1;
		for (let i = tab.entries.length - 1; i >= 0; i--) if (tab.entries[i].kind === 'ai') return i;
		return -1;
	});
</script>

<section class="harness" aria-label="AI harness">
	<header class="tabs">
		<div class="tab-strip" role="tablist">
			{#each h.tabs as t, i (t)}
				<div class="tab" class:on={i === h.active} role="tab" aria-selected={i === h.active}>
					<button class="tab-name" onclick={() => (h.active = i)} title={t.title}>
						{#if t.running}<span class="dot" aria-label="running"></span>{/if}
						<span class="idx">{i + 1}</span>{t.title}
					</button>
					<button class="tab-x" aria-label="Close tab" onclick={() => h.closeTab(i)}>×</button>
				</div>
			{/each}
			<button class="icon" title="New session" aria-label="New session" onclick={() => h.newTab()}
				>+</button
			>
		</div>
		<button
			class="icon"
			class:on={historyOpen}
			title="Past sessions"
			aria-label="Past sessions"
			onclick={() => {
				historyOpen = !historyOpen;
				if (historyOpen) void h.refreshSessions();
			}}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none"
				><path
					d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/></svg
			>
		</button>
		<button
			class="icon"
			title="Close (Mod+J)"
			aria-label="Close AI pane"
			onclick={() => app.closeHarness()}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none"
				><path
					d="M6 6l12 12M18 6L6 18"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/></svg
			>
		</button>
	</header>

	{#if historyOpen}
		<div class="history">
			{#each h.sessionFiles as f (f)}
				<div class="hist-row">
					<button
						class="hist-open"
						onclick={() => {
							historyOpen = false;
							void h.openSession(f);
						}}>{sessionLabel(f)}</button
					>
					<button
						class="tab-x"
						aria-label="Delete session"
						title="Delete"
						onclick={() => h.deleteSession(f)}>×</button
					>
				</div>
			{:else}
				<p class="muted">No saved sessions yet.</p>
			{/each}
		</div>
	{/if}

	{#if tab}
		<div class="context">
			<select
				class="provider"
				aria-label="Provider"
				value={provider?.id ?? ''}
				onchange={(e) => (tab.providerId = (e.currentTarget as HTMLSelectElement).value || null)}
			>
				{#each ai.config.providers as p (p.id)}
					<option value={p.id}>{p.name} · {p.model}</option>
				{:else}
					<option value="">No provider</option>
				{/each}
			</select>
			{#if skill}
				<span class="chip skill" title={skill.description}>
					/{skill.name}
					<button aria-label="Clear skill" onclick={() => (tab.skill = null)}>×</button>
				</span>
			{/if}
			<button
				class="chip"
				class:off={!tab.useCurrent}
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
			{#if ctx && (ctx.ids.length > 1 || ctx.omitted)}
				<span class="tokens" title="Notes inlined on the next send">
					{ctx.ids.length}{ctx.omitted ? `+${ctx.omitted}` : ''} notes
				</span>
			{/if}
			<span class="tokens" title="Approximate tokens in history + open note"
				>~{h.estimate(tab).toLocaleString()} tok</span
			>
		</div>

		<div class="transcript" bind:this={scroller} onscroll={onScroll}>
			{#if !tab.entries.length}
				<div class="welcome">
					{#if keyMissing && provider}
						<p>
							{provider.name} needs an API key{provider.id === OPENCODE_ZEN.id
								? ' (free — big-pickle costs nothing)'
								: ''}.
						</p>
						{#if provider.id === OPENCODE_ZEN.id}
							<p class="muted">
								Get one at <a href={ZEN_KEY_URL} target="_blank" rel="noreferrer">opencode.ai/zen</a
								>, then paste it in Settings → AI → Edit.
							</p>
						{/if}
						<button class="btn" onclick={() => app.setView('settings')}>Open Settings → AI</button>
					{:else if !ai.config.providers.length}
						<p>
							Add a provider (DeepSeek, OpenRouter, a local llama.cpp / Ollama over VPN…) to start.
						</p>
						<button class="btn" onclick={() => app.setView('settings')}>Open Settings → AI</button>
					{:else}
						<p class="muted">
							Ask about {ctx?.ids.length ? 'the open note' : 'your notes'}, or run a skill.
							<kbd>/</kbd>
							skills ·
							<kbd>@</kbd> note · <kbd>@folder/</kbd> · <kbd>@#tag</kbd>
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
						<div class="text" dir="auto">
							<span class="pre">{e.text}</span>
							{#if e.streaming}<span class="caret"></span>{/if}
						</div>
						{#if !e.streaming && e.text.trim()}
							<div class="acts" class:show={i === lastAi}>
								<button
									class:primary={primaryFor() === 'insert'}
									onclick={() => act(e, 'insert')}
									disabled={!app.activeId && !app.draft}>Insert</button
								>
								<button onclick={() => act(e, 'append')} disabled={!app.activeId && !app.draft}
									>Append</button
								>
								<button class:primary={primaryFor() === 'new'} onclick={() => act(e, 'new')}
									>New note</button
								>
								<button onclick={() => act(e, 'copy')}>Copy</button>
							</div>
						{/if}
					</div>
				{:else if e.kind === 'tool'}
					<details class="tool">
						<summary>
							<span class="t-name"
								>{e.result === null ? '⋯' : '✓'} {TOOL_LABEL[e.name] ?? e.name}</span
							>
							<span class="t-args">{toolArgs(e.args)}</span>
						</summary>
						{#if e.result !== null}<pre>{e.result}</pre>{/if}
					</details>
				{:else if e.kind === 'error'}
					<div class="note err">{e.text}</div>
				{:else}
					<div class="note">{e.text}</div>
				{/if}
			{/each}

			{#if tab.running && !tab.question && !tab.approval && tab.entries[tab.entries.length - 1]?.kind !== 'ai'}
				<div class="thinking">thinking<span class="dots"></span></div>
			{/if}

			{#if tab.question}
				<div class="card question">
					<p dir="auto">{tab.question.text}</p>
					<div class="options">
						{#each tab.question.options as o, k (k)}
							<button onclick={() => tab.reply(o)} dir="auto">{o}</button>
						{/each}
					</div>
					<small class="muted">…or type your own answer below.</small>
				</div>
			{/if}

			{#if tab.approval}
				{@const a = tab.approval}
				<div class="card approval">
					<p>
						<strong>{a.mode}</strong> → {a.label}
						<span class="stat add">+{a.added}</span><span class="stat del">−{a.removed}</span>
					</p>
					<div class="diff">
						{#each a.diff as l, k (k)}
							{#if l.op === 'gap'}
								<div class="gap">⋯ {l.count} unchanged</div>
							{:else}
								<div class="dl {l.op}" dir="auto">
									<span class="sign">{SIGN[l.op]}</span><span class="pre">{l.text}</span>
								</div>
							{/if}
						{/each}
					</div>
					<div class="options">
						<button class="primary" onclick={() => tab.settle(true)}>Apply</button>
						<button onclick={() => tab.settle(false)}>Reject</button>
					</div>
				</div>
			{/if}
		</div>

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
			<span class="ps1" aria-hidden="true">{tab.question ? '?' : '›'}</span>
			<textarea
				bind:this={inputEl}
				bind:value={input}
				rows="1"
				dir="auto"
				placeholder={tab.question
					? 'Your answer…'
					: tab.running
						? 'Running… (Esc to stop)'
						: 'Ask, /skill, @note'}
				onkeydown={onKeydown}></textarea>
			{#if tab.running && !tab.question}
				<button class="send stop" aria-label="Stop" title="Stop (Esc)" onclick={() => tab.stop()}
					>■</button
				>
			{:else}
				<button class="send" aria-label="Send" disabled={!input.trim()} onclick={submit}>↵</button>
			{/if}
		</footer>
	{/if}

	{#if toast}<div class="toast" role="status">{toast}</div>{/if}
</section>

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
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 6px 6px 0;
		border-bottom: 1px solid var(--bg-active);
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.tab-strip {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 2px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tab {
		display: flex;
		align-items: center;
		max-width: 170px;
		border-radius: 7px 7px 0 0;
		color: var(--text-muted);
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
		padding: 5px 2px 5px 8px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.idx {
		color: var(--accent);
		font-weight: 700;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse 1s ease-in-out infinite;
	}
	.tab-x {
		padding: 2px 7px;
		color: var(--text-faint);
		font-size: 14px;
		line-height: 1;
	}
	.tab-x:hover {
		color: var(--text-strong);
	}
	.icon {
		display: grid;
		place-items: center;
		min-width: 28px;
		height: 28px;
		border-radius: 7px;
		color: var(--text-muted);
		font-size: 16px;
	}
	.icon:hover,
	.icon.on {
		background: var(--bg-hover);
		color: var(--text-strong);
	}

	.history {
		max-height: 40%;
		overflow-y: auto;
		padding: 6px;
		border-bottom: 1px solid var(--bg-active);
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.hist-row {
		display: flex;
		align-items: center;
	}
	.hist-open {
		flex: 1;
		text-align: start;
		padding: 5px 8px;
		border-radius: 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hist-open:hover {
		background: var(--bg-hover);
	}

	/* --- context row ------------------------------------------------------- */
	.context {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px;
		padding: 7px 10px;
		border-bottom: 1px solid var(--bg-active);
		font-size: 11.5px;
	}
	.provider {
		max-width: 150px;
		padding: 3px 6px;
		border-radius: 6px;
		border: 1px solid var(--bg-active);
		background: var(--bg-list);
		color: var(--text);
		font: inherit;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--bg-hover);
		color: var(--text);
		max-width: 160px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
	}
	.tokens {
		margin-inline-start: auto;
		color: var(--text-faint);
		font-family: var(--font-mono);
		font-size: 10.5px;
	}

	/* --- transcript -------------------------------------------------------- */
	.transcript {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 12px 4px;
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
		padding: 7px 11px;
		border-radius: 12px 12px 3px 12px;
		background: var(--accent-soft);
		color: var(--text-strong);
	}
	.msg.ai .text {
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
		gap: 4px;
		margin-top: 4px;
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.msg.ai:hover .acts,
	.acts.show,
	:global(html[data-hover='none']) .acts {
		opacity: 1;
	}
	.acts button,
	.options button {
		padding: 3px 9px;
		border-radius: 6px;
		border: 1px solid var(--bg-active);
		color: var(--text-muted);
		font-size: 11.5px;
	}
	.acts button:hover:not(:disabled),
	.options button:hover {
		background: var(--bg-hover);
		color: var(--text-strong);
	}
	.acts button:disabled {
		opacity: 0.4;
	}
	button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	button.primary:hover {
		filter: brightness(1.05);
		color: #fff !important;
		background: var(--accent) !important;
	}

	.tool {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-muted);
	}
	.tool summary {
		display: flex;
		gap: 8px;
		cursor: pointer;
		list-style: none;
		white-space: nowrap;
		overflow: hidden;
	}
	.tool summary::-webkit-details-marker {
		display: none;
	}
	.t-name {
		color: var(--accent);
	}
	.t-args {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-faint);
	}
	.tool pre {
		margin: 6px 0 0;
		max-height: 220px;
		overflow: auto;
		padding: 8px;
		border-radius: 6px;
		background: var(--code-bg);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.note {
		font-size: 12px;
		color: var(--text-muted);
	}
	.note.err {
		padding: 7px 10px;
		border-radius: 8px;
		background: rgba(220, 70, 60, 0.1);
		color: #c0453b;
	}
	.thinking {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--text-faint);
	}
	.dots::after {
		content: '';
		animation: dots 1.2s steps(4) infinite;
	}

	.card {
		padding: 10px 12px;
		border-radius: 10px;
		border: 1px solid var(--accent-soft);
		background: var(--bg-list);
	}
	.card p {
		margin: 0 0 8px;
		line-height: 1.5;
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 4px;
	}
	.question .options button {
		padding: 6px 12px;
		font-size: 12.5px;
		color: var(--text);
		background: var(--bg-editor);
	}
	.stat {
		margin-inline-start: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.stat.add,
	.dl.add {
		color: #2f8f4e;
	}
	.stat.del,
	.dl.del {
		color: #c0453b;
	}
	.diff {
		max-height: 260px;
		overflow: auto;
		margin-bottom: 8px;
		padding: 6px 0;
		border-radius: 6px;
		background: var(--code-bg);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.5;
	}
	.dl {
		display: flex;
		padding: 0 8px;
		overflow-wrap: anywhere;
	}
	.sign {
		flex: 0 0 1.4em;
		user-select: none;
	}
	.dl.add {
		background: rgba(47, 143, 78, 0.1);
	}
	.dl.del {
		background: rgba(192, 69, 59, 0.08);
		text-decoration: line-through;
		text-decoration-color: rgba(192, 69, 59, 0.4);
	}
	.dl.same {
		color: var(--text-faint);
	}
	.gap {
		padding: 0 8px;
		color: var(--text-faint);
		font-style: italic;
	}

	.welcome {
		margin: auto 0;
		text-align: center;
		color: var(--text-muted);
	}
	.welcome p {
		margin: 0 0 12px;
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
		border-radius: 8px;
		border: 1px solid var(--bg-active);
	}
	.skill-btn:hover {
		background: var(--bg-hover);
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
		padding: 6px 12px;
		border-radius: 8px;
		background: var(--accent);
		color: #fff;
	}
	kbd {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--code-bg);
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.muted {
		color: var(--text-muted);
	}

	/* --- prompt ------------------------------------------------------------ */
	.prompt {
		position: relative;
		display: flex;
		align-items: flex-end;
		gap: 6px;
		padding: 8px 10px calc(10px + env(safe-area-inset-bottom, 0px));
		border-top: 1px solid var(--bg-active);
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
	textarea::placeholder {
		color: var(--text-faint);
	}
	.send {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 7px;
		background: var(--accent);
		color: #fff;
		font-size: 13px;
	}
	.send:disabled {
		opacity: 0.35;
	}
	.send.stop {
		background: var(--text-muted);
		font-size: 10px;
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
		bottom: 64px;
		transform: translateX(-50%);
		max-width: 90%;
		padding: 6px 12px;
		border-radius: 8px;
		background: var(--text-strong);
		color: var(--bg-editor);
		font-size: 12px;
		pointer-events: none;
	}

	/* Touch: finger-sized targets. */
	:global(html[data-touch]) .acts button,
	:global(html[data-touch]) .options button {
		padding: 8px 14px;
		font-size: 13px;
	}
	:global(html[data-touch]) .send,
	:global(html[data-touch]) .icon {
		width: 38px;
		height: 38px;
	}
	:global(html[data-touch]) textarea {
		font-size: 15px;
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
