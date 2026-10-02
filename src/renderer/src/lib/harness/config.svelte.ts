import { platform } from '../platform';
import {
	DEFAULT_AI_CONFIG,
	providerKeyName,
	SEARCH_KEY_NAME,
	type AiConfig,
	type ProviderProfile
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
			if (stored) this.config = { ...DEFAULT_AI_CONFIG, ...stored };
			this.loaded = true;
		})());
	}

	update(patch: Partial<AiConfig>): void {
		this.config = { ...this.config, ...patch };
		void platform.setState('ai', $state.snapshot(this.config));
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

	searchKey(): Promise<string | null> {
		return platform.getSecret(SEARCH_KEY_NAME);
	}

	setSearchKey(key: string | null): Promise<void> {
		return platform.setSecret(SEARCH_KEY_NAME, key);
	}
}

let instance: AiSettings | null = null;

export function getAiSettings(): AiSettings {
	return (instance ??= new AiSettings());
}

export type { AiSettings };
