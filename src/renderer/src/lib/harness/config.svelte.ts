import { platform } from '../platform';
import { remapPath } from '../../../../shared/paths';
import {
	CATALOG_URL,
	catalogPrice,
	endpointKey,
	pickPrices,
	pricesStale,
	type PriceCache
} from './prices';
import type { Priced } from './usage';
import {
	BUILTIN_PROVIDERS,
	DEFAULT_AI_CONFIG,
	LEGACY_SEARCH_KEY_NAME,
	SEARCH_KINDS,
	providerKeyName,
	searchKeyName,
	type AiConfig,
	type ProviderProfile,
	type SearchKind
} from './types';

/**
 * AI settings shared by Settings → AI and the harness pane. Persisted under
 * the `ai` state key; API keys go to platform secrets, never into this object.
 */
class AiSettings {
	config = $state<AiConfig>({ ...DEFAULT_AI_CONFIG });
	loaded = $state(false);
	private loading: Promise<void> | null = null;

	load(): Promise<void> {
		return (this.loading ??= (async () => {
			const stored = await platform.getState<Partial<AiConfig>>('ai');
			if (stored) {
				const providers = stored.providers ?? [];
				// Built-ins always exist (older configs may predate one), in front.
				const missing = BUILTIN_PROVIDERS.filter((b) => !providers.some((p) => p.id === b.id));
				this.config = {
					...DEFAULT_AI_CONFIG,
					...stored,
					providers: [...missing, ...providers]
				};
			}
			await this.checkKeys();
			this.loaded = true;
		})());
	}

	/** Providers with an API key saved on this device. */
	keys = $state<Record<string, boolean>>({});

	async checkKeys(): Promise<void> {
		const found = await Promise.all(
			this.config.providers.map(async (p) => [p.id, !!(await this.apiKey(p.id))] as const)
		);
		this.keys = Object.fromEntries(found);
	}

	/** Set up and ready to answer: runs locally or has a key. */
	usable(p: ProviderProfile): boolean {
		return p.local || !!this.keys[p.id];
	}

	// --- prices: the profile's own, else models.dev's for the model --------------

	prices = $state.raw<PriceCache | null>(null);
	private pricesTried = 0;

	/**
	 * Fill the price cache for the cloud providers in use that have no price
	 * of their own. Fetches models.dev at most every few minutes, and only
	 * when the cache is old or misses an endpoint.
	 */
	async loadPrices(): Promise<void> {
		this.prices ??= await platform.getState<PriceCache>('aiPrices');
		const wanted = this.config.providers
			.filter((p) => !p.local && !p.price && this.keys[p.id])
			.map((p) => endpointKey(p.baseUrl));
		if (!pricesStale(this.prices, wanted) || Date.now() - this.pricesTried < 10 * 60_000) return;
		this.pricesTried = Date.now();
		try {
			const res = await platform.httpFetch({ url: CATALOG_URL, timeoutMs: 30_000 });
			if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
			this.prices = pickPrices(JSON.parse(res.body), wanted);
			void platform.setState('aiPrices', this.prices);
		} catch (err) {
			console.warn('[ai] model prices unavailable', err);
		}
	}

	/** How a run on `providerId` / `model` is priced (see usage.ts `priceTokens`). */
	priced(providerId: string, model?: string): Priced | undefined {
		const p = this.config.providers.find((x) => x.id === providerId);
		if (!p || p.local || p.price) return p;
		const auto = catalogPrice(this.prices, p.baseUrl, model || p.model);
		return auto ? { price: auto } : p;
	}

	/** Where `priced` gets its price: set by you, models.dev, local (free), or none. */
	priceSource(p: ProviderProfile): 'local' | 'own' | 'catalog' | null {
		if (p.local) return 'local';
		if (p.price) return 'own';
		return catalogPrice(this.prices, p.baseUrl, p.model) ? 'catalog' : null;
	}

	/** Model ids per provider, fetched from its `/models` endpoint (not persisted). */
	models = $state<Record<string, string[]>>({});
	modelErrors = $state<Record<string, string>>({});

