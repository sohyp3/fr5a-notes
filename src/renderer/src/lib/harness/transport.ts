import { createSseParser } from './sse';
import type { Usage } from './usage';
import {
	isOpencode,
	type ChatMessage,
	type Http,
	type ProviderProfile,
	type ToolCall,
	type ToolDef
} from './types';

/**
 * What every model API client shares: the request / result shapes, errors,
 * and one streamed POST. Hosts that can't stream (Android) hand back the
 * buffered SSE body, which is parsed the same way; a plain JSON body (servers
 * that ignore `stream`) is accepted too.
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

/** The base URL without its end slash or a pasted `/chat/completions`. */
export function apiBase(baseUrl: string): string {
	return baseUrl
		.trim()
		.replace(/\/+$/, '')
		.replace(/\/chat\/completions$/, '');
}

export function errorMessage(status: number, body: string): string {
	try {
		const j = JSON.parse(body);
		const e = Array.isArray(j) ? j[0] : j;
		const msg = e?.error?.message ?? e?.message ?? e?.detail;
		if (typeof msg === 'string') return `${status}: ${msg}`;
	} catch {
		/* not JSON */
	}
	return `${status}: ${body.slice(0, 300) || 'request failed'}`;
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

/** Opens a history trimmed to fit that starts with a model turn (Messages and Gemini want a user turn first). */
export const TRIMMED = '(Earlier messages were left out to fit the context.)';

/** A tool call's JSON arguments as an object (the Messages and Gemini APIs want one). */
export function argsObject(json: string): Record<string, unknown> {
	try {
		const v = JSON.parse(json || '{}');
		return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
	} catch {
		return {};
	}
}

let seq = 0;

/**
 * POST `body` and hand each SSE `data:` payload (or the whole JSON body, or
 * each element of a JSON array body) to `push`. A non-2xx status throws the
 * provider's message; so does whatever `push` throws.
 */
export async function postStream(
	http: Http,
	req: Pick<CompletionRequest, 'signal'>,
	target: { url: string; headers: Record<string, string>; body: unknown },
	push: (data: string) => void
): Promise<void> {
	if (req.signal?.aborted) throw new AbortError();
	const httpReq = {
		url: target.url,
		method: 'POST' as const,
		headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...target.headers },
		body: JSON.stringify(target.body),
		timeoutMs: 300_000
	};

	let parseErr: unknown = null;
	const sse = createSseParser((data) => {
		try {
			push(data);
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
	if (rest.startsWith('{')) push(rest);
	else if (rest.startsWith('[')) {
		let items: unknown = null;
		try {
			items = JSON.parse(rest);
		} catch {
			/* an SSE body after all */
		}
		if (Array.isArray(items)) for (const item of items) push(JSON.stringify(item));
		else sse.feed(res.body);
	} else if (rest) sse.feed(res.body);
	sse.end();
	if (parseErr) throw parseErr;
}
