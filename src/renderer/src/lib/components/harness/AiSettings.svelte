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
		SEARCH_KINDS,
		ZEN_KEY_URL,
		type ProviderProfile,
		type SearchKind
	} from '../../harness/types';
	import Icon from '../Icon.svelte';
	import { buildFolderTree, type FolderNode } from '../../folders';
	import { folderPrivacy } from '../../harness/privacy';
	import { cleanFolder } from '../../../../../shared/paths';

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
	/** The one provider row showing its key + model fields. */
	let expanded = $state<string | null>(null);
	// --- hidden from cloud AI: folder tree + single notes ---------------------
	type PrivacyRow = { path: string; name: string; depth: number; count: number };
	function flattenTree(nodes: FolderNode[], depth: number, out: PrivacyRow[]): PrivacyRow[] {
		for (const n of nodes) {
			out.push({ path: n.path, name: n.name, depth, count: n.count });
			flattenTree(n.children, depth + 1, out);
		}
		return out;
	}
	const privacyRows = $derived(
		flattenTree(buildFolderTree(app.notes, app.folders), 1, [
			{ path: '', name: 'Everything', depth: 0, count: app.notes.length }
		])
	);
	const hiddenCount = $derived(app.notes.filter((n) => app.hiddenFromAi(n)).length);
	/** Notes hidden on their own (`<!-- ai: local -->`), not through a folder. */
	const singles = $derived(
		app.notes.filter((n) => n.aiLocal && !folderPrivacy(dirOf(n.id), cfg.localOnlyFolders))
	);
	function dirOf(id: string): string {
		return id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
	}
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
		await refreshSearchKey();
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

	async function refreshSearchKey(): Promise<void> {
		hasSearchKey = !!(await ai.searchKey(cfg.search?.kind));
	}

	function setSearchKind(kind: SearchKind | ''): void {
		ai.update({ search: kind ? { kind, baseUrl: cfg.search?.baseUrl ?? '' } : null });
		searchKey = '';
		searchMsg = null;
		void refreshSearchKey();
	}

	/** Saved on Enter, on leaving the field, and before a test — not only via the button. */
	async function saveSearchKey(): Promise<void> {
		const kind = cfg.search?.kind;
		const key = searchKey.trim();
		if (!kind || !key) return;
		searchKey = '';
		await ai.setSearchKey(kind, key);
		hasSearchKey = true;
		searchMsg = { kind: 'ok', text: 'Key saved.' };
	}

	async function testSearch(): Promise<void> {
		if (!cfg.search) return;
		await saveSearchKey();
		searchMsg = null;
		try {
			const r = await webSearch(
				platform,
				cfg.search,
				await ai.searchKey(cfg.search.kind),
				'fr5a markdown',
				3
			);
			searchMsg = { kind: 'ok', text: `${r.length} results — ${r[0]?.title ?? ''}` };
		} catch (err) {
			searchMsg = { kind: 'error', text: err instanceof Error ? err.message : String(err) };
		}
	}
</script>

