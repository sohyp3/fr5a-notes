import { createSseParser } from './sse';
import { readUsage, type Usage } from './usage';
import {
	isOpenRouter,
	isOpencode,
	type ChatMessage,
	type Http,
	type ModelInfo,
	type ProviderProfile,
	type ToolCall,
	type ToolDef
} from './types';

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
	/** Tokens (and cost, if the provider says) — null when the provider didn't report. */
	usage: Usage | null;
}

export interface CompletionRequest {
	profile: ProviderProfile;
	apiKey: string | null;
	messages: ChatMessage[];
	tools?: ToolDef[];
	/** Each text delta as it arrives (once, whole, on non-streaming hosts). */
	onDelta?: (text: string) => void;
	signal?: AbortSignal;
	/** A stable id for the chat (OpenCode routes and caches by it; Go refuses requests without). */
	session?: string;
	/** Names the app, e.g. `fr5a/1.2.0`, where the provider asks clients to (OpenCode). */
	client?: string;
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
	let usage: Usage | null = null;
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
			let obj: { choices?: unknown[]; error?: { message?: string }; usage?: unknown };
			try {
				obj = JSON.parse(json);
			} catch {
				return;
			}
			if (obj.error) throw new ProviderError(obj.error.message ?? 'Provider error');
			for (const c of obj.choices ?? []) choice(c as Parameters<typeof choice>[0]);
			// Streams report usage once, in the last chunk; some repeat a running total.
			const u = readUsage(obj.usage);
			if (u) usage = u;
		},
		result(): CompletionResult {
			return {
				content,
				toolCalls: calls
					.filter((c) => c && c.name)
					.map((c, i) => ({ ...c, id: c.id || `call_${i}` })),
				finishReason,
				usage
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

type ModelRow = {
	id?: unknown;
	name?: unknown;
	context_length?: unknown;
	supported_parameters?: unknown;
	pricing?: { prompt?: unknown; completion?: unknown };
};

/** USD per token as text (OpenRouter's `pricing`) → per 1M tokens; null when absent or variable (-1). */
function perMillion(v: unknown): number | null {
	const n = typeof v === 'string' ? Number(v) : v;
	return typeof n === 'number' && Number.isFinite(n) && n >= 0
		? Number((n * 1e6).toFixed(6))
		: null;
}

/** What a `/models` row says beyond the id (OpenRouter lists names, context, tools and prices). */
function modelInfo(id: string, r: ModelRow): ModelInfo {
	const out: ModelInfo = { id };
	if (typeof r.name === 'string' && r.name && r.name !== id) out.name = r.name;
	if (typeof r.context_length === 'number' && r.context_length > 0) out.context = r.context_length;
	if (Array.isArray(r.supported_parameters)) out.tools = r.supported_parameters.includes('tools');
	const input = perMillion(r.pricing?.prompt);
	const output = perMillion(r.pricing?.completion);
	if (input !== null && output !== null) out.price = { input, output };
	return out;
}

/** Chat models from an OpenAI-compatible `GET /models`, sorted by id. */
export async function listModels(
	http: Http,
	profile: Pick<ProviderProfile, 'baseUrl'>,
	apiKey: string | null
): Promise<ModelInfo[]> {
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
	let rows: ModelRow[];
	try {
		const j = JSON.parse(res.body);
		rows = j?.data ?? j?.models ?? [];
	} catch {
		throw new ProviderError('The provider returned a model list that is not JSON.');
	}
	const out = new Map<string, ModelInfo>();
	for (const r of Array.isArray(rows) ? rows : []) {
		const id = typeof r?.id === 'string' && r.id ? r.id : typeof r?.name === 'string' ? r.name : '';
		if (id && !NOT_CHAT.test(id) && !out.has(id)) out.set(id, modelInfo(id, r));
	}
	return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Headers a provider asks for beyond the key: OpenCode wants the chat's id and the client named. */
export function providerHeaders(
	baseUrl: string,
	req: Pick<CompletionRequest, 'session' | 'client'>
): Record<string, string> {
	if (!isOpencode(baseUrl)) return {};
	return {
		...(req.session ? { 'x-opencode-session': req.session } : {}),
		...(req.client ? { 'User-Agent': req.client } : {})
	};
}

let seq = 0;
/** Endpoints that refused `stream_options`: asked without it from then on. */
const noStreamOptions = new Set<string>();

export async function chatCompletion(
	http: Http,
	req: CompletionRequest
): Promise<CompletionResult> {
	const url = completionsUrl(req.profile.baseUrl);
	try {
		return await complete(http, req, !noStreamOptions.has(url));
	} catch (err) {
		// A strict server rejecting the usage request: retry once without it.
		if (!(err instanceof ProviderError) || !/stream_options/i.test(err.message)) throw err;
		if (noStreamOptions.has(url)) throw err;
		noStreamOptions.add(url);
		return complete(http, req, false);
	}
}

async function complete(
	http: Http,
	req: CompletionRequest,
	askUsage: boolean
): Promise<CompletionResult> {
	const { profile } = req;
	if (req.signal?.aborted) throw new AbortError();
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'text/event-stream',
		...providerHeaders(profile.baseUrl, req)
	};
	if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`;
	const body: Record<string, unknown> = {
		model: profile.model,
		messages: wireMessages(req.messages),
		stream: true
	};
	// Token counts in the last chunk; OpenRouter also puts the cost in it.
	if (askUsage) body.stream_options = { include_usage: true };
	if (isOpenRouter(profile.baseUrl)) body.usage = { include: true };
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
