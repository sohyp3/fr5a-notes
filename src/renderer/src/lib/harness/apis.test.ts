import { describe, expect, it } from 'vitest';
import { createMessagesAccumulator, messagesCompletion, toMessages } from './anthropic';
import { createResponsesAccumulator, responsesCompletion, toInput } from './responses';
import { SKIP_SIGNATURE, createGeminiAccumulator, geminiCompletion, toContents } from './gemini';
import { chatCompletion } from './openai';
import { TRIMMED } from './transport';
import type { HttpRequest } from '../../../../shared/types';
import type { ChatMessage, Http, ProviderProfile, ToolDef } from './types';

const opencode: ProviderProfile = {
	id: 'opencode-zen',
	name: 'OpenCode',
	baseUrl: 'https://opencode.ai/inference/go/v1',
	model: 'qwen3.8-flash',
	local: false,
	tools: true,
	contextTokens: 128_000
};

/** A history with a tool round: what every converter has to carry over. */
const history: ChatMessage[] = [
	{ role: 'system', content: 'You help with notes.' },
	{ role: 'user', content: 'Tone of my plan?' },
	{
		role: 'assistant',
		content: 'Let me read it.',
		tool_calls: [
			{ id: 'functions.read_note:0', name: 'read_note', arguments: '{"id":"plan.md"}' },
			{ id: 'call_2', name: 'list_notes', arguments: '' }
		]
	},
	{ role: 'tool', tool_call_id: 'functions.read_note:0', content: '# Plan' },
	{ role: 'tool', tool_call_id: 'call_2', content: '' },
	{ role: 'user', content: 'And?' }
];

const tools: ToolDef[] = [
	{
		name: 'read_note',
		description: 'Read a note',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: { id: { type: 'string', description: 'Note id' } },
			required: ['id']
		}
	}
];

const sse = (...events: unknown[]) =>
	events
		.map((e) => {
			const type = (e as { type?: string }).type;
			return `${type ? `event: ${type}\n` : ''}data: ${JSON.stringify(e)}\n\n`;
		})
		.join('');

/** A streaming host that records the request and answers `body` in small slices. */
function host(body: string, status = 200) {
	const seen: HttpRequest[] = [];
	const http: Http = {
		httpFetch: async () => ({ status: 500, headers: {}, body: 'unused' }),
		httpStream: async (_id, req, onChunk) => {
			seen.push(req);
			if (status !== 200) return { status, headers: {}, body };
			for (let i = 0; i < body.length; i += 11) onChunk(body.slice(i, i + 11));
			return { status, headers: {}, body: '' };
		}
	};
	return { http, seen, sent: () => JSON.parse(seen[0].body!) };
}

