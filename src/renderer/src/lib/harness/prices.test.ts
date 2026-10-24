import { describe, expect, it } from 'vitest';
import {
	catalogModel,
	catalogPrice,
	endpointKey,
	opencodeModelApi,
	pickPrices,
	pricesStale
} from './prices';

/** A slice of models.dev's api.json. */
const catalog = {
	opencode: {
		api: 'https://opencode.ai/inference/v1',
		npm: '@ai-sdk/openai-compatible',
		models: {
			'big-pickle': { cost: { input: 0, output: 0 } },
			'kimi-k2.5': {
				name: 'Kimi K2.5',
				tool_call: true,
				limit: { context: 262144, output: 32768 },
				cost: { input: 0.6, output: 3, cache_read: 0.08 }
			},
			'claude-haiku-5-5': {
				name: 'Claude Haiku 5.5',
				provider: { npm: '@ai-sdk/anthropic' },
				cost: { input: 1, output: 5 }
			},
			'gpt-6-luna': { provider: { npm: '@ai-sdk/openai' } },
			'gemini-4-argon': { provider: { npm: '@ai-sdk/google' } },
			'mistral-large-4': { provider: { npm: '@ai-sdk/mistral' } },
			'image-thing': {}
		}
	},
	'opencode-go': {
		api: 'https://opencode.ai/inference/go/v1',
		models: { 'glm-5.3': { cost: { input: 1.4, output: 4.4 } } }
	},
	deepseek: {
		api: 'https://api.deepseek.com',
		models: { 'deepseek-v4-flash': { cost: { input: 0.15, output: 0.6 } } }
	},
	// No API URL listed: matched by the known endpoint.
	openai: { models: { 'gpt-5-nano': { cost: { input: 0.05, output: 0.4 } } } },
	other: { api: 'https://example.com/v1', models: { x: { cost: { input: 9, output: 9 } } } }
};

describe('model prices (models.dev)', () => {
	it('keys endpoints by host + path, without scheme, slash or version', () => {
		expect(endpointKey('https://opencode.ai/inference/v1/')).toBe('opencode.ai/inference');
		expect(endpointKey('https://opencode.ai/inference/go/v1')).toBe('opencode.ai/inference/go');
		expect(endpointKey('https://API.deepseek.com/v1')).toBe('api.deepseek.com');
		expect(endpointKey('https://api.deepseek.com')).toBe('api.deepseek.com');
	});

	it('keeps only the endpoints in use, per model', () => {
		const keys = [
			'https://opencode.ai/inference/v1',
			'https://api.deepseek.com/v1',
			'https://api.openai.com/v1',
			'http://10.0.0.2:8080/v1'
		].map(endpointKey);
		const cache = pickPrices(catalog, keys, 1000);
		expect(cache.fetched).toBe(1000);
		expect(Object.keys(cache.prices).sort()).toEqual([
			'api.deepseek.com',
			'api.openai.com',
			'opencode.ai/inference'
		]);
		expect(cache.prices['opencode.ai/inference']).toEqual({
			'big-pickle': [0, 0],
			'kimi-k2.5': [0.6, 3],
			'claude-haiku-5-5': [1, 5]
		});
		// Looked up but not listed: remembered, so it isn't fetched again for it.
		expect(cache.checked).toContain('10.0.0.2:8080');

		expect(catalogPrice(cache, 'https://opencode.ai/inference/v1', 'kimi-k2.5')).toEqual({
			input: 0.6,
			output: 3
		});
		expect(catalogPrice(cache, 'https://opencode.ai/inference/v1', 'big-pickle')).toEqual({
			input: 0,
			output: 0
		});
		expect(catalogPrice(cache, 'https://api.deepseek.com/v1', 'deepseek-v4-flash')).toEqual({
			input: 0.15,
			output: 0.6
		});
		expect(catalogPrice(cache, 'https://api.openai.com/v1', 'gpt-5-nano')).toEqual({
			input: 0.05,
			output: 0.4
		});
		expect(catalogPrice(cache, 'https://opencode.ai/inference/v1', 'unknown')).toBeNull();
		expect(catalogPrice(cache, 'https://opencode.ai/inference/go/v1', 'glm-5.3')).toBeNull();
		expect(catalogPrice(null, 'https://opencode.ai/inference/v1', 'kimi-k2.5')).toBeNull();
		expect(pickPrices('not json', keys).prices).toEqual({});
	});

	it('fetches again only when the cache is missing, predates model details, or lacks an endpoint', () => {
		const keys = ['opencode.ai/inference'];
		const cache = pickPrices(catalog, keys, 1000);
		expect(pricesStale(null, keys)).toBe(true);
		// Cached before model details were kept.
		const { models: _models, ...old } = cache;
		void _models;
		expect(pricesStale(old, keys)).toBe(true);
		expect(pricesStale(null, [])).toBe(false);
		expect(pricesStale(cache, keys)).toBe(false);
		// However old: a cached catalog stays (no fetch on a schedule).
		expect(pricesStale({ ...cache, fetched: 0 }, keys)).toBe(false);
		expect(pricesStale(cache, [...keys, 'api.deepseek.com'])).toBe(true);
	});

	it('keeps what the catalog says about each model, and which API serves it', () => {
		const cache = pickPrices(catalog, ['opencode.ai/inference'], 1000);
		const at = 'https://opencode.ai/inference/v1';
		expect(catalogModel(cache, at, 'kimi-k2.5')).toEqual({
			name: 'Kimi K2.5',
			context: 262144,
			output: 32768,
			tools: true,
			price: { input: 0.6, output: 3 }
		});
		// OpenCode serves these only over the Messages / Responses / Gemini APIs.
		expect(catalogModel(cache, at, 'claude-haiku-5-5')?.api).toBe('messages');
		expect(catalogModel(cache, at, 'gpt-6-luna')?.api).toBe('responses');
		expect(catalogModel(cache, at, 'gemini-4-argon')?.api).toBe('gemini');
		expect(catalogModel(cache, at, 'mistral-large-4')).toBeNull();
		expect(catalogModel(cache, at, 'big-pickle')).toEqual({ price: { input: 0, output: 0 } });
		expect(catalogModel(cache, at, 'unknown')).toBeNull();
		// A provider that isn't OpenAI-compatible itself: its package says nothing about the API.
		const openai = pickPrices(
			{
				openai: {
					npm: '@ai-sdk/openai',
					models: { 'gpt-5': { provider: { npm: '@ai-sdk/openai' } } }
				}
			},
			['api.openai.com']
		);
		expect(catalogModel(openai, 'https://api.openai.com/v1', 'gpt-5')).toBeNull();
	});

	it('routes new OpenCode model families before the catalog cache knows them', () => {
		const at = 'https://opencode.ai/inference/v1';
		expect(opencodeModelApi(at, 'gpt-6-luna')).toBe('responses');
		expect(opencodeModelApi(at, 'gemini-4-argon')).toBe('gemini');
		expect(opencodeModelApi(at, 'claude-haiku-5-5')).toBe('messages');
		expect(opencodeModelApi(at, 'kimi-k2.5')).toBeUndefined();
		expect(opencodeModelApi('https://openrouter.ai/api/v1', 'gpt-6-luna')).toBeUndefined();
	});
});
