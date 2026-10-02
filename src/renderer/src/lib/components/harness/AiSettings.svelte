<script lang="ts">
	import { onMount } from 'svelte';
	import { getAppState } from '../../stores/app.svelte';
	import { platform } from '../../platform';
	import { getAiSettings } from '../../harness/config.svelte';
	import { chatCompletion } from '../../harness/openai';
	import { webSearch } from '../../harness/web';
	import { loadSkillTree, type Skill } from '../../harness/skills';
	import { getHarness } from '../../harness/harness.svelte';
	import { syncErrorMessage } from '../../sync';
	import {
		isBuiltinProvider,
		KEY_URLS,
		OPENCODE_ZEN,
		ZEN_KEY_URL,
		type ProviderProfile,
		type SearchKind
	} from '../../harness/types';

	const app = getAppState();
	const ai = getAiSettings();
	const cfg = $derived(ai.config);

	/** Starting points; every field stays editable. */
	const PRESETS: { label: string; p: Partial<ProviderProfile> }[] = [
		{ label: 'Custom', p: {} },
		{
			label: 'OpenCode Zen (free big-pickle)',
			p: {
				name: OPENCODE_ZEN.name,
				baseUrl: OPENCODE_ZEN.baseUrl,
				model: OPENCODE_ZEN.model,
				local: false,
				contextTokens: OPENCODE_ZEN.contextTokens
			}
		},
		{
			label: 'DeepSeek',
			p: {
				name: 'DeepSeek',
				baseUrl: 'https://api.deepseek.com/v1',
				model: 'deepseek-chat',
				local: false
			}
		},
		{
			label: 'OpenRouter',
			p: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '', local: false }
		},
		{
			label: 'Ollama (local / VPN)',
			p: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b', local: true }
		},
		{
			label: 'llama.cpp server',
			p: { name: 'llama.cpp', baseUrl: 'http://localhost:8080/v1', model: 'local', local: true }
		}
	];

	type Draft = ProviderProfile & { apiKey: string; hasKey: boolean };
	let draft = $state<Draft | null>(null);
	let testing = $state(false);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	let searchKey = $state('');
	let hasSearchKey = $state(false);
	let searchMsg = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	// --- skills: own files + packs cloned from git into .fr5a/skills/<name> ---
	let skills = $state<Skill[]>([]);
	let packUrl = $state('');
	let installing = $state(false);
	let packMsg = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	async function loadSkills(): Promise<void> {
		skills = await loadSkillTree({
			list: (rel) => platform.listMeta(rel),
			read: (rel) => platform.readMeta(rel)
		});
	}

	async function installPack(): Promise<void> {
		if (!platform.syncAddRepo) return;
		const url = packUrl.trim();
		const name =
			(url.split(/[/:]/).pop() ?? '').replace(/\.git$/, '').replace(/[^\w.-]/g, '') || 'pack';
		installing = true;
		packMsg = null;
		const res = await platform.syncAddRepo(`.fr5a/skills/${name}`, url, '');
		installing = false;
		if (!res.ok) packMsg = { kind: 'error', text: syncErrorMessage(res.error) };
		else {
			packUrl = '';
			await loadSkills();
			await getHarness().loadSkills();
			packMsg = { kind: 'ok', text: `Installed ${name}. Sync pulls its updates (never pushes).` };
		}
	}

	// Per provider: is a key saved, the key being typed, model list loading.
	let hasKey = $state<Record<string, boolean>>({});
	let keyInput = $state<Record<string, string>>({});
	let loadingModels = $state<Record<string, boolean>>({});

	async function refreshModels(id: string): Promise<void> {
		loadingModels[id] = true;
		await ai.fetchModels(id);
		loadingModels[id] = false;
	}

	async function saveKey(id: string): Promise<void> {
		const key = keyInput[id]?.trim();
		if (!key) return;
		await ai.setApiKey(id, key);
		keyInput[id] = '';
		hasKey[id] = true;
		await refreshModels(id);
	}

	onMount(async () => {
		await ai.load();
		hasSearchKey = !!(await ai.searchKey());
		// Fetch model lists for providers that can answer (key saved, local, or Zen's public list).
		await Promise.all(
			cfg.providers.map(async (p) => {
				hasKey[p.id] = !!(await ai.apiKey(p.id));
				if ((hasKey[p.id] || p.local || p.id === OPENCODE_ZEN.id) && !ai.models[p.id])
					await refreshModels(p.id);
			})
		);
		await loadSkills();
	});

	function blank(): Draft {
		return {
			id: crypto.randomUUID().slice(0, 8),
			name: '',
			baseUrl: '',
			model: '',
			local: false,
			tools: true,
			contextTokens: 32000,
			apiKey: '',
			hasKey: false
		};
	}

	async function edit(p: ProviderProfile | null): Promise<void> {
		message = null;
		draft = p ? { ...p, apiKey: '', hasKey: !!(await ai.apiKey(p.id)) } : blank();
	}

	function preset(e: Event): void {
		const p = PRESETS[Number((e.currentTarget as HTMLSelectElement).value)];
		if (draft && p) Object.assign(draft, p.p);
	}

	function profileOf(d: Draft): ProviderProfile {
		return {
			id: d.id,
			name: d.name.trim() || d.model || 'Provider',
			baseUrl: d.baseUrl.trim(),
			model: d.model.trim(),
			local: d.local,
			tools: d.tools,
			contextTokens: Math.max(2048, Number(d.contextTokens) || 32000)
		};
	}

	async function save(): Promise<void> {
		if (!draft) return;
		if (!draft.baseUrl.trim() || !draft.model.trim()) {
			message = { kind: 'error', text: 'Base URL and model are required.' };
			return;
		}
		const id = draft.id;
		if (draft.apiKey.trim()) {
			await ai.setApiKey(id, draft.apiKey.trim());
			hasKey[id] = true;
		}
		ai.saveProvider(profileOf(draft));
		draft = null;
		void refreshModels(id);
	}

	async function test(): Promise<void> {
		if (!draft) return;
		testing = true;
		message = null;
		try {
			const key = draft.apiKey.trim() || (await ai.apiKey(draft.id));
			const res = await chatCompletion(platform, {
				profile: { ...profileOf(draft), tools: false },
				apiKey: key,
				messages: [{ role: 'user', content: 'Reply with just: OK' }]
			});
			message = { kind: 'ok', text: `Connected — “${res.content.trim().slice(0, 60)}”` };
		} catch (err) {
			message = { kind: 'error', text: err instanceof Error ? err.message : String(err) };
		} finally {
			testing = false;
		}
	}

	function setSearchKind(kind: SearchKind | ''): void {
		ai.update({ search: kind ? { kind, baseUrl: cfg.search?.baseUrl ?? '' } : null });
	}

	async function saveSearchKey(): Promise<void> {
		await ai.setSearchKey(searchKey.trim() || null);
		hasSearchKey = !!searchKey.trim();
		searchKey = '';
	}

	async function testSearch(): Promise<void> {
		if (!cfg.search) return;
		searchMsg = null;
		try {
			const r = await webSearch(platform, cfg.search, await ai.searchKey(), 'fr5a markdown', 3);
			searchMsg = { kind: 'ok', text: `${r.length} results — ${r[0]?.title ?? ''}` };
		} catch (err) {
			searchMsg = { kind: 'error', text: err instanceof Error ? err.message : String(err) };
		}
	}

	function toggleLocalFolder(f: string): void {
		const cur = cfg.localOnlyFolders;
		const next = cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f];
		ai.update({ localOnlyFolders: next.sort() });
	}
