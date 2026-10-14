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
 * Client for the Gemini API (`POST {base}/models/{model}:streamGenerateContent`),
 * which OpenCode serves its Gemini models over. The chat history stays in
 * the OpenAI shape; it's converted here. Gemini 3 wants each tool call's
 * thought signature back with it, so the parser keeps it on the call.
 */

/**
 * Google's documented stand-in signature for calls it didn't make (an
 * earlier model in the chat): skips the check instead of failing the request.
 */
export const SKIP_SIGNATURE = 'skip_thought_signature_validator';

type Part = {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
	functionResponse?: { name: string; response: { output: string } };
};

export interface Content {
	role: 'user' | 'model';
	parts: Part[];
}

/** System text apart; tool results as user parts named after their call; neighbours of one role merged. */
export function toContents(messages: ChatMessage[]): { system: string; contents: Content[] } {
	const system: string[] = [];
	const contents: Content[] = [];
	const names = new Map<string, string>();
	const add = (role: Content['role'], parts: Part[]) => {
		if (!parts.length) return;
		const last = contents[contents.length - 1];
		if (last?.role === role) last.parts.push(...parts);
		else contents.push({ role, parts });
	};
	for (const m of messages) {
		if (m.role === 'system') system.push(m.content);
		else if (m.role === 'user') add('user', m.content.trim() ? [{ text: m.content }] : []);
		else if (m.role === 'assistant') {
			const calls = m.tool_calls ?? [];
			for (const c of calls) names.set(c.id, c.name);
			// Gemini's own calls carry their signatures (on the first of parallel ones).
			const foreign = calls.length > 0 && !calls.some((c) => c.signature);
			add('model', [
				...(m.content?.trim() ? [{ text: m.content }] : []),
				...calls.map((c, i) => {
					const signature = c.signature ?? (foreign && i === 0 ? SKIP_SIGNATURE : undefined);
					return {
						functionCall: { name: c.name, args: argsObject(c.arguments) },
						...(signature ? { thoughtSignature: signature } : {})
					};
				})
			]);
		} else if (m.role === 'tool')
			add('user', [
				{
					functionResponse: {
						name: names.get(m.tool_call_id) ?? 'tool',
						response: { output: m.content || '(empty)' }
					}
				}
			]);
	}
	if (contents[0]?.role === 'model') contents.unshift({ role: 'user', parts: [{ text: TRIMMED }] });
	return { system: system.join('\n\n'), contents };
}

/** Keys of the OpenAPI subset Gemini's function declarations accept. */
const SCHEMA_KEYS = new Set([
	'type',
	'format',
	'description',
	'nullable',
	'enum',
	'minimum',
	'maximum',
	'minItems',
	'maxItems',
	'minLength',
	'maxLength',
	'pattern',
	'required'
]);

/** A JSON schema cut down to what Gemini takes (no `additionalProperties`, `$schema`…). */
export function geminiSchema(schema: unknown): unknown {
	if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(schema)) {
		if (k === 'properties' && v && typeof v === 'object')
			out.properties = Object.fromEntries(
				Object.entries(v).map(([name, s]) => [name, geminiSchema(s)])
			);
		else if (k === 'items') out.items = geminiSchema(v);
		else if (k === 'anyOf' && Array.isArray(v)) out.anyOf = v.map(geminiSchema);
		else if (SCHEMA_KEYS.has(k)) out[k] = v;
	}
	return out;
}

const FINISH: Record<string, string> = { STOP: 'stop', MAX_TOKENS: 'length' };

/** Merges streamed `GenerateContentResponse` chunks (or one whole response). */
export function createGeminiAccumulator(onDelta?: (text: string) => void) {
	let content = '';
	let finish: string | null = null;
	let usage: Usage | null = null;
	const calls: ToolCall[] = [];

	type Chunk = {
		candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
		usageMetadata?: {
			promptTokenCount?: number;
			candidatesTokenCount?: number;
			thoughtsTokenCount?: number;
		};
		promptFeedback?: { blockReason?: string };
		error?: { message?: string };
	};

	return {
		push(json: string) {
			let c: Chunk;
			try {
				c = JSON.parse(json);
			} catch {
				return;
			}
			if (c.error) throw new ProviderError(c.error.message ?? 'Provider error');
			// A prompt refused outright: the loop reports it as a content filter.
			if (c.promptFeedback?.blockReason) finish = c.promptFeedback.blockReason;
			const cand = c.candidates?.[0];
			for (const p of cand?.content?.parts ?? []) {
				if (p.thought) continue;
				if (p.functionCall?.name)
					calls.push({
						id: p.functionCall.id || `call_${calls.length}`,
						name: p.functionCall.name,
						arguments: JSON.stringify(p.functionCall.args ?? {}),
						...(p.thoughtSignature ? { signature: p.thoughtSignature } : {})
					});
				else if (p.text) {
					content += p.text;
					onDelta?.(p.text);
				}
			}
			if (cand?.finishReason) finish = FINISH[cand.finishReason] ?? cand.finishReason;
			const u = c.usageMetadata;
			// Running totals; thinking is billed as output.
			if (u)
				usage = {
					input: u.promptTokenCount ?? 0,
					output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)
				};
		},
		result(): CompletionResult {
			return {
				content,
				toolCalls: [...calls],
				finishReason: calls.length ? 'tool_calls' : finish,
				usage
			};
		}
	};
}

export async function geminiCompletion(
	http: Http,
	req: CompletionRequest
): Promise<CompletionResult> {
	const { profile } = req;
	const { system, contents } = toContents(req.messages);
	const body: Record<string, unknown> = { contents };
	if (system) body.systemInstruction = { parts: [{ text: system }] };
	if (req.tools?.length && profile.tools)
		body.tools = [
			{
				functionDeclarations: req.tools.map((t) => ({
					name: t.name,
					description: t.description,
					parameters: geminiSchema(t.parameters)
				}))
			}
		];
	const headers = providerHeaders(profile.baseUrl, req);
	if (req.apiKey) {
		headers['x-goog-api-key'] = req.apiKey;
		headers.Authorization = `Bearer ${req.apiKey}`;
	}
	const model = encodeURIComponent(profile.model.replace(/^models\//, ''));
	const url = `${apiBase(profile.baseUrl)}/models/${model}:streamGenerateContent?alt=sse`;
	const acc = createGeminiAccumulator(req.onDelta);
	await postStream(http, req, { url, headers, body }, acc.push);
	return acc.result();
}
