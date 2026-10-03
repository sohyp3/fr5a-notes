import { platform } from '../platform';
import { remapPath } from '../../../../shared/paths';
import {
	BUILTIN_PROVIDERS,
	DEFAULT_AI_CONFIG,
	LEGACY_SEARCH_KEY_NAME,
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
			this.loaded = true;
		})());
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
	}

	apiKey(providerId: string): Promise<string | null> {
		return platform.getSecret(providerKeyName(providerId));
	}

	setApiKey(providerId: string, key: string | null): Promise<void> {
		return platform.setSecret(providerKeyName(providerId), key);
	}

	/** The key for a search provider (DuckDuckGo / SearXNG need none). */
	async searchKey(kind: SearchKind | undefined): Promise<string | null> {
		if (kind !== 'brave' && kind !== 'tavily') return null;
		return (
			(await platform.getSecret(searchKeyName(kind))) ??
			(await platform.getSecret(LEGACY_SEARCH_KEY_NAME))
		);
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
