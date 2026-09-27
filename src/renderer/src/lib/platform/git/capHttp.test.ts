import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: vi.fn() } }));

import { createCapHttp, fromBase64, toBase64 } from './capHttp';

async function bodyOf(body: AsyncIterableIterator<Uint8Array> | undefined): Promise<Uint8Array[]> {
	const out: Uint8Array[] = [];
	for await (const chunk of body ?? []) out.push(chunk);
	return out;
}

describe('native HTTP client for isomorphic-git', () => {
	it('round-trips binary through base64', () => {
		const bytes = new Uint8Array(70000).map((_, i) => i % 256);
		expect(fromBase64(toBase64(bytes))).toEqual(bytes);
		expect(fromBase64('AAEC\n/w==\n')).toEqual(new Uint8Array([0, 1, 2, 255]));
	});

	it('sends the packed body as a base64 file and decodes the binary reply', async () => {
		const request = vi.fn().mockResolvedValue({
			status: 200,
			url: 'https://h/x.git/git-upload-pack',
			headers: { 'Content-Type': 'application/x-git-upload-pack-result' },
			data: toBase64(new Uint8Array([9, 8, 7]))
		});
		const http = createCapHttp(request);
		async function* body() {
			yield new Uint8Array([1, 2]);
			yield new Uint8Array([3]);
		}
		const res = await http.request({
			url: 'https://h/x.git/git-upload-pack',
			method: 'POST',
			headers: { 'content-type': 'application/x-git-upload-pack-request' },
			body: body()
		});
		expect(request).toHaveBeenCalledWith({
			url: 'https://h/x.git/git-upload-pack',
			method: 'POST',
			headers: { 'content-type': 'application/x-git-upload-pack-request' },
			responseType: 'arraybuffer',
			data: toBase64(new Uint8Array([1, 2, 3])),
			dataType: 'file'
		});
		expect(res.statusCode).toBe(200);
		expect(res.headers?.['content-type']).toBe('application/x-git-upload-pack-result');
		expect(await bodyOf(res.body)).toEqual([new Uint8Array([9, 8, 7])]);
	});

	it('passes error statuses through without decoding', async () => {
		const http = createCapHttp(
			vi.fn().mockResolvedValue({ status: 401, url: '', headers: {}, data: 'Bad credentials' })
		);
		const res = await http.request({
			url: 'https://h/x.git/info/refs',
			method: 'GET',
			headers: {}
		});
		expect(res.statusCode).toBe(401);
		expect(new TextDecoder().decode((await bodyOf(res.body))[0])).toBe('Bad credentials');
	});
});
