import { describe, expect, it } from 'vitest';
import { CATALOG_MAX_AGE, catalogPrice, endpointKey, pickPrices, pricesStale } from './prices';

/** A slice of models.dev's api.json. */
const catalog = {
	opencode: {
		api: 'https://opencode.ai/zen/v1',
		models: {
			'big-pickle': { cost: { input: 0, output: 0 } },
			'kimi-k2.5': { cost: { input: 0.6, output: 3, cache_read: 0.08 } },
			'image-thing': {}
		}
	},
	'opencode-go': {
		api: 'https://opencode.ai/zen/go/v1',
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
		expect(endpointKey('https://opencode.ai/zen/v1/')).toBe('opencode.ai/zen');
		expect(endpointKey('https://opencode.ai/zen/go/v1')).toBe('opencode.ai/zen/go');
		expect(endpointKey('https://API.deepseek.com/v1')).toBe('api.deepseek.com');
		expect(endpointKey('https://api.deepseek.com')).toBe('api.deepseek.com');
	});

	it('keeps only the endpoints in use, per model', () => {
		const keys = [
			'https://opencode.ai/zen/v1',
			'https://api.deepseek.com/v1',
			'https://api.openai.com/v1',
			'http://10.0.0.2:8080/v1'
		].map(endpointKey);
		const cache = pickPrices(catalog, keys, 1000);
		expect(cache.fetched).toBe(1000);
		expect(Object.keys(cache.prices).sort()).toEqual([
			'api.deepseek.com',
			'api.openai.com',
			'opencode.ai/zen'
		]);
		expect(cache.prices['opencode.ai/zen']).toEqual({
			'big-pickle': [0, 0],
			'kimi-k2.5': [0.6, 3]
		});
		// Looked up but not listed: remembered, so it isn't fetched again for it.
		expect(cache.checked).toContain('10.0.0.2:8080');

		expect(catalogPrice(cache, 'https://opencode.ai/zen/v1', 'kimi-k2.5')).toEqual({
			input: 0.6,
			output: 3
		});
		expect(catalogPrice(cache, 'https://opencode.ai/zen/v1', 'big-pickle')).toEqual({
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
		expect(catalogPrice(cache, 'https://opencode.ai/zen/v1', 'unknown')).toBeNull();
		expect(catalogPrice(cache, 'https://opencode.ai/zen/go/v1', 'glm-5.3')).toBeNull();
		expect(catalogPrice(null, 'https://opencode.ai/zen/v1', 'kimi-k2.5')).toBeNull();
		expect(pickPrices('not json', keys).prices).toEqual({});
	});

	it('fetches again when the cache is missing, old, or lacks an endpoint', () => {
		const keys = ['opencode.ai/zen'];
		const cache = pickPrices(catalog, keys, 1000);
		expect(pricesStale(null, keys, 1000)).toBe(true);
		expect(pricesStale(null, [], 1000)).toBe(false);
		expect(pricesStale(cache, keys, 2000)).toBe(false);
		expect(pricesStale(cache, keys, 1000 + CATALOG_MAX_AGE + 1)).toBe(true);
		expect(pricesStale(cache, [...keys, 'api.deepseek.com'], 2000)).toBe(true);
	});
});
