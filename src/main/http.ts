import type { HttpRequest, HttpResponse } from '../shared/types';

/**
 * Outbound HTTP for the AI harness. The renderer's CSP forbids `fetch`, so
 * LLM / search / page requests run here and stream back over IPC. Only
 * http(s) URLs are allowed; each streamed request is abortable by id.
 */

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT = 120_000;

function checkUrl(url: string): void {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:')
		throw new Error(`Only http(s) URLs are allowed: ${url}`);
}

function headersOf(res: Response): Record<string, string> {
	const out: Record<string, string> = {};
	res.headers.forEach((v, k) => (out[k] = v));
	return out;
}

export function createHttp(fetchImpl: Fetch) {
	const inflight = new Map<string, AbortController>();

	async function run(
		req: HttpRequest,
		ctl: AbortController,
		onChunk?: (text: string) => void
	): Promise<HttpResponse> {
		checkUrl(req.url);
		const timer = setTimeout(() => ctl.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT);
		try {
			const res = await fetchImpl(req.url, {
				method: req.method ?? (req.body ? 'POST' : 'GET'),
				headers: req.headers,
				body: req.body,
				signal: ctl.signal
			});
			// Errors are returned whole so the caller can show the provider's message.
			if (!onChunk || !res.ok || !res.body) {
				return { status: res.status, headers: headersOf(res), body: await res.text() };
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const text = decoder.decode(value, { stream: true });
				if (text) onChunk(text);
			}
			const tail = decoder.decode();
			if (tail) onChunk(tail);
			return { status: res.status, headers: headersOf(res), body: '' };
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		fetch(req: HttpRequest): Promise<HttpResponse> {
			return run(req, new AbortController());
		},
		/** Stream the body to `onChunk`; `abort(id)` cancels it. */
		async stream(
			id: string,
			req: HttpRequest,
			onChunk: (text: string) => void
		): Promise<HttpResponse> {
			const ctl = new AbortController();
			inflight.set(id, ctl);
			try {
				return await run(req, ctl, onChunk);
			} finally {
				inflight.delete(id);
			}
		},
		abort(id: string): void {
			inflight.get(id)?.abort();
			inflight.delete(id);
		}
	};
}
