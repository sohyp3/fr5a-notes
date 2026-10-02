import { createSseParser } from './sse';
import type { ChatMessage, Http, ProviderProfile, ToolCall, ToolDef } from './types';

/**
 * Client for OpenAI-compatible `/chat/completions`. Always asks for a stream;
 * hosts that can't stream (Android) hand back the buffered SSE body, which is
 * parsed the same way. A plain JSON completion (servers that ignore `stream`)
 * is accepted too.
 */

export interface CompletionResult {
	content: string;
	toolCalls: ToolCall[];
	finishReason: string | null;
}

export interface CompletionRequest {
	profile: ProviderProfile;
	apiKey: string | null;
	messages: ChatMessage[];
	tools?: ToolDef[];
	/** Each text delta as it arrives (once, whole, on non-streaming hosts). */
	onDelta?: (text: string) => void;
	signal?: AbortSignal;
}

export class ProviderError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
	}
}

export class AbortError extends Error {
	constructor() {
		super('Stopped');
	}
}

export function completionsUrl(baseUrl: string): string {
	const base = baseUrl.trim().replace(/\/+$/, '');
	return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function wireMessages(messages: ChatMessage[]): unknown[] {
	return messages.map((m) =>
		m.role === 'assistant' && m.tool_calls?.length
			? {
					role: 'assistant',
					content: m.content,
					tool_calls: m.tool_calls.map((c) => ({
						id: c.id,
						type: 'function',
						function: { name: c.name, arguments: c.arguments }
					}))
				}
			: m
	);
}

/** Merges streamed deltas (text + tool-call fragments keyed by index). */
export function createAccumulator(onDelta?: (text: string) => void) {
	let content = '';
	let finishReason: string | null = null;
	const calls: { id: string; name: string; arguments: string }[] = [];

	type Delta = {
		content?: string | null;
		tool_calls?: {
			index?: number;
			id?: string;
			function?: { name?: string; arguments?: string };
		}[];
	};

	function choice(c: { delta?: Delta; message?: Delta; finish_reason?: string | null }) {
		const d = c.delta ?? c.message ?? {};
		if (d.content) {
			content += d.content;
			onDelta?.(d.content);
		}
		for (const [i, tc] of (d.tool_calls ?? []).entries()) {
			const idx = tc.index ?? i;
			const slot = (calls[idx] ??= { id: '', name: '', arguments: '' });
			if (tc.id) slot.id = tc.id;
			if (tc.function?.name) slot.name += tc.function.name;
			if (tc.function?.arguments) slot.arguments += tc.function.arguments;
		}
		if (c.finish_reason) finishReason = c.finish_reason;
	}

	return {
		/** One SSE `data:` payload, or a whole non-streamed JSON completion. */
		push(json: string) {
			if (json === '[DONE]') return;
			let obj: { choices?: unknown[]; error?: { message?: string } };
			try {
				obj = JSON.parse(json);
			} catch {
				return;
			}
			if (obj.error) throw new ProviderError(obj.error.message ?? 'Provider error');
			for (const c of obj.choices ?? []) choice(c as Parameters<typeof choice>[0]);
		},
		result(): CompletionResult {
			return {
				content,
				toolCalls: calls
					.filter((c) => c && c.name)
					.map((c, i) => ({ ...c, id: c.id || `call_${i}` })),
				finishReason
			};
		}
	};
}

function errorMessage(status: number, body: string): string {
	try {
		const j = JSON.parse(body);
		const msg = j?.error?.message ?? j?.message ?? j?.detail;
		if (typeof msg === 'string') return `${status}: ${msg}`;
	} catch {
		/* not JSON */
	}
	return `${status}: ${body.slice(0, 300) || 'request failed'}`;
}

/** Ids that aren't chat models (OpenAI lists embeddings, audio, images… too). */
const NOT_CHAT =
	/embed|tts|whisper|dall-e|gpt-image|image|audio|moderation|realtime|transcribe|davinci|babbage|search|computer-use/i;

/** Chat model ids from an OpenAI-compatible `GET /models`, sorted. */
export async function listModels(
	http: Http,
	profile: Pick<ProviderProfile, 'baseUrl'>,
	apiKey: string | null
): Promise<string[]> {
	const base = profile.baseUrl
		.trim()
		.replace(/\/+$/, '')
		.replace(/\/chat\/completions$/, '');
	const res = await http.httpFetch({
		url: `${base}/models`,
		headers: {
			Accept: 'application/json',
			...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
		},
		timeoutMs: 20_000
	});
	if (res.status < 200 || res.status >= 300)
		throw new ProviderError(errorMessage(res.status, res.body), res.status);
	let rows: { id?: string; name?: string }[];
	try {
		const j = JSON.parse(res.body);
		rows = j?.data ?? j?.models ?? [];
	} catch {
		throw new ProviderError('The provider returned a model list that is not JSON.');
	}
	const ids = rows.map((r) => r.id ?? r.name ?? '').filter(Boolean);
	return [...new Set(ids.filter((id) => !NOT_CHAT.test(id)))].sort();
}

let seq = 0;

export async function chatCompletion(
	http: Http,
	req: CompletionRequest
): Promise<CompletionResult> {
	const { profile } = req;
	if (req.signal?.aborted) throw new AbortError();
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'text/event-stream'
	};
	if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`;
	const body: Record<string, unknown> = {
		model: profile.model,
		messages: wireMessages(req.messages),
		stream: true
	};
	if (req.tools?.length && profile.tools) {
		body.tools = req.tools.map((t) => ({ type: 'function', function: t }));
	}
	const httpReq = {
		url: completionsUrl(profile.baseUrl),
		method: 'POST' as const,
		headers,
		body: JSON.stringify(body),
		timeoutMs: 300_000
	};

	const acc = createAccumulator(req.onDelta);
	let parseErr: unknown = null;
	const sse = createSseParser((data) => {
		try {
			acc.push(data);
		} catch (err) {
			parseErr ??= err;
		}
	});

	const id = `llm-${Date.now()}-${seq++}`;
	const onAbort = () => void http.httpAbort?.(id);
	req.signal?.addEventListener('abort', onAbort);
	let res;
	try {
		res = http.httpStream
			? await http.httpStream(id, httpReq, (t) => sse.feed(t))
			: await http.httpFetch(httpReq);
	} catch (err) {
		if (req.signal?.aborted) throw new AbortError();
		throw new ProviderError(err instanceof Error ? err.message : String(err));
	} finally {
		req.signal?.removeEventListener('abort', onAbort);
	}
	if (req.signal?.aborted) throw new AbortError();
	if (res.status < 200 || res.status >= 300)
		throw new ProviderError(errorMessage(res.status, res.body), res.status);

	const rest = res.body.trim();
	if (rest.startsWith('{')) acc.push(rest);
	else if (rest) sse.feed(res.body);
	sse.end();
	if (parseErr) throw parseErr;
	return acc.result();
}
