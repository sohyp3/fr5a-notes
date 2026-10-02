import { fitHistory } from './context';
import { AbortError, type CompletionRequest, type CompletionResult } from './openai';
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

export async function runLoop(o: LoopOptions): Promise<'done' | 'max-steps'> {
	const byName = new Map(o.tools.map((t) => [t.def.name, t]));
	const defs = o.profile.tools ? o.tools.map((t) => t.def) : [];
	for (let step = 0; step < o.maxSteps; step++) {
		if (o.signal?.aborted) throw new AbortError();
		const budget = Math.max(1024, o.profile.contextTokens - REPLY_RESERVE);
		const res = await o.complete({
			messages: fitHistory(o.messages, budget),
			tools: defs,
			onDelta: o.onDelta,
			signal: o.signal
		});
		o.messages.push({
			role: 'assistant',
			content: res.content || null,
			...(res.toolCalls.length ? { tool_calls: res.toolCalls } : {})
		});
		o.onAssistant?.(res.content, res.toolCalls);
		if (!res.toolCalls.length) return 'done';

		for (const call of res.toolCalls) {
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
					result ??= await tool.run(args);
				} catch (err) {
					if (err instanceof AbortError) throw err;
					result = `Error: ${err instanceof Error ? err.message : String(err)}`;
				}
			}
			o.messages.push({ role: 'tool', tool_call_id: call.id, content: result });
			o.onToolResult?.(call, result);
		}
	}
	return 'max-steps';
}
