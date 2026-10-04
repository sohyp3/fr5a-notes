import { describe, expect, it } from 'vitest';
import {
	forkTitle,
	hashText,
	notesRead,
	parseSession,
	serializeSession,
	sessionFileName,
	sessionPath,
	sessionToNote,
	slugify,
	withDeviceIgnored,
	type Session
} from './session';

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

	it('keeps device-only chats in an ignored folder', () => {
		expect(sessionPath('a.md', false)).toBe('sessions/a.md');
		expect(sessionPath('a.md', true)).toBe('sessions/device/a.md');
		const fresh = withDeviceIgnored('')!;
		expect(fresh.split('\n')).toContain('device/');
		expect(withDeviceIgnored(fresh)).toBeNull();
		expect(withDeviceIgnored('/device/\n')).toBeNull();
		// Someone else's entries stay.
		expect(withDeviceIgnored('*.tmp\n')).toMatch(/^\*\.tmp\n\n# fr5a: .*\ndevice\/\n$/);
	});
});

describe('saving and forking', () => {
	it('keeps usage records through a round trip', () => {
		const used: Session = {
			...session,
			usage: [
				{
					at: '2026-10-04T10:00:00.000Z',
					provider: 'or',
					model: 'deepseek/deepseek-chat',
					input: 1200,
					output: 80,
					cost: 0.0004
				},
				{
					at: '2026-10-04T10:05:00.000Z',
					provider: 'ol',
					model: 'qwen3:8b',
					input: 9,
					output: 3,
					cost: null
				}
			]
		};
		expect(parseSession('x.md', serializeSession(used))).toEqual(used);
	});

	it('keeps the saved-note link through a round trip', () => {
		const saved = { ...session, saved: 'AI chats/plan.md', savedHash: hashText('x') };
		expect(parseSession('x.md', serializeSession(saved))).toEqual(saved);
		expect(hashText('a')).not.toBe(hashText('b'));
	});

	it('numbers forks', () => {
		expect(forkTitle('Plan')).toBe('Plan (fork)');
		expect(forkTitle('Plan (fork)')).toBe('Plan (fork 2)');
		expect(forkTitle('Plan (fork 2)')).toBe('Plan (fork 3)');
	});

	it('finds notes read with read_note', () => {
		expect(
			notesRead([
				{ role: 'tool', tool: 'read_note', text: '{"id":"private/a.md"}\n\n# A' },
				{ role: 'tool', tool: 'web_search', text: '{"id":"nope"}' },
				{ role: 'tool', tool: 'read_note', text: 'garbled' }
			])
		).toEqual(['private/a.md']);
	});

	it('writes a readable note', () => {
		const text = sessionToNote(
			{
				...session,
				turns: [
					{ role: 'you', text: 'Help me plan\nline two' },
					{ role: 'tool', tool: 'web_search', text: '…' },
					{ role: 'ai', text: '| a | b |\n|---|---|\n| 1 | 2 |' },
					{ role: 'you', text: 'Thanks' },
					{ role: 'ai', text: 'Sure.' }
				]
			},
			{ provider: 'DeepSeek', local: true, date: new Date(2026, 9, 1, 23, 30) }
		);
		expect(text).toBe(
			[
				'<!-- ai: local -->',
				'# Article: ideas, plans',
				'',
				'*AI chat · 2026-10-01 · DeepSeek · /clarify*',
				'',
				'> **You:** Help me plan',
				'> line two',
				'',
				'*Used web_search*',
				'',
				'| a | b |',
				'|---|---|',
				'| 1 | 2 |',
				'',
				'---',
				'',
				'> **You:** Thanks',
				'',
				'Sure.',
				''
			].join('\n')
		);
	});
});
