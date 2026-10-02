import { describe, expect, it } from 'vitest';
import { chatCompletion, completionsUrl } from './openai';
import type { Http, ProviderProfile } from './types';

const profile: ProviderProfile = {
	id: 'p',
	name: 'Test',
	baseUrl: 'http://x/v1/',
	model: 'm',
	local: true,
	tools: true,
	contextTokens: 8000
};

const sse = (...events: unknown[]) =>
	events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');

describe('completionsUrl', () => {
	it('appends the path once', () => {
		expect(completionsUrl('http://x/v1/')).toBe('http://x/v1/chat/completions');
		expect(completionsUrl('http://x/v1/chat/completions')).toBe('http://x/v1/chat/completions');
	});
});

describe('chatCompletion', () => {
	it('streams text deltas and merges tool-call fragments', async () => {
		const body = sse(
			{ choices: [{ delta: { content: 'Hel' } }] },
			{ choices: [{ delta: { content: 'lo' } }] },
			{
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_', arguments: '{"id"' } }]
						}
					}
				]
			},
			{
				choices: [
					{ delta: { tool_calls: [{ index: 0, function: { name: 'note', arguments: ':"a"}' } }] } }
				]
			},
			{ choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
			'[DONE]'
		);
		const deltas: string[] = [];
		const http: Http = {
			httpFetch: async () => ({ status: 200, headers: {}, body: '' }),
			httpStream: async (_id, _req, onChunk) => {
				for (let i = 0; i < body.length; i += 7) onChunk(body.slice(i, i + 7));
				return { status: 200, headers: {}, body: '' };
			}
		};
		const r = await chatCompletion(http, {
			profile,
			apiKey: 'k',
			messages: [{ role: 'user', content: 'hi' }],
			onDelta: (t) => deltas.push(t)
		});
		expect(deltas.join('')).toBe('Hello');
		expect(r.content).toBe('Hello');
		expect(r.toolCalls).toEqual([{ id: 'c1', name: 'read_note', arguments: '{"id":"a"}' }]);
		expect(r.finishReason).toBe('tool_calls');
	});

	it('parses a buffered SSE body or a plain JSON completion (no streaming)', async () => {
		const buffered: Http = {
			httpFetch: async () => ({
				status: 200,
				headers: {},
				body: sse({ choices: [{ delta: { content: 'ok' } }] }, '[DONE]')
			})
		};
		expect((await chatCompletion(buffered, { profile, apiKey: null, messages: [] })).content).toBe(
			'ok'
		);
		const json: Http = {
			httpFetch: async () => ({
				status: 200,
				headers: {},
				body: JSON.stringify({
					choices: [{ message: { content: 'whole' }, finish_reason: 'stop' }]
				})
			})
		};
		expect((await chatCompletion(json, { profile, apiKey: null, messages: [] })).content).toBe(
			'whole'
		);
	});

	it('surfaces the provider error message', async () => {
		const http: Http = {
			httpFetch: async () => ({
				status: 401,
				headers: {},
				body: JSON.stringify({ error: { message: 'bad key' } })
			})
		};
		await expect(chatCompletion(http, { profile, apiKey: 'x', messages: [] })).rejects.toThrow(
			'401: bad key'
		);
	});
});