</script>

<section class="group">
	<h2>AI</h2>

	{#each cfg.providers as p (p.id)}
		{@const models = ai.models[p.id] ?? []}
		<div class="row stack provider" class:is-default={cfg.defaultProvider === p.id}>
			<div class="phead">
				<label class="label radio">
					<input
						type="radio"
						name="default-provider"
						checked={cfg.defaultProvider === p.id}
						onchange={() => ai.update({ defaultProvider: p.id })}
					/>
					<span class="name"
						>{p.name}
						{#if cfg.defaultProvider === p.id}<span class="badge">default</span>{/if}
						{#if p.local}<span class="badge">local</span>{/if}
						{#if !p.local && !hasKey[p.id]}<span class="badge warn">no key</span>{/if}</span
					>
					<span class="desc">{p.baseUrl}</span>
				</label>
				<div class="actions">
					<button class="btn" onclick={() => edit(p)}>Edit</button>
					{#if !isBuiltinProvider(p.id)}
						<button class="btn" onclick={() => ai.removeProvider(p.id)}>Remove</button>
					{/if}
				</div>
			</div>
			<div class="pgrid">
				<label class="field" for="key-{p.id}">
					<span class="small">API key</span>
					<div class="inline">
						<input
							id="key-{p.id}"
							type="password"
							autocomplete="off"
							bind:value={keyInput[p.id]}
							placeholder={hasKey[p.id] ? '•••••• saved' : p.local ? 'optional' : 'paste your key'}
						/>
						<button class="btn" disabled={!keyInput[p.id]?.trim()} onclick={() => saveKey(p.id)}
							>Save</button
						>
					</div>
					{#if KEY_URLS[p.id]}
						<span class="desc"
							>Get one at <a href={KEY_URLS[p.id]} target="_blank" rel="noreferrer"
								>{KEY_URLS[p.id].replace(/^https:\/\//, '')}</a
							></span
						>
					{/if}
				</label>
				<label class="field" for="model-{p.id}">
					<span class="small">Model</span>
					<div class="inline">
						<select
							id="model-{p.id}"
							value={p.model}
							onchange={(e) => ai.setModel(p.id, (e.currentTarget as HTMLSelectElement).value)}
						>
							{#if !models.includes(p.model)}<option value={p.model}>{p.model}</option>{/if}
							{#each models as m (m)}<option value={m}>{m}</option>{/each}
						</select>
						<button
							class="btn icon"
							title="Reload the model list"
							aria-label="Reload models for {p.name}"
							disabled={loadingModels[p.id]}
							onclick={() => refreshModels(p.id)}>{loadingModels[p.id] ? '…' : '↻'}</button
						>
					</div>
					<span class="desc"
						>{ai.modelErrors[p.id]
							? `Couldn't list models: ${ai.modelErrors[p.id]}`
							: models.length
								? `${models.length} models`
								: hasKey[p.id] || p.local || p.id === OPENCODE_ZEN.id
									? 'Loading models…'
									: 'Save a key to list models'}</span
					>
				</label>
			</div>
		</div>
	{/each}

	{#if draft}
		<div class="row stack form">
			<label class="field">
				<span class="name">Start from</span>
				<select onchange={preset}>
					{#each PRESETS as pr, i (pr.label)}<option value={i}>{pr.label}</option>{/each}
				</select>
			</label>
			<label class="field"
				><span class="name">Name</span><input
					bind:value={draft.name}
					placeholder="DeepSeek"
				/></label
			>
			<label class="field">
				<span class="name">Base URL</span>
				<input
					type="url"
					inputmode="url"
					autocomplete="off"
					bind:value={draft.baseUrl}
					placeholder="https://api.example.com/v1"
				/>
				<span class="desc"
					>Any OpenAI-compatible endpoint, incl. a model on your server over VPN.</span
				>
			</label>
			<label class="field"
				><span class="name">Model</span><input
					autocomplete="off"
					bind:value={draft.model}
					placeholder="deepseek-chat"
				/></label
			>
			<label class="field">
				<span class="name">API key</span>
				<input
					type="password"
					autocomplete="off"
					bind:value={draft.apiKey}
					placeholder={draft.hasKey
						? '•••••• saved (leave blank to keep)'
						: 'optional for local servers'}
				/>
				<span class="desc"
					>Stored encrypted (OS keyring / Android Keystore), never in your notes or sync.</span
				>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={draft.local} />
				<span
					><span class="name">Local / private</span>
					{#if draft.baseUrl.includes('opencode.ai/zen')}
						<span class="desc"
							>Zen models (incl. free <code>big-pickle</code>) need a key from
							<a href={ZEN_KEY_URL} target="_blank" rel="noreferrer">opencode.ai/zen</a>.</span
						>
					{/if}<span class="desc"
						>Runs on hardware you control. Only local providers may read local-only notes.</span
					></span
				>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={draft.tools} />
				<span
					><span class="name">Tool calling</span><span class="desc"
						>Questions, note reading/writing and web search. Turn off for models that don't support
						tools.</span
					></span
				>
			</label>
			<label class="field"
				><span class="name">Context window (tokens)</span><input
					type="number"
					min="2048"
					step="1024"
					bind:value={draft.contextTokens}
				/></label
			>
			{#if message}<p class="msg" class:error={message.kind === 'error'}>{message.text}</p>{/if}
			<div class="actions">
				<button class="btn" onclick={() => (draft = null)}>Cancel</button>
				<button class="btn" disabled={testing || !draft.baseUrl} onclick={test}
					>{testing ? 'Testing…' : 'Test'}</button
				>
				<button class="btn primary" onclick={save}>Save</button>
			</div>
		</div>
	{:else}
		<div class="row">
			<div class="label">
				<span class="name">Providers</span>
				<span class="desc"
					>{cfg.providers.length ? 'The selected one is the default.' : 'None yet.'}</span
				>
			</div>
			<button class="btn" onclick={() => edit(null)}>Add provider…</button>
		</div>
	{/if}

	<div class="row">
		<div class="label">
			<span class="name">Web search</span>
			<span class="desc">For /sources and /fact-check. SearXNG can be self-hosted.</span>
		</div>
		<select
			value={cfg.search?.kind ?? ''}
			onchange={(e) =>
				setSearchKind((e.currentTarget as HTMLSelectElement).value as SearchKind | '')}
		>
			<option value="">Off</option>
			<option value="searxng">SearXNG</option>
			<option value="brave">Brave Search</option>
			<option value="tavily">Tavily</option>
		</select>
	</div>
	{#if cfg.search}
		<div class="row stack">
			{#if cfg.search.kind === 'searxng'}
				<label class="field">
					<span class="name">SearXNG URL</span>
					<input
						type="url"
						value={cfg.search.baseUrl}
						placeholder="https://search.example.com"
						onchange={(e) =>
							ai.update({
								search: {
									kind: 'searxng',
									baseUrl: (e.currentTarget as HTMLInputElement).value.trim()
								}
							})}
					/>
					<span class="desc"
						>Needs <code>json</code> enabled in the instance's <code>search.formats</code>.</span
					>
				</label>
			{:else}
				<label class="field">
					<span class="name">API key</span>
					<input
						type="password"
						autocomplete="off"
						bind:value={searchKey}
						placeholder={hasSearchKey ? '•••••• saved' : 'API key'}
					/>
				</label>
			{/if}
			{#if searchMsg}<p class="msg" class:error={searchMsg.kind === 'error'}>
					{searchMsg.text}
				</p>{/if}
			<div class="actions">
				{#if cfg.search.kind !== 'searxng'}
					<button class="btn" disabled={!searchKey.trim()} onclick={saveSearchKey}>Save key</button>
				{/if}
				<button class="btn" onclick={testSearch}>Test</button>
			</div>
		</div>
	{/if}

	<div class="row stack">
		<div class="label">
			<span class="name">Local-only folders</span>
			<span class="desc"
				>Notes here are only sent to local providers. A single note can opt in with <code
					>&lt;!-- ai: local --&gt;</code
				>.</span
			>
		</div>
		<div class="folders">
			{#each app.folders as f (f)}
				<label class="folder" style:padding-inline-start="{(f.split('/').length - 1) * 14}px">
					<input
						type="checkbox"
						checked={cfg.localOnlyFolders.includes(f)}
						onchange={() => toggleLocalFolder(f)}
					/>
					{f.split('/').pop()}
				</label>
			{:else}
				<span class="desc">No folders.</span>
			{/each}
		</div>
	</div>

	<div class="row stack">
		<div class="label">
			<span class="name">Skills</span>
			<span class="desc"
				>Markdown prompts in <code>.fr5a/skills/</code> — edit or add your own. Packs from git
				(incl. Claude-style <code>name/SKILL.md</code> folders) install into
				<code>.fr5a/skills/&lt;repo&gt;</code>.</span
			>
		</div>
		<div class="skills">
			{#each skills as sk (sk.name)}
				<span class="skill" title={sk.source}>/{sk.name}</span>
			{:else}
				<span class="desc">No skills yet (built-ins appear the first time the AI pane opens).</span>
			{/each}
		</div>
		{#if platform.syncAddRepo}
			<div class="inline">
				<input
					type="url"
					inputmode="url"
					autocomplete="off"
					bind:value={packUrl}
					placeholder="https://github.com/someone/skills.git"
				/>
				<button class="btn" disabled={installing || !packUrl.trim()} onclick={installPack}
					>{installing ? 'Installing…' : 'Install pack'}</button
				>
			</div>
		{/if}
		{#if packMsg}<p class="msg" class:error={packMsg.kind === 'error'}>{packMsg.text}</p>{/if}
	</div>

	<div class="row">
		<div class="label">
			<span class="name">Max steps per run</span>
			<span class="desc">Each tool call costs a model round-trip.</span>
		</div>
		<input
			class="num"
			type="number"
			min="1"
			max="40"
			value={cfg.maxSteps}
			onchange={(e) =>
				ai.update({
					maxSteps: Math.min(
						40,
						Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 8)
					)
				})}
		/>
	</div>
</section>

<style>
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
	.row.stack {
		flex-direction: column;
		align-items: stretch;
		gap: 12px;
	}
	.form {
		padding: 14px;
		margin: 8px 0;
		border-radius: 10px;
		background: var(--bg-list);
		box-shadow: none;
	}
	.label,
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.label.radio {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 10px;
		align-items: center;
	}
	.label.radio input {
		grid-row: span 2;
		accent-color: var(--accent);
	}
	.name {
		font-size: 14px;
		color: var(--text-strong);
	}
	.desc {
		font-size: 12px;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.badge {
		margin-inline-start: 4px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--accent-soft);
		font-size: 10.5px;
		color: var(--text);
	}
	input:not([type='checkbox']):not([type='radio']),
	select {
		font: inherit;
		font-size: 13.5px;
		padding: 8px 10px;
		border-radius: 8px;
		border: 1px solid var(--bg-hover);
		background: var(--bg-secondary);
		color: var(--text-main);
	}
	input:focus,
	select:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}
	.num {
		width: 80px;
	}
	.check {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.check > span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.check input,
	.folder input {
		margin-top: 3px;
		accent-color: var(--accent);
	}
	.folders {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 200px;
		overflow-y: auto;
	}
	.folder {
		display: flex;
		gap: 8px;
		font-size: 13px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		flex-wrap: wrap;
	}
	.btn {
		padding: 7px 14px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text-main);
		font-size: 13px;
		font-weight: 500;
	}
	.btn:hover {
		background: var(--bg-active);
	}
	.btn.primary {
		background: var(--accent);
		color: #fff;
	}
	.btn:disabled {
		opacity: 0.5;
	}
	.msg {
		margin: 0;
		font-size: 13px;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.msg.error {
		color: #c0392b;
	}
	.skills {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.skill {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--accent-soft);
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	a {
		color: var(--accent);
	}
	.provider {
		gap: 10px;
		padding: 14px 2px;
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	.phead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.pgrid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px;
		padding-inline-start: 26px;
	}
	.small {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.badge.warn {
		background: rgba(220, 120, 40, 0.16);
	}
	.btn.icon {
		padding: 7px 10px;
	}
	.inline select {
		flex: 1;
		min-width: 0;
	}
	.inline {
		display: flex;
		gap: 8px;
	}
	.inline input {
		flex: 1;
		min-width: 0;
	}
	code {
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
</style>
