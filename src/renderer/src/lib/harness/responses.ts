import {
	ProviderError,
	apiBase,
	postStream,
	providerHeaders,
	type CompletionRequest,
	type CompletionResult
} from './transport';
import type { ChatMessage, Http, ToolCall } from './types';
import type { Usage } from './usage';

/**
 * Client for the OpenAI Responses API (`POST {base}/responses`), which
 * OpenCode serves its GPT models over. Stateless (`store: false`): the
 * whole history goes with each request, converted from the chat shape.
 */

/** System text as `instructions`; tool calls and results as their own items. */
export function toInput(messages: ChatMessage[]): { instructions: string; input: unknown[] } {
	const instructions: string[] = [];
	const input: unknown[] = [];
	for (const m of messages) {
		if (m.role === 'system') instructions.push(m.content);
		else if (m.role === 'user') {
			if (m.content.trim()) input.push({ role: 'user', content: m.content });
		} else if (m.role === 'assistant') {
			if (m.content?.trim()) input.push({ role: 'assistant', content: m.content });
			for (const c of m.tool_calls ?? [])
				input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.arguments });
		} else if (m.role === 'tool')
			input.push({
				type: 'function_call_output',
				call_id: m.tool_call_id,
				output: m.content || '(empty)'
			});
	}
	return { instructions: instructions.join('\n\n'), input };
}

type Item = {
	type?: string;
	call_id?: string;
	name?: string;
	arguments?: string;
	content?: { type?: string; text?: string; refusal?: string }[];
};

type Response = {
	status?: string;
	output?: Item[];
	usage?: { input_tokens?: number; output_tokens?: number };
	incomplete_details?: { reason?: string };
	error?: { message?: string };
};

/** Merges the event stream (`response.output_text.delta` … `response.completed`) or a whole response. */
export function createResponsesAccumulator(onDelta?: (text: string) => void) {
	let content = '';
	let streamed = false;
	let finish: string | null = null;
	let usage: Usage | null = null;
	/** By output index. */
	const calls = new Map<number, ToolCall>();

	const text = (t: unknown) => {
		if (typeof t !== 'string' || !t) return;
		content += t;
		onDelta?.(t);
	};
	const call = (i: number, item: Item) =>
		calls.set(i, {
			id: item.call_id ?? calls.get(i)?.id ?? '',
			name: item.name ?? calls.get(i)?.name ?? '',
			arguments: item.arguments ?? calls.get(i)?.arguments ?? ''
		});
	/** A finished response: usage, why it stopped, and what wasn't streamed. */
	const done = (r: Response | undefined) => {
		if (!r) return;
		if (r.usage) usage = { input: r.usage.input_tokens ?? 0, output: r.usage.output_tokens ?? 0 };
		if (r.status === 'incomplete')
			finish = r.incomplete_details?.reason === 'content_filter' ? 'content_filter' : 'length';
		else if (r.status) finish = 'stop';
		for (const [i, item] of (r.output ?? []).entries()) {
			if (item.type === 'function_call' && !calls.has(i)) call(i, item);
			if (item.type === 'message' && !streamed)
				for (const part of item.content ?? []) text(part.text ?? part.refusal);
		}
	};

	type Event = {
		type?: string;
		delta?: string;
		output_index?: number;
		item?: Item;
		response?: Response;
		message?: string;
		error?: { message?: string };
		object?: string;
	} & Response;

	return {
		push(json: string) {
			let e: Event;
			try {
				e = JSON.parse(json);
			} catch {
				return;
			}
			switch (e.type) {
				case 'response.output_text.delta':
				case 'response.refusal.delta':
					streamed = true;
					text(e.delta);
					break;
				case 'response.output_item.added':
				case 'response.output_item.done':
					if (e.item?.type === 'function_call') call(e.output_index ?? calls.size, e.item);
					break;
				case 'response.function_call_arguments.delta': {
					const c = calls.get(e.output_index ?? -1);
					if (c) c.arguments += e.delta ?? '';
					break;
				}
				case 'response.completed':
				case 'response.incomplete':
					done(e.response);
					break;
				case 'response.failed':
					throw new ProviderError(e.response?.error?.message ?? 'The response failed.');
				case 'error':
					throw new ProviderError(e.message ?? e.error?.message ?? 'Provider error');
				default:
					// Not streamed: the whole response at once.
					if (e.object === 'response') done(e);
			}
		},
		result(): CompletionResult {
			const toolCalls = [...calls.entries()]
				.sort(([a], [b]) => a - b)
				.map(([, c], i) => ({ ...c, id: c.id || `call_${i}` }))
				.filter((c) => c.name);
			return {
				content,
				toolCalls,
				finishReason: toolCalls.length ? 'tool_calls' : finish,
				usage
			};
		}
	};
}

export async function responsesCompletion(
	http: Http,
	req: CompletionRequest
): Promise<CompletionResult> {
	const { profile } = req;
	const { instructions, input } = toInput(req.messages);
	const body: Record<string, unknown> = { model: profile.model, input, stream: true, store: false };
	if (instructions) body.instructions = instructions;
	// Not strict: strict schemas would need every property required and no extras.
	if (req.tools?.length && profile.tools)
		body.tools = req.tools.map((t) => ({
			type: 'function',
			name: t.name,
			description: t.description,
			parameters: t.parameters,
			strict: false
		}));
	const headers = providerHeaders(profile.baseUrl, req);
	if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`;
	const acc = createResponsesAccumulator(req.onDelta);
	await postStream(
		http,
		req,
		{ url: `${apiBase(profile.baseUrl)}/responses`, headers, body },
		acc.push
	);
	return acc.result();
}
