import { fitHistory } from './context';
import { AbortError, ProviderError, type CompletionRequest, type CompletionResult } from './openai';
import type { Tool } from './tools';
import type { ChatMessage, ProviderProfile, ToolCall } from './types';

/**
 * The agent loop: model → tool calls → results → model, until the model
 * answers without tools or `maxSteps` runs out. Everything is on-device; the
 * only thing that leaves is each completion request.
 */

export interface LoopEvents {
	/** Streamed assistant text. */
	onDelta?(text: string): void;
	/** A finished assistant message (text may be empty when it only calls tools). */
	onAssistant?(content: string, calls: ToolCall[]): void;
	onToolStart?(call: ToolCall): void;
	onToolResult?(call: ToolCall, result: string): void;
}

export interface LoopOptions extends LoopEvents {
	profile: ProviderProfile;
	/** Full conversation so far, starting with the system message. Appended to in place. */
	messages: ChatMessage[];
	tools: Tool[];
	maxSteps: number;
	signal?: AbortSignal;
	/** The model call (chatCompletion bound to http + key). */
	complete(req: Omit<CompletionRequest, 'profile' | 'apiKey'>): Promise<CompletionResult>;
}

/** Room left for the reply when trimming history. */
const REPLY_RESERVE = 2048;
/** Finish reasons of a reply the provider's content filter stopped (OpenAI, GLM, Gemini…). */
const FILTERED = /content_filter|sensitive|safety|prohibited|blocklist/i;

/**
 * `p`, or an AbortError as soon as `signal` fires. A request that can't be
 * cancelled (Android's buffered HTTP, a web search) is left to finish unseen,
 * so Stop always ends the run at once.
 */
export function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return p;
	return new Promise<T>((resolve, reject) => {
		const stop = () => reject(new AbortError());
		signal.addEventListener('abort', stop, { once: true });
		if (signal.aborted) stop();
		p.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
	});
}

/**
 * Tool calls of the last step still without a result: the run broke off
 * mid-step. Carrying on runs them first; a new user message closes them.
 */
export function pendingCalls(messages: ChatMessage[]): ToolCall[] {
	const done = new Set<string>();
	let i = messages.length - 1;
	for (; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== 'tool') break;
		done.add(m.tool_call_id);
	}
	const m = messages[i];
	return m?.role === 'assistant' ? (m.tool_calls ?? []).filter((c) => !done.has(c.id)) : [];
}

/** The history with every pending call answered, so a new user message may follow. */
export function closeCalls(messages: ChatMessage[], note = '(cancelled)'): ChatMessage[] {
	const open = pendingCalls(messages);
	return open.length
		? [
				...messages,
				...open.map((c): ChatMessage => ({ role: 'tool', tool_call_id: c.id, content: note }))
			]
		: messages;
}

export async function runLoop(o: LoopOptions): Promise<'done' | 'max-steps'> {
	const byName = new Map(o.tools.map((t) => [t.def.name, t]));
	const defs = o.profile.tools ? o.tools.map((t) => t.def) : [];

	const runCalls = async (calls: ToolCall[]) => {
		for (const call of calls) {
			if (o.signal?.aborted) throw new AbortError();
			o.onToolStart?.(call);
			let result: string;
			const tool = byName.get(call.name);
			if (!tool) result = `Unknown tool "${call.name}".`;
			else {
				let args: Record<string, unknown> = {};
				try {
					args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
				} catch {
					result = `Invalid JSON arguments: ${call.arguments.slice(0, 200)}`;
				}
				try {
					result ??= await abortable(tool.run(args), o.signal);
				} catch (err) {
					if (err instanceof AbortError) throw err;
					result = `Error: ${err instanceof Error ? err.message : String(err)}`;
				}
			}
			o.messages.push({ role: 'tool', tool_call_id: call.id, content: result });
			o.onToolResult?.(call, result);
		}
	};

	// Carrying on a run that broke off mid-step: finish that step first.
	await runCalls(pendingCalls(o.messages));
	for (let step = 0; step < o.maxSteps; step++) {
		if (o.signal?.aborted) throw new AbortError();
		const budget = Math.max(1024, o.profile.contextTokens - REPLY_RESERVE);
		const res = await abortable(
			o.complete({
				messages: fitHistory(o.messages, budget),
				tools: defs,
				onDelta: o.onDelta,
				signal: o.signal
			}),
			o.signal
		);
		if (!res.toolCalls.length && FILTERED.test(res.finishReason ?? ''))
			throw new ProviderError(
				`The provider's content filter stopped the reply (${res.finishReason}).`
			);
		o.messages.push({
			role: 'assistant',
			content: res.content || null,
			...(res.toolCalls.length ? { tool_calls: res.toolCalls } : {})
		});
		o.onAssistant?.(res.content, res.toolCalls);
		if (!res.toolCalls.length) return 'done';
		await runCalls(res.toolCalls);
	}
	return 'max-steps';
}
