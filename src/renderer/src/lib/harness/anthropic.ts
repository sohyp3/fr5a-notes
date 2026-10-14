import {
	ProviderError,
	apiBase,
	argsObject,
	TRIMMED,
	postStream,
	providerHeaders,
	type CompletionRequest,
	type CompletionResult
} from './transport';
import type { ChatMessage, Http, ToolCall } from './types';
import type { Usage } from './usage';

/**
 * Client for the Anthropic Messages API (`POST {base}/messages`), which
 * OpenCode serves its Claude models over (and on Go some Qwen / MiniMax
 * ones). The chat history stays in the OpenAI shape; it's converted here.
 */

/** Messages needs a reply budget; long notes fit, and it stays well under every context. */
const MAX_REPLY = 16_384;
const DEFAULT_REPLY = 8_192;

type Block = (
	| { type: 'text'; text: string }
	| { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
	| { type: 'tool_result'; tool_use_id: string; content: string }
) & { cache_control?: { type: 'ephemeral' } };

export interface WireMessage {
	role: 'user' | 'assistant';
	content: Block[];
}

/** Tool ids from other providers may hold characters Messages refuses. */
export const toolId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'call';

/** System text apart; tool results as user turns; neighbours of one role merged. */
export function toMessages(messages: ChatMessage[]): { system: string; messages: WireMessage[] } {
	const system: string[] = [];
	const out: WireMessage[] = [];
	const add = (role: WireMessage['role'], blocks: Block[]) => {
		if (!blocks.length) return;
		const last = out[out.length - 1];
		if (last?.role === role) last.content.push(...blocks);
		else out.push({ role, content: blocks });
	};
	for (const m of messages) {
		if (m.role === 'system') system.push(m.content);
		else if (m.role === 'user')
			add('user', m.content.trim() ? [{ type: 'text', text: m.content }] : []);
		else if (m.role === 'assistant')
			add('assistant', [
				...(m.content?.trim() ? [{ type: 'text' as const, text: m.content }] : []),
				...(m.tool_calls ?? []).map((c) => ({
					type: 'tool_use' as const,
					id: toolId(c.id),
					name: c.name,
					input: argsObject(c.arguments)
				}))
			]);
		else if (m.role === 'tool')
			add('user', [
				{
					type: 'tool_result',
					tool_use_id: toolId(m.tool_call_id),
					content: m.content || '(empty)'
				}
			]);
	}
	if (out[0]?.role === 'assistant')
		out.unshift({ role: 'user', content: [{ type: 'text', text: TRIMMED }] });
	return { system: system.join('\n\n'), messages: out };
}

const STOP: Record<string, string> = {
	end_turn: 'stop',
	stop_sequence: 'stop',
	max_tokens: 'length',
	tool_use: 'tool_calls',
	refusal: 'content_filter'
};

/** Merges the event stream (`message_start` … `message_stop`) or a whole JSON message. */
export function createMessagesAccumulator(onDelta?: (text: string) => void) {
	let content = '';
	let stop: string | null = null;
	let usage: Usage | null = null;
	/** By content block index. */
	const calls = new Map<number, ToolCall & { input?: unknown }>();

	const n = (v: unknown) => (typeof v === 'number' ? v : 0);
	const readUsage = (u: Record<string, unknown> | undefined, base: Usage | null): Usage | null => {
		if (!u) return base;
		// Every prompt token, cached or not, as the other APIs count them.
		const input =
			u.input_tokens === undefined
				? (base?.input ?? 0)
				: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens);
		const output = u.output_tokens === undefined ? (base?.output ?? 0) : n(u.output_tokens);
		return { input, output };
	};
	const text = (t: unknown) => {
		if (typeof t !== 'string' || !t) return;
		content += t;
		onDelta?.(t);
	};

	type Event = {
		type?: string;
		index?: number;
		message?: { usage?: Record<string, unknown> };
		content_block?: { type?: string; id?: string; name?: string; input?: unknown; text?: string };
		delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
		usage?: Record<string, unknown>;
		error?: { message?: string };
		content?: { type?: string; id?: string; name?: string; input?: unknown; text?: string }[];
		stop_reason?: string;
	};

	return {
		push(json: string) {
			let e: Event;
			try {
				e = JSON.parse(json);
			} catch {
				return;
			}
			switch (e.type) {
				case 'message_start':
					usage = readUsage(e.message?.usage, usage);
					break;
				case 'content_block_start': {
					const b = e.content_block;
					if (b?.type === 'tool_use')
						calls.set(e.index ?? calls.size, {
							id: b.id ?? '',
							name: b.name ?? '',
							arguments: '',
							input: b.input
						});
					else if (b?.type === 'text') text(b.text);
					break;
				}
				case 'content_block_delta': {
					const d = e.delta;
					if (d?.type === 'text_delta') text(d.text);
					else if (d?.type === 'input_json_delta') {
						const call = calls.get(e.index ?? -1);
						if (call) call.arguments += d.partial_json ?? '';
					}
					break;
				}
				case 'message_delta':
					if (e.delta?.stop_reason) stop = e.delta.stop_reason;
					usage = readUsage(e.usage, usage);
					break;
				case 'error':
					throw new ProviderError(e.error?.message ?? 'Provider error');
				case 'message':
					// Not streamed: the whole reply at once.
					for (const [i, b] of (e.content ?? []).entries()) {
						if (b.type === 'text') text(b.text);
						else if (b.type === 'tool_use')
							calls.set(i, { id: b.id ?? '', name: b.name ?? '', arguments: '', input: b.input });
					}
					stop = e.stop_reason ?? stop;
					usage = readUsage(e.usage, usage);
					break;
			}
		},
		result(): CompletionResult {
			const toolCalls = [...calls.entries()]
				.sort(([a], [b]) => a - b)
				.map(([, c], i) => ({
					id: c.id || `call_${i}`,
					name: c.name,
					// No input deltas: the input came whole with the block (often `{}`).
					arguments: c.arguments || JSON.stringify(c.input ?? {})
				}))
				.filter((c) => c.name);
			return {
				content,
				toolCalls,
				finishReason: stop ? (STOP[stop] ?? stop) : null,
				usage
			};
		}
	};
}

export async function messagesCompletion(
	http: Http,
	req: CompletionRequest
): Promise<CompletionResult> {
	const { profile } = req;
	const { system, messages } = toMessages(req.messages);
	// Claude caches the prompt up to a marked block: the system prompt (notes) and the history so far.
	const cache = /^claude/i.test(profile.model);
	if (cache) {
		const lastBlock = messages[messages.length - 1]?.content.at(-1);
		if (lastBlock) lastBlock.cache_control = { type: 'ephemeral' };
	}
	const body: Record<string, unknown> = {
		model: profile.model,
		max_tokens: Math.min(profile.maxOutput ?? DEFAULT_REPLY, MAX_REPLY),
		stream: true,
		messages
	};
	if (system)
		body.system = [
			{ type: 'text', text: system, ...(cache ? { cache_control: { type: 'ephemeral' } } : {}) }
		];
	if (req.tools?.length && profile.tools)
		body.tools = req.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.parameters
		}));
	const headers: Record<string, string> = {
		...providerHeaders(profile.baseUrl, req),
		'anthropic-version': '2023-06-01'
	};
	if (req.apiKey) {
		headers['x-api-key'] = req.apiKey;
		headers.Authorization = `Bearer ${req.apiKey}`;
	}
	const acc = createMessagesAccumulator(req.onDelta);
	await postStream(
		http,
		req,
		{ url: `${apiBase(profile.baseUrl)}/messages`, headers, body },
		acc.push
	);
	return acc.result();
}
