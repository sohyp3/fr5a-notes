import { describe, expect, it } from 'vitest';
import { createSseParser } from './sse';

function parse(chunks: string[]): string[] {
	const out: string[] = [];
	const p = createSseParser((d) => out.push(d));
	for (const c of chunks) p.feed(c);
	p.end();
	return out;
}

describe('createSseParser', () => {
	it('parses events split across chunk boundaries', () => {
		expect(parse(['data: {"a"', ':1}\n', '\ndata: [DONE]\n\n'])).toEqual(['{"a":1}', '[DONE]']);
	});

	it('ignores comments and other fields, handles CRLF', () => {
		expect(parse([': keep-alive\r\nevent: x\r\ndata: hi\r\n\r\n'])).toEqual(['hi']);
	});

	it('joins multi-line data and flushes a trailing event', () => {
		expect(parse(['data: a\ndata: b\n\ndata: tail'])).toEqual(['a\nb', 'tail']);
	});
});