	async fetchModels(id: string): Promise<void> {
		const p = this.config.providers.find((x) => x.id === id);
		if (!p) return;
		try {
			// Loaded on demand: the rest of the app reads this config without the client.
			const { listModels } = await import('./openai');
			const ids = await listModels(platform, p, await this.apiKey(id));
			this.models = { ...this.models, [id]: ids };
			const { [id]: _drop, ...rest } = this.modelErrors;
			void _drop;
			this.modelErrors = rest;
		} catch (err) {
			this.modelErrors = {
				...this.modelErrors,
				[id]: err instanceof Error ? err.message : String(err)
			};
		}
	}

	setModel(id: string, model: string): void {
		const p = this.config.providers.find((x) => x.id === id);
		if (p && model) this.saveProvider({ ...p, model });
	}

	update(patch: Partial<AiConfig>): void {
		this.config = { ...this.config, ...patch };
		void platform.setState('ai', $state.snapshot(this.config));
	}

	/** Hide folder `dir` (and everything below it) from cloud AI, or stop hiding it. */
	setFolderHidden(dir: string, hidden: boolean): void {
		const rest = this.config.localOnlyFolders.filter((f) => f !== dir);
		this.update({ localOnlyFolders: (hidden ? [...rest, dir] : rest).sort() });
	}

	/** A folder moved / was renamed: its privacy goes with it. */
	async folderMoved(from: string, to: string): Promise<void> {
		await this.load();
		const cur = this.config.localOnlyFolders;
		const next = cur.map((f) => remapPath(f, from, to) ?? f);
		if (next.some((f, i) => f !== cur[i]))
			this.update({ localOnlyFolders: next.filter((f, i) => next.indexOf(f) === i).sort() });
	}

	provider(id: string | null | undefined): ProviderProfile | null {
		const all = this.config.providers;
		return (
			all.find((p) => p.id === id) ??
			all.find((p) => p.id === this.config.defaultProvider) ??
			all[0] ??
			null
		);
	}

	saveProvider(p: ProviderProfile): void {
		const rest = this.config.providers.filter((x) => x.id !== p.id);
		const providers = [...rest, p];
		const idx = this.config.providers.findIndex((x) => x.id === p.id);
		if (idx !== -1) providers.splice(idx, 0, providers.pop()!);
		this.update({ providers, defaultProvider: this.config.defaultProvider ?? p.id });
	}

	removeProvider(id: string): void {
		const providers = this.config.providers.filter((p) => p.id !== id);
		this.update({
			providers,
			defaultProvider:
				this.config.defaultProvider === id
					? (providers[0]?.id ?? null)
					: this.config.defaultProvider
		});
		void platform.setSecret(providerKeyName(id), null);
		const { [id]: _gone, ...keys } = this.keys;
		void _gone;
		this.keys = keys;
	}

	apiKey(providerId: string): Promise<string | null> {
		return platform.getSecret(providerKeyName(providerId));
	}

	async setApiKey(providerId: string, key: string | null): Promise<void> {
		await platform.setSecret(providerKeyName(providerId), key);
		this.keys = { ...this.keys, [providerId]: !!key };
		if (key) void this.loadPrices();
	}

	/** The key for a search provider (DuckDuckGo / SearXNG need none). */
	async searchKey(kind: SearchKind | undefined): Promise<string | null> {
		if (!SEARCH_KINDS.find((k) => k.kind === kind)?.needsKey) return null;
		const key = await platform.getSecret(searchKeyName(kind!));
		// The legacy key was Brave's or Tavily's; never hand it to a provider added since.
		if (key !== null || (kind !== 'brave' && kind !== 'tavily')) return key;
		return platform.getSecret(LEGACY_SEARCH_KEY_NAME);
	}

	async setSearchKey(kind: SearchKind, key: string | null): Promise<void> {
		await platform.setSecret(searchKeyName(kind), key);
		// The old shared key would otherwise come back as the fallback.
		if (!key) await platform.setSecret(LEGACY_SEARCH_KEY_NAME, null);
	}
}

let instance: AiSettings | null = null;

export function getAiSettings(): AiSettings {
	return (instance ??= new AiSettings());
}

export type { AiSettings };