describe('Anthropic Messages', () => {
	it('converts the history: system apart, tool results in one user turn, safe ids', () => {
		const { system, messages } = toMessages(history);
		expect(system).toBe('You help with notes.');
		expect(messages).toEqual([
			{ role: 'user', content: [{ type: 'text', text: 'Tone of my plan?' }] },
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Let me read it.' },
					{
						type: 'tool_use',
						id: 'functions_read_note_0',
						name: 'read_note',
						input: { id: 'plan.md' }
					},
					{ type: 'tool_use', id: 'call_2', name: 'list_notes', input: {} }
				]
			},
			{
				role: 'user',
				content: [
					{ type: 'tool_result', tool_use_id: 'functions_read_note_0', content: '# Plan' },
					{ type: 'tool_result', tool_use_id: 'call_2', content: '(empty)' },
					{ type: 'text', text: 'And?' }
				]
			}
		]);
	});

	it('merges the event stream: text, tool input in pieces, stop reason, usage', () => {
		const deltas: string[] = [];
		const acc = createMessagesAccumulator((t) => deltas.push(t));
		for (const e of [
			{
				type: 'message_start',
				message: { usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 1 } }
			},
			{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
			{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Read' } },
			{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ing.' } },
			{ type: 'content_block_stop', index: 0 },
			{
				type: 'content_block_start',
				index: 1,
				content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_note', input: {} }
			},
			{
				type: 'content_block_delta',
				index: 1,
				delta: { type: 'input_json_delta', partial_json: '{"id":' }
			},
			{
				type: 'content_block_delta',
				index: 1,
				delta: { type: 'input_json_delta', partial_json: '"a.md"}' }
			},
			{
				type: 'content_block_start',
				index: 2,
				content_block: { type: 'tool_use', id: 'toolu_2', name: 'list_notes', input: {} }
			},
			{ type: 'ping' },
			{ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } },
			{ type: 'message_stop' }
		])
			acc.push(JSON.stringify(e));
		expect(deltas).toEqual(['Read', 'ing.']);
		expect(acc.result()).toEqual({
			content: 'Reading.',
			toolCalls: [
				{ id: 'toolu_1', name: 'read_note', arguments: '{"id":"a.md"}' },
				{ id: 'toolu_2', name: 'list_notes', arguments: '{}' }
			],
			finishReason: 'tool_calls',
			usage: { input: 120, output: 42 }
		});
		expect(() => acc.push('{"type":"error","error":{"message":"Overloaded"}}')).toThrow(
			'Overloaded'
		);
	});

	it('posts to {base}/messages with a reply budget, the key both ways, and Claude caching', async () => {
		const { http, seen, sent } = host(
			sse(
				{ type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } },
				{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
				{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
				{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }
			)
		);
		const res = await messagesCompletion(http, {
			profile: { ...opencode, model: 'claude-haiku-5-5', api: 'messages', maxOutput: 64_000 },
			apiKey: 'k',
			messages: history,
			tools,
			session: 'fr5a-1'
		});
		expect(res).toMatchObject({
			content: 'OK',
			finishReason: 'stop',
			usage: { input: 5, output: 2 }
		});
		expect(seen[0].url).toBe('https://opencode.ai/inference/go/v1/messages');
		expect(seen[0].headers).toMatchObject({
			'x-api-key': 'k',
			Authorization: 'Bearer k',
			'anthropic-version': '2023-06-01',
			'x-opencode-session': 'fr5a-1'
		});
		const body = sent();
		expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 16_384, stream: true });
		expect(body.system).toEqual([
			{ type: 'text', text: 'You help with notes.', cache_control: { type: 'ephemeral' } }
		]);
		expect(body.messages.at(-1).content.at(-1)).toEqual({
			type: 'text',
			text: 'And?',
			cache_control: { type: 'ephemeral' }
		});
		expect(body.tools).toEqual([
			{ name: 'read_note', description: 'Read a note', input_schema: tools[0].parameters }
		]);
	});
});

