import { CapacitorHttp } from '@capacitor/core';
import type { GitHttpRequest, GitHttpResponse, HttpClient } from 'isomorphic-git';

/**
 * isomorphic-git HTTP client over Capacitor's native HTTP stack (no WebView
 * fetch, so no CORS and no proxy). Bodies are buffered: the request is sent as
 * base64 with `dataType: 'file'` (decoded to raw bytes natively) and the
 * response is read as base64 via `responseType: 'arraybuffer'`.
 */

export function toBase64(bytes: Uint8Array): string {
	let bin = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK)
		bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
	const bin = atob(b64.replace(/\s+/g, ''));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function collect(body: GitHttpRequest['body']): Promise<Uint8Array | null> {
	if (!body) return null;
	const parts: Uint8Array[] = [];
	for await (const chunk of body as AsyncIterable<Uint8Array>) parts.push(chunk);
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

async function* once(chunk: Uint8Array): AsyncIterableIterator<Uint8Array> {
	yield chunk;
}

type Request = typeof CapacitorHttp.request;

export function createCapHttp(request: Request = (o) => CapacitorHttp.request(o)): HttpClient {
	return {
		async request({ url, method = 'GET', headers = {}, body }): Promise<GitHttpResponse> {
			const bytes = await collect(body);
			const res = await request({
				url,
				method,
				headers,
				responseType: 'arraybuffer',
				...(bytes ? { data: toBase64(bytes), dataType: 'file' } : {})
			});
			const ok = res.status >= 200 && res.status < 300;
			// Error bodies come back as text/JSON rather than base64; isomorphic-git
			// only needs the status for those.
			const data =
				ok && typeof res.data === 'string'
					? fromBase64(res.data)
					: new TextEncoder().encode(
							typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
						);
			const outHeaders: Record<string, string> = {};
			for (const [k, v] of Object.entries(res.headers ?? {}))
				outHeaders[k.toLowerCase()] = String(v);
			return {
				url: res.url || url,
				method,
				statusCode: res.status,
				statusMessage: ok ? 'OK' : `HTTP ${res.status}`,
				headers: outHeaders,
				body: once(data)
			};
		}
	};
}
