import { describe, expect, it } from 'vitest';
import { describeError } from './errors';

describe('describeError', () => {
	it('spots network failures and offline state', () => {
		expect(describeError('net::ERR_NAME_NOT_RESOLVED: getaddrinfo ENOTFOUND api.x').kind).toBe(
			'network'
		);
		expect(describeError('Failed to fetch').retry).toBe(true);
		expect(describeError('net::ERR_INTERNET_DISCONNECTED').kind).toBe('network');
		const offline = describeError('whatever', undefined, false);
		expect(offline).toMatchObject({ kind: 'network', title: 'You are offline' });
	});

	it('routes auth problems to Settings, not Retry', () => {
		expect(describeError('Invalid key', 401)).toMatchObject({
			kind: 'auth',
			retry: false,
			settings: true
		});
		expect(describeError('OpenCode Zen needs a free API key: get one…').settings).toBe(true);
	});

	it('marks rate limits and server errors retryable', () => {
		expect(describeError('slow down', 429)).toMatchObject({ kind: 'rate', retry: true });
		expect(describeError('upstream', 502)).toMatchObject({ kind: 'server', retry: true });
		expect(describeError('Add an AI provider in Settings → AI first.').kind).toBe('setup');
	});

	it('tells a content-filter refusal from a bad key', () => {
		expect(describeError('400: Input data may contain inappropriate content.', 400)).toMatchObject({
			kind: 'content',
			retry: true
		});
		expect(describeError('Your input was flagged for "harassment"', 403).kind).toBe('content');
		expect(
			describeError("The provider's content filter stopped the reply (content_filter).").kind
		).toBe('content');
		expect(describeError('Forbidden', 403).kind).toBe('auth');
	});
});