describe('OpenAI Responses', () => {
	it('converts the history into input items, system text as instructions', () => {
		const { instructions, input } = toInput(history);
		expect(instructions).toBe('You help with notes.');
		expect(input).toEqual([
			{ role: 'user', content: 'Tone of my plan?' },
			{ role: 'assistant', content: 'Let me read it.' },
			{
				type: 'function_call',
				call_id: 'functions.read_note:0',
				name: 'read_note',
				arguments: '{"id":"plan.md"}'
			},
			{ type: 'function_call', call_id: 'call_2', name: 'list_notes', arguments: '' },
			{ type: 'function_call_output', call_id: 'functions.read_note:0', output: '# Plan' },
			{ type: 'function_call_output', call_id: 'call_2', output: '(empty)' },
			{ role: 'user', content: 'And?' }
		]);
	});

	it('merges the event stream: text, function call arguments, usage', () => {
		const deltas: string[] = [];
		const acc = createResponsesAccumulator((t) => deltas.push(t));
		for (const e of [
			{ type: 'response.created', response: { status: 'in_progress' } },
			{ type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning' } },
			{ type: 'response.output_item.added', output_index: 1, item: { type: 'message' } },
			{ type: 'response.output_text.delta', output_index: 1, delta: 'Read' },
			{ type: 'response.output_text.delta', output_index: 1, delta: 'ing.' },
			{
				type: 'response.output_item.added',
				output_index: 2,
				item: { type: 'function_call', call_id: 'call_a', name: 'read_note', arguments: '' }
			},
			{ type: 'response.function_call_arguments.delta', output_index: 2, delta: '{"id":' },
			{ type: 'response.function_call_arguments.delta', output_index: 2, delta: '"a.md"}' },
			{
				type: 'response.output_item.done',
				output_index: 2,
				item: {
					type: 'function_call',
					call_id: 'call_a',
					name: 'read_note',
					arguments: '{"id":"a.md"}'
				}
			},
			{
				type: 'response.completed',
				response: { status: 'completed', usage: { input_tokens: 300, output_tokens: 40 } }
			}
		])
			acc.push(JSON.stringify(e));
		expect(deltas).toEqual(['Read', 'ing.']);
		expect(acc.result()).toEqual({
			content: 'Reading.',
			toolCalls: [{ id: 'call_a', name: 'read_note', arguments: '{"id":"a.md"}' }],
			finishReason: 'tool_calls',
			usage: { input: 300, output: 40 }
		});
	});

	it('reads a response that was not streamed, and failures', () => {
		const acc = createResponsesAccumulator();
		acc.push(
			JSON.stringify({
				object: 'response',
				status: 'incomplete',
				incomplete_details: { reason: 'max_output_tokens' },
				output: [{ type: 'message', content: [{ type: 'output_text', text: 'Long…' }] }],
				usage: { input_tokens: 9, output_tokens: 99 }
			})
		);
		expect(acc.result()).toEqual({
			content: 'Long…',
			toolCalls: [],
			finishReason: 'length',
			usage: { input: 9, output: 99 }
		});
		expect(() =>
			acc.push('{"type":"response.failed","response":{"error":{"message":"Bad input"}}}')
		).toThrow('Bad input');
	});

	it('posts to {base}/responses, stateless, with non-strict function tools', async () => {
		const { http, seen, sent } = host(
			sse(
				{ type: 'response.output_text.delta', output_index: 0, delta: 'OK' },
				{ type: 'response.completed', response: { status: 'completed' } }
			)
		);
		const res = await responsesCompletion(http, {
			profile: { ...opencode, model: 'gpt-6-luna', api: 'responses' },
			apiKey: 'k',
			messages: history,
			tools
		});
		expect(res).toMatchObject({ content: 'OK', finishReason: 'stop' });
		expect(seen[0].url).toBe('https://opencode.ai/inference/go/v1/responses');
		expect(seen[0].headers).toMatchObject({ Authorization: 'Bearer k' });
		expect(sent()).toMatchObject({
			model: 'gpt-6-luna',
			stream: true,
			store: false,
			instructions: 'You help with notes.',
			tools: [
				{
					type: 'function',
					name: 'read_note',
					description: 'Read a note',
					parameters: tools[0].parameters,
					strict: false
				}
			]
		});
	});
});

describe('Gemini', () => {
	it('converts the history: named function responses, signatures (or the stand-in) on calls', () => {
		const own: ChatMessage[] = [
			{ role: 'user', content: 'Hi' },
			{
				role: 'assistant',
				content: null,
				tool_calls: [
					{ id: 'g1', name: 'read_note', arguments: '{"id":"a.md"}', signature: 'sig-1' },
					{ id: 'g2', name: 'read_note', arguments: '{"id":"b.md"}' }
				]
			},
			{ role: 'tool', tool_call_id: 'g1', content: 'A' },
			{ role: 'tool', tool_call_id: 'g2', content: 'B' }
		];
		expect(toContents(own).contents).toEqual([
			{ role: 'user', parts: [{ text: 'Hi' }] },
			{
				role: 'model',
				parts: [
					{ functionCall: { name: 'read_note', args: { id: 'a.md' } }, thoughtSignature: 'sig-1' },
					{ functionCall: { name: 'read_note', args: { id: 'b.md' } } }
				]
			},
			{
				role: 'user',
				parts: [
					{ functionResponse: { name: 'read_note', response: { output: 'A' } } },
					{ functionResponse: { name: 'read_note', response: { output: 'B' } } }
				]
			}
		]);
		// Calls another model made: Google's stand-in signature on the first.
		const { system, contents } = toContents(history);
		expect(system).toBe('You help with notes.');
		expect(contents[1]).toEqual({
			role: 'model',
			parts: [
				{ text: 'Let me read it.' },
				{
					functionCall: { name: 'read_note', args: { id: 'plan.md' } },
					thoughtSignature: SKIP_SIGNATURE
				},
				{ functionCall: { name: 'list_notes', args: {} } }
			]
		});
		expect(contents[2].parts.map((p) => p.functionResponse?.name ?? p.text)).toEqual([
			'read_note',
			'list_notes',
			'And?'
		]);
	});

	it('merges streamed chunks: text, not thoughts; calls keep their signature', () => {
		const deltas: string[] = [];
		const acc = createGeminiAccumulator((t) => deltas.push(t));
		acc.push(
			JSON.stringify({
				candidates: [{ content: { role: 'model', parts: [{ text: 'hmm', thought: true }] } }]
			})
		);
		acc.push(
			JSON.stringify({
				candidates: [{ content: { role: 'model', parts: [{ text: 'Reading.' }] } }]
			})
		);
		acc.push(
			JSON.stringify({
				candidates: [
					{
						content: {
							role: 'model',
							parts: [
								{
									functionCall: { name: 'read_note', args: { id: 'a.md' } },
									thoughtSignature: 'sig-9'
								}
							]
						},
						finishReason: 'STOP'
					}
				],
				usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, thoughtsTokenCount: 30 }
			})
		);
		expect(deltas).toEqual(['Reading.']);
		expect(acc.result()).toEqual({
			content: 'Reading.',
			toolCalls: [
				{ id: 'call_0', name: 'read_note', arguments: '{"id":"a.md"}', signature: 'sig-9' }
			],
			finishReason: 'tool_calls',
			usage: { input: 50, output: 40 }
		});
		const blocked = createGeminiAccumulator();
		blocked.push(JSON.stringify({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }));
		expect(blocked.result().finishReason).toBe('PROHIBITED_CONTENT');
	});

	it('streams from {base}/models/{model}:streamGenerateContent with a schema Gemini takes', async () => {
		const { http, seen, sent } = host(
			sse({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] })
		);
		const res = await geminiCompletion(http, {
			profile: { ...opencode, model: 'gemini-4-argon-contributor', api: 'gemini' },
			apiKey: 'k',
			messages: history,
			tools
		});
		expect(res).toMatchObject({ content: 'OK', finishReason: 'stop' });
		expect(seen[0].url).toBe(
			'https://opencode.ai/inference/go/v1/models/gemini-4-argon-contributor:streamGenerateContent?alt=sse'
		);
		expect(seen[0].headers).toMatchObject({ 'x-goog-api-key': 'k', Authorization: 'Bearer k' });
		const body = sent();
		expect(body.systemInstruction).toEqual({ parts: [{ text: 'You help with notes.' }] });
		expect(body.tools).toEqual([
			{
				functionDeclarations: [
					{
						name: 'read_note',
						description: 'Read a note',
						parameters: {
							type: 'object',
							properties: { id: { type: 'string', description: 'Note id' } },
							required: ['id']
						}
					}
				]
			}
		]);
	});
});

