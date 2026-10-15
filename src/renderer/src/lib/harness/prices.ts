import type { Price } from './usage';
import type { ModelInfo, OtherApi } from './types';

/**
 * Model prices from models.dev (the open catalog OpenCode uses), for runs
 * whose provider reports no cost and has no price set in Settings → AI, plus
 * what the catalog says about each model (name, context window, tools, and
 * which API serves it). A provider is matched by its base URL, a model by its
 * id. Only the endpoints configured here are kept, cached in the `aiPrices`
 * state key.
 */

export const CATALOG_URL = 'https://models.dev/api.json';

export interface PriceCache {
	/** When the catalog was fetched (ms). */
	fetched: number;
	/** Endpoint keys looked up in that fetch, listed or not. */
	checked: string[];
	/** Per endpoint key: model id → [input, output] USD per 1M tokens. */
	prices: Record<string, Record<string, [number, number]>>;
	/** Per endpoint key: model id → what the catalog says about it (caches before it lack this). */
	models?: Record<string, Record<string, CatalogModel>>;
}

export type CatalogModel = Omit<ModelInfo, 'id' | 'price'>;

/** `https://opencode.ai/inference/v1/` → `opencode.ai/inference`: host + path, no scheme, end slash or version. */
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

/** The AI SDK package a model is served with → the API it speaks, when not chat completions. */
const OTHER_APIS: Record<string, OtherApi> = {
	'@ai-sdk/openai': 'responses',
	'@ai-sdk/anthropic': 'messages',
	'@ai-sdk/google': 'gemini'
};

type CatalogEntry = {
	cost?: unknown;
	name?: unknown;
	limit?: { context?: unknown; output?: unknown };
	tool_call?: unknown;
	provider?: { npm?: unknown };
};

/**
 * One catalog entry, cut down. A model whose package differs from its
 * OpenAI-compatible provider's (OpenCode's Claude, GPT and Gemini) is
 * served over that other API.
 */
function modelOf(id: string, m: CatalogEntry, providerNpm: unknown): CatalogModel | null {
	const out: CatalogModel = {};
	if (typeof m.name === 'string' && m.name && m.name !== id) out.name = m.name;
	const context = m.limit?.context;
	if (typeof context === 'number' && context > 0) out.context = context;
	const output = m.limit?.output;
	if (typeof output === 'number' && output > 0) out.output = output;
	if (typeof m.tool_call === 'boolean') out.tools = m.tool_call;
	const npm = m.provider?.npm;
	if (providerNpm === '@ai-sdk/openai-compatible' && typeof npm === 'string' && OTHER_APIS[npm])
		out.api = OTHER_APIS[npm];
	return Object.keys(out).length ? out : null;
}

/**
 * The catalog (`api.json`: provider id → { api?, models: { id: { cost } } })
 * cut down to the endpoints in `keys`.
 */
export function pickPrices(catalog: unknown, keys: string[], now = Date.now()): PriceCache {
	const details: Record<string, Record<string, CatalogModel>> = {};
	const out: PriceCache = {
		fetched: now,
		checked: [...new Set(keys)],
		prices: {},
		models: details
	};
	if (!catalog || typeof catalog !== 'object') return out;
	const providers = catalog as Record<string, { api?: unknown; npm?: unknown; models?: unknown }>;
	const byKey = new Map<string, string>(Object.entries(KNOWN));
	for (const [id, p] of Object.entries(providers))
		if (typeof p?.api === 'string') byKey.set(endpointKey(p.api), id);
	for (const key of out.checked) {
		const provider = providers[byKey.get(key) ?? ''];
		const models = provider?.models;
		if (!models || typeof models !== 'object') continue;
		const table: Record<string, [number, number]> = {};
		const info: Record<string, CatalogModel> = {};
		for (const [model, m] of Object.entries(models as Record<string, CatalogEntry>)) {
			if (!m || typeof m !== 'object') continue;
			const cost = (m.cost ?? null) as { input?: unknown; output?: unknown } | null;
			const input = usd(cost?.input);
			const output = usd(cost?.output);
			if (input !== null && output !== null) table[model] = [input, output];
			const about = modelOf(model, m, provider.npm);
			if (about) info[model] = about;
		}
		if (Object.keys(table).length) out.prices[key] = table;
		if (Object.keys(info).length) details[key] = info;
	}
	return out;
}

/** What the catalog says about `model` at `baseUrl` (its price too), or null. */
export function catalogModel(
	cache: PriceCache | null,
	baseUrl: string,
	model: string
): Omit<ModelInfo, 'id'> | null {
	if (!cache) return null;
	const key = endpointKey(baseUrl);
	const about = cache.models?.[key]?.[model];
	const p = cache.prices[key]?.[model];
	if (!about && !p) return null;
	return { ...about, ...(p ? { price: { input: p[0], output: p[1] } } : {}) };
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

/**
 * Fetch (again): nothing cached, cached before model details were kept, or an
 * endpoint the last fetch didn't look up. Never for age alone: the catalog is
 * 5.6 MB, too much to parse on a tablet's UI thread on a schedule.
 */
export function pricesStale(cache: PriceCache | null, keys: string[]): boolean {
	if (!keys.length) return false;
	if (!cache?.models) return true;
	return keys.some((k) => !cache.checked.includes(k));
}