<section class="group">
	<h3>Providers</h3>
	<p class="lead">The selected provider is the default; each AI tab can switch.</p>
	<div class="providers" role="radiogroup" aria-label="Default provider">
		{#each cfg.providers as p (p.id)}
			{@const models = ai.models[p.id] ?? []}
			{@const open = expanded === p.id}
			<div class="provider" class:open class:is-default={cfg.defaultProvider === p.id}>
				<div class="phead">
					<label class="pick">
						<input
							type="radio"
							name="default-provider"
							checked={cfg.defaultProvider === p.id}
							onchange={() => ai.update({ defaultProvider: p.id })}
						/>
						<span class="pname">
							<span class="name">{p.name}</span>
							<span class="desc">{p.model || 'no model'}</span>
						</span>
					</label>
					<span class="badges">
						{#if p.local}<span class="badge">local</span>{/if}
						{#if !p.local && !hasKey[p.id]}<span class="badge warn">no key</span>{/if}
					</span>
					<button
						class="btn icon"
						aria-expanded={open}
						aria-label="{open ? 'Hide' : 'Show'} {p.name} details"
						onclick={() => (expanded = open ? null : p.id)}
					>
						<span class="chev" class:open><Icon name="chevron" size={15} /></span>
					</button>
				</div>
				{#if open}
					<div class="pbody">
						<label class="field" for="key-{p.id}">
							<span class="small">API key</span>
							<div class="inline">
								<input
									id="key-{p.id}"
									type="password"
									autocomplete="off"
									bind:value={keyInput[p.id]}
									placeholder={hasKey[p.id]
										? '•••••• saved'
										: p.local
											? 'optional'
											: 'paste your key'}
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
									onclick={() => refreshModels(p.id)}
									><span class:spin={loadingModels[p.id]}><Icon name="retry" size={15} /></span
									></button
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
						<div class="actions">
							<span class="desc url">{p.baseUrl}</span>
							<button class="btn" onclick={() => edit(p)}>Edit…</button>
							{#if !isBuiltinProvider(p.id)}
								<button class="btn danger" onclick={() => ai.removeProvider(p.id)}>Remove</button>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	{#if draft}
		<div class="form">
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
					><span class="name">Runs on my hardware (local)</span>
					{#if draft.baseUrl.includes('opencode.ai/zen')}
						<span class="desc"
							>Zen models (incl. free <code>big-pickle</code>) need a key from
							<a href={ZEN_KEY_URL} target="_blank" rel="noreferrer">opencode.ai/zen</a>.</span
						>
					{/if}<span class="desc"
						>localhost, your LAN or VPN. Local providers may read notes hidden from cloud AI.</span
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
		<button class="btn add" onclick={() => edit(null)}>
			<Icon name="plus" size={15} /> Add provider…
		</button>
	{/if}
</section>

<section class="group" id="web-search">
	<h3>Web search</h3>
	<p class="lead">
		Lets the AI look things up (<code>web_search</code> + <code>fetch_url</code>): ask it to search,
		or run <code>/sources</code> or <code>/fact-check</code>. Only the search query and the pages it
		reads leave the device.
	</p>
	<div class="search-kinds" role="radiogroup" aria-label="Web search provider">
		<button
			class="kind"
			class:on={!cfg.search}
			role="radio"
			aria-checked={!cfg.search}
			onclick={() => setSearchKind('')}
		>
			<span class="name">Off</span><span class="desc">No web access</span>
		</button>
		{#each SEARCH_KINDS as k (k.kind)}
			<button
				class="kind"
				class:on={cfg.search?.kind === k.kind}
				role="radio"
				aria-checked={cfg.search?.kind === k.kind}
				onclick={() => setSearchKind(k.kind)}
			>
				<span class="name">{k.label}</span><span class="desc">{k.hint}</span>
			</button>
		{/each}
	</div>
	{#if cfg.search}
		<div class="search-cfg">
			{#if cfg.search.kind === 'searxng'}
				<label class="field">
					<span class="small">SearXNG URL</span>
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
			{:else if cfg.search.kind !== 'duckduckgo'}
				<label class="field">
					<span class="small">API key</span>
					<div class="inline">
						<input
							type="password"
							autocomplete="off"
							bind:value={searchKey}
							placeholder={hasSearchKey ? '•••••• saved' : 'API key'}
							onchange={saveSearchKey}
							onkeydown={(e) => e.key === 'Enter' && saveSearchKey()}
						/>
						<button class="btn" disabled={!searchKey.trim()} onclick={saveSearchKey}>Save</button>
					</div>
				</label>
			{/if}
			<div class="actions start">
				<button class="btn" onclick={testSearch}>Test search</button>
				{#if searchMsg}<p class="msg" class:error={searchMsg.kind === 'error'}>
						{searchMsg.text}
					</p>{/if}
			</div>
		</div>
	{/if}
</section>

<section class="group">
	<h3>Hidden from cloud AI</h3>
	<p class="lead">
		Cloud providers never receive these notes — not as context, not through tools. Providers that
		run on your hardware can read everything.
	</p>
	<p class="psum" role="status">
		<Icon name="shield" size={14} stroke={2} />
		<span
			><strong>{hiddenCount}</strong> of {app.notes.length}
			{app.notes.length === 1 ? 'note' : 'notes'} hidden{cfg.localOnlyFolders.length ||
			singles.length
				? ` · ${cfg.localOnlyFolders.length} ${cfg.localOnlyFolders.length === 1 ? 'folder' : 'folders'}, ${singles.length} single ${singles.length === 1 ? 'note' : 'notes'}`
				: ''}</span
		>
	</p>

	<div class="ptree" role="group" aria-label="Folders hidden from cloud AI">
		{#each privacyRows as r (r.path)}
			{@const state = folderPrivacy(r.path, cfg.localOnlyFolders)}
			<label
				class="prow"
				class:on={!!state}
				style:padding-inline-start="{10 + r.depth * 16}px"
				title={state?.via === 'parent'
					? `Hidden because “${state.folder || 'Everything'}” is hidden`
					: undefined}
			>
				<input
					type="checkbox"
					checked={!!state}
					disabled={state?.via === 'parent'}
					onchange={() => ai.setFolderHidden(r.path, state?.via !== 'self')}
				/>
				<Icon name={r.path ? 'folder' : 'note'} size={14} />
				<span class="pname">{r.name}</span>
				<span class="pcount">{r.count}</span>
				{#if state}
					<span class="pstate" class:inherited={state.via === 'parent'}
						>{state.via === 'self' ? 'Hidden' : 'Hidden via parent'}</span
					>
				{/if}
			</label>
		{/each}
	</div>

	<div class="singles">
		<span class="small">Single notes</span>
		{#each singles as n (n.id)}
			<div class="single">
				<span class="label">
					<span class="sname">{n.title}</span>
					<span class="desc">{n.id}</span>
				</span>
				<button class="btn" onclick={() => app.setHiddenFromAi(n.id, false)}
					>Let cloud AI read</button
				>
			</div>
		{:else}
			<p class="desc">
				None. Hide one note from its menu (⋯ or long-press → Hide from cloud AI); it adds
				<code>&lt;!-- ai: local --&gt;</code> to the file.
			</p>
		{/each}
	</div>
</section>

<section class="group">
	<h3>Skills</h3>
	<p class="lead">
		Markdown prompts in <code>.fr5a/skills/</code> — edit or add your own. Packs from git (incl.
		Claude-style <code>name/SKILL.md</code> folders) install into
		<code>.fr5a/skills/&lt;repo&gt;</code>.
	</p>
	<div class="skills">
		{#each skills as sk (sk.name)}
			<span class="skill" title={sk.source}>/{sk.name}</span>
		{:else}
			<span class="desc">No skills yet (built-ins appear the first time the AI pane opens).</span>
		{/each}
	</div>
	{#if platform.syncAddRepo}
		<div class="inline pack">
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
</section>

<section class="group">
	<h3>Advanced</h3>
	<div class="row">
		<label class="label" for="chats-folder">
			<span class="name">Saved chats folder</span>
			<span class="desc"
				>Where ⋯ → Save to notes puts a chat (it syncs with your notes). Empty = top level.</span
			>
		</label>
		<input
			id="chats-folder"
			class="text"
			type="text"
			spellcheck="false"
			autocomplete="off"
			autocapitalize="off"
			value={cfg.chatsFolder ?? ''}
			placeholder="top level"
			onchange={(e) =>
				ai.update({ chatsFolder: cleanFolder((e.currentTarget as HTMLInputElement).value) })}
		/>
	</div>
	<div class="row">
		<label class="label" for="max-steps">
			<span class="name">Max steps per run</span>
			<span class="desc">Each tool call costs a model round-trip.</span>
		</label>
		<input
			id="max-steps"
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
		margin-bottom: 28px;
	}
	.group h3 {
		font-size: 11.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		margin: 0 0 4px;
	}
	.lead {
		margin: 0 0 10px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-muted);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 2px;
	}
	.label,
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.name {
		font-size: 14px;
		font-weight: 500;
		color: var(--text-strong);
	}
	.desc {
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.small {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
	}

	/* --- providers --------------------------------------------------------- */
	.providers {
		display: flex;
		flex-direction: column;
		border-radius: 12px;
		background: var(--bg-list);
		overflow: hidden;
	}
	.provider + .provider {
		box-shadow: inset 0 1px 0 var(--bg-hover);
	}
	.phead {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 52px;
		padding: 4px 6px 4px 12px;
	}
	.pick {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		cursor: pointer;
	}
	.pick input {
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		accent-color: var(--accent);
	}
	.pname {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.pname .desc {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badges {
		display: flex;
		gap: 4px;
	}
	.badge {
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--accent-soft);
		font-size: 10.5px;
		color: var(--text);
		white-space: nowrap;
	}
	.badge.warn {
		background: rgba(220, 120, 40, 0.16);
	}
	.chev {
		display: grid;
		transition: transform var(--dur-pane) var(--ease-out);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.pbody {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px;
		padding: 4px 14px 14px 42px;
	}
	:global(.settings.phone) .pbody {
		padding-left: 14px;
	}
	.pbody .actions {
		grid-column: 1 / -1;
	}
	.url {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 10px;
		padding: 14px;
		border-radius: 12px;
		background: var(--bg-list);
	}

	/* --- web search -------------------------------------------------------- */
	.search-kinds {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 6px;
	}
	.kind {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		min-height: 52px;
		padding: 8px 12px;
		border-radius: 10px;
		background: var(--bg-list);
		box-shadow: inset 0 0 0 1px var(--bg-hover);
		text-align: start;
		transition:
			box-shadow var(--dur-fast) ease,
			background var(--dur-fast) ease;
	}
	.kind:hover {
		background: var(--bg-hover);
	}
	.kind.on {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.search-cfg {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 12px;
	}

	/* --- shared controls --------------------------------------------------- */
	input:not([type='checkbox']):not([type='radio']),
	select {
		font: inherit;
		font-size: 13.5px;
		min-height: 34px;
		padding: 0 10px;
		border-radius: 8px;
		border: 1px solid var(--bg-hover);
		background: var(--bg-secondary);
		color: var(--text-main);
	}
	:global(html[data-touch]) input:not([type='checkbox']):not([type='radio']),
	:global(html[data-touch]) select {
		min-height: 44px;
		font-size: 16px;
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
	.check input {
		margin-top: 3px;
		accent-color: var(--accent);
	}

	/* --- hidden from cloud AI -------------------------------------------- */
	.psum {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 0 0 8px;
		font-size: 13px;
		color: var(--text-muted);
	}
	.psum :global(.icon) {
		color: var(--accent);
	}
	.psum strong {
		color: var(--text-strong);
	}
	.ptree {
		display: flex;
		flex-direction: column;
		max-height: 300px;
		overflow-y: auto;
		padding: 4px;
		border-radius: 10px;
		background: var(--bg-list);
	}
	.prow {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		padding-inline-end: 8px;
		border-radius: 7px;
		font-size: 13px;
		cursor: pointer;
	}
	.prow:hover {
		background: var(--bg-hover);
	}
	.prow :global(.icon) {
		color: var(--text-muted);
	}
	.prow.on :global(.icon) {
		color: var(--accent);
	}
	.prow input {
		accent-color: var(--accent);
		margin: 0;
	}
	.prow input:disabled {
		opacity: 0.55;
	}
	:global(html[data-touch]) .prow {
		min-height: 44px;
		font-size: 15px;
	}
	.pname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pcount {
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.pstate {
		flex: 0 0 auto;
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 11px;
		font-weight: 600;
	}
	.pstate.inherited {
		background: var(--bg-hover);
		color: var(--text-muted);
		font-weight: 500;
	}
	.singles {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 14px;
	}
	.single {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 2px;
	}
	.sname {
		font-size: 13.5px;
		font-weight: 500;
		color: var(--text-strong);
	}
	.text {
		width: 180px;
		min-width: 0;
	}
	.actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		flex-wrap: wrap;
	}
	.actions.start {
		justify-content: flex-start;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 32px;
		padding: 0 14px;
		border-radius: 8px;
		background: var(--bg-hover);
		color: var(--text-main);
		font-size: 13px;
		font-weight: 500;
		transition:
			background var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .btn {
		min-height: 44px;
	}
	:global(html[data-touch]) .btn.icon {
		min-width: 44px;
	}
	.btn:hover {
		background: var(--bg-active);
	}
	.btn:active:not(:disabled) {
		transform: scale(0.97);
	}
	.btn.primary {
		background: var(--accent);
		color: #fff;
	}
	.btn.danger {
		color: var(--danger);
	}
	.btn:disabled {
		opacity: 0.5;
	}
	.btn.icon {
		padding: 0 9px;
		background: none;
	}
	.btn.icon:hover {
		background: var(--bg-hover);
	}
	.spin {
		display: grid;
		animation: spin 800ms linear infinite;
	}
	.msg {
		margin: 0;
		font-size: 13px;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.msg.error {
		color: var(--danger);
	}
	.skills {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.skill {
		padding: 2px 9px;
		border-radius: 999px;
		background: var(--accent-soft);
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.pack {
		margin-top: 10px;
	}
	a {
		color: var(--accent);
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
		/* `<!--` must not become an arrow ligature. */
		font-variant-ligatures: none;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