describe('a history trimmed to fit', () => {
	it('opens with a user turn where the API needs one', () => {
		const trimmed: ChatMessage[] = [
			{ role: 'system', content: 'S' },
			{ role: 'assistant', content: 'Earlier answer.' },
			{ role: 'user', content: 'Next?' }
		];
		expect(toMessages(trimmed).messages[0]).toEqual({
			role: 'user',
			content: [{ type: 'text', text: TRIMMED }]
		});
		expect(toContents(trimmed).contents[0]).toEqual({ role: 'user', parts: [{ text: TRIMMED }] });
		// The Responses API takes any order.
		expect(toInput(trimmed).input[0]).toEqual({ role: 'assistant', content: 'Earlier answer.' });
	});
});

describe('routing by API', () => {
	const chatReply = sse({ choices: [{ delta: { content: 'via chat' } }] });

	it('sends a model to the API it is served over', async () => {
		const { http, seen } = host(
			sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } })
		);
		const res = await chatCompletion(http, {
			profile: { ...opencode, api: 'messages' },
			apiKey: 'k',
			messages: [{ role: 'user', content: 'hi' }]
		});
		expect(res.content).toBe('hi');
		expect(seen.map((r) => r.url)).toEqual(['https://opencode.ai/inference/go/v1/messages']);
	});

	it('falls back to chat completions when the native API is refused, and remembers', async () => {
		const urls: string[] = [];
		const http: Http = {
			httpFetch: async () => ({ status: 500, headers: {}, body: '' }),
			httpStream: async (_id, req, onChunk) => {
				urls.push(req.url);
				if (req.url.endsWith('/responses'))
					return { status: 404, headers: {}, body: '{"error":{"message":"Not found"}}' };
				onChunk(chatReply);
				return { status: 200, headers: {}, body: '' };
			}
		};
		const req = {
			profile: { ...opencode, model: 'odd-model', api: 'responses' as const },
			apiKey: 'k',
			messages: [{ role: 'user' as const, content: 'hi' }]
		};
		expect((await chatCompletion(http, req)).content).toBe('via chat');
		expect((await chatCompletion(http, req)).content).toBe('via chat');
		expect(urls).toEqual([
			'https://opencode.ai/inference/go/v1/responses',
			'https://opencode.ai/inference/go/v1/chat/completions',
			'https://opencode.ai/inference/go/v1/chat/completions'
		]);
	});

	it('does not fall back on a refused key', async () => {
		const { http, seen } = host('{"error":{"message":"Missing API key."}}', 401);
		await expect(
			chatCompletion(http, {
				profile: { ...opencode, model: 'gemini-x', api: 'gemini' },
				apiKey: null,
				messages: [{ role: 'user', content: 'hi' }]
			})
		).rejects.toThrow('401: Missing API key.');
		expect(seen).toHaveLength(1);
	});
});
