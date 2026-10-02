import { describe, expect, it } from 'vitest';
import { parseSession, serializeSession, sessionFileName, slugify, type Session } from './session';

const session: Session = {
	file: 'x.md',
	title: 'Article: ideas, plans',
	created: '2026-10-01T10:00:00.000Z',
	provider: 'deepseek',
	skill: 'clarify',
	notes: ['drafts/a.md', 'b c.md'],
	turns: [
		{ role: 'you', text: 'Help me plan\n\n## A heading in my text' },
		{ role: 'tool', tool: 'web_search', text: '1. Result — https://e.com' },
		{ role: 'ai', text: 'Sure.\n\n- one\n- two' }
	]
};

describe('session files', () => {
	it('round-trips through Markdown', () => {
		const text = serializeSession(session);
		expect(text).toContain('# Article: ideas, plans');
		expect(parseSession('x.md', text)).toEqual(session);
	});

	it('names files by timestamp + slug', () => {
		expect(sessionFileName('Hello, World!', new Date(2026, 9, 1, 9, 5, 7))).toBe(
			'2026-10-01-090507-hello-world.md'
		);
		expect(slugify('مرحبا بالعالم')).toBe('مرحبا-بالعالم');
	});
});
