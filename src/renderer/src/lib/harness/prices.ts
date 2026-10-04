import type { Price } from './usage';

/**
 * Model prices from models.dev (the open catalog OpenCode uses), for runs
 * whose provider reports no cost and has no price set in Settings → AI. A
 * provider is matched by its base URL, a model by its id. Only the endpoints
 * configured here are kept, cached in the `aiPrices` state key.
 */

export const CATALOG_URL = 'https://models.dev/api.json';
/** A cached catalog is fetched again after this long. */
export const CATALOG_MAX_AGE = 3 * 24 * 3600 * 1000;

export interface PriceCache {
	/** When the catalog was fetched (ms). */
	fetched: number;
	/** Endpoint keys looked up in that fetch, listed or not. */
	checked: string[];
	/** Per endpoint key: model id → [input, output] USD per 1M tokens. */
	prices: Record<string, Record<string, [number, number]>>;
}

/** `https://opencode.ai/zen/v1/` → `opencode.ai/zen`: host + path, no scheme, end slash or version. */
export function endpointKey(url: string): string {
	return url
		.trim()
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, '')
		.replace(/\/+$/, '')
		.replace(/\/v\d+$/, '');
}

/** OpenAI-compatible endpoints of providers models.dev lists without an API URL. */
const KNOWN: Record<string, string> = {
	'api.openai.com': 'openai',
	'api.anthropic.com': 'anthropic',
	'generativelanguage.googleapis.com/v1beta/openai': 'google',
	'api.mistral.ai': 'mistral',
	'api.groq.com/openai': 'groq',
	'api.x.ai': 'xai',
	'api.deepinfra.com/v1/openai': 'deepinfra',
	'api.together.xyz': 'togetherai',
	'api.cerebras.ai': 'cerebras',
	'api.perplexity.ai': 'perplexity'
};

const usd = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

/**
 * The catalog (`api.json`: provider id → { api?, models: { id: { cost } } })
 * cut down to the endpoints in `keys`.
 */
export function pickPrices(catalog: unknown, keys: string[], now = Date.now()): PriceCache {
	const out: PriceCache = { fetched: now, checked: [...new Set(keys)], prices: {} };
	if (!catalog || typeof catalog !== 'object') return out;
	const providers = catalog as Record<string, { api?: unknown; models?: unknown }>;
	const byKey = new Map<string, string>(Object.entries(KNOWN));
	for (const [id, p] of Object.entries(providers))
		if (typeof p?.api === 'string') byKey.set(endpointKey(p.api), id);
	for (const key of out.checked) {
		const models = providers[byKey.get(key) ?? '']?.models;
		if (!models || typeof models !== 'object') continue;
		const table: Record<string, [number, number]> = {};
		for (const [model, m] of Object.entries(models as Record<string, { cost?: unknown }>)) {
			const cost = (m?.cost ?? null) as { input?: unknown; output?: unknown } | null;
			const input = usd(cost?.input);
			const output = usd(cost?.output);
			if (input !== null && output !== null) table[model] = [input, output];
		}
		if (Object.keys(table).length) out.prices[key] = table;
	}
	return out;
}

/** The catalog's price for `model` at `baseUrl`, or null when it doesn't list one. */
export function catalogPrice(
	cache: PriceCache | null,
	baseUrl: string,
	model: string
): Price | null {
	const p = cache?.prices[endpointKey(baseUrl)]?.[model];
	return p ? { input: p[0], output: p[1] } : null;
}

/** Fetch again: nothing cached, too old, or an endpoint the last fetch didn't look up. */
export function pricesStale(cache: PriceCache | null, keys: string[], now = Date.now()): boolean {
	if (!keys.length) return false;
	if (!cache || now - cache.fetched > CATALOG_MAX_AGE) return true;
	return keys.some((k) => !cache.checked.includes(k));
}
