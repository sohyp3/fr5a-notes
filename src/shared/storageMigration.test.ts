import { describe, expect, it } from 'vitest';
import {
	isSavedChat,
	planStorageMigration,
	rewriteLinks,
	storageMoveError,
	storageRewriteError
} from './storageMigration';

describe('storage migration planner', () => {
	it('moves images and chats into .fr5a and rewrites their links', () => {
		const plan = planStorageMigration({
			assets: ['assets/cat.png', 'assets/sub/dog.jpg', 'assets/notes.txt'],
			chats: ['AI chats/talk.md'],
			notes: [
				{ id: 'hello.md', text: '# Hello\n\n![A cat](assets/cat.png)\n<!-- size: 40% -->' },
				{ id: 'Work/plan.md', text: '# Plan\n\n![](../assets/sub/dog.jpg "Dog")\nplain' },
				{ id: 'abs.md', text: '![x](/assets/cat.png?v=1)' },
				{ id: 'untouched.md', text: '# Nothing\n\n[site](https://example.com)' },
				{
					id: 'AI chats/talk.md',
					text: '# Talk\n\n*AI chat · 2026-01-02*\n\n[plan](../Work/plan.md)'
				},
				{ id: 'links.md', text: '[the chat](AI%20chats/talk.md)' },
				{ id: '.fr5a/chats/new.md', text: '# New\n\n![](../../assets/cat.png)' }
			]
		});
		expect(plan.moves).toEqual([
			{ from: 'assets/cat.png', to: '.fr5a/assets/cat.png' },
			{ from: 'assets/sub/dog.jpg', to: '.fr5a/assets/sub/dog.jpg' },
			{ from: 'AI chats/talk.md', to: '.fr5a/chats/talk.md' }
		]);
		expect(Object.fromEntries(plan.rewrites.map((r) => [r.id, r.text]))).toEqual({
			'hello.md': '# Hello\n\n![A cat](.fr5a/assets/cat.png)\n<!-- size: 40% -->',
			'Work/plan.md': '# Plan\n\n![](../.fr5a/assets/sub/dog.jpg "Dog")\nplain',
			'abs.md': '![x](/.fr5a/assets/cat.png?v=1)',
			'AI chats/talk.md': '# Talk\n\n*AI chat · 2026-01-02*\n\n[plan](../../Work/plan.md)',
			'links.md': '[the chat](.fr5a/chats/talk.md)',
			'.fr5a/chats/new.md': '# New\n\n![](../assets/cat.png)'
		});
		expect(plan.skipped).toEqual([]);
		for (const m of plan.moves) expect(storageMoveError(m)).toBeNull();
		for (const r of plan.rewrites) expect(storageRewriteError(r)).toBeNull();
	});

	it('keeps images in place while a note can’t be read; chats still move', () => {
		const armored =
			'<!-- pinned: true -->\n-----BEGIN PGP MESSAGE-----\n\nwcBMA\n-----END PGP MESSAGE-----\n';
		for (const locked of [null, armored]) {
			const plan = planStorageMigration({
				assets: ['assets/cat.png'],
				chats: ['AI chats/talk.md'],
				notes: [
					{ id: 'hello.md', text: '![](assets/cat.png)\n[c](AI%20chats/talk.md)' },
					{ id: 'secret.md', text: locked }
				]
			});
			expect(plan.moves).toEqual([{ from: 'AI chats/talk.md', to: '.fr5a/chats/talk.md' }]);
			expect(plan.rewrites).toEqual([
				{ id: 'hello.md', text: '![](assets/cat.png)\n[c](.fr5a/chats/talk.md)' }
			]);
			expect(plan.skipped).toEqual(['secret.md']);
		}
	});

	it('never lands on a taken file', () => {
		const plan = planStorageMigration({
			assets: ['assets/a.png'],
			chats: [],
			notes: [{ id: 'n.md', text: '![](assets/a.png)' }],
			taken: ['.fr5a/assets/a.png', '.fr5a/assets/a 2.png']
		});
		expect(plan.moves).toEqual([{ from: 'assets/a.png', to: '.fr5a/assets/a 3.png' }]);
		expect(plan.rewrites[0].text).toBe('![](.fr5a/assets/a%203.png)');
	});

	it('leaves fenced code, URLs and angle links alone unless moved', () => {
		const moved = new Map([['assets/a.png', '.fr5a/assets/a.png']]);
		expect(rewriteLinks('```\n![](assets/a.png)\n```', '', '', moved)).toBeNull();
		expect(rewriteLinks('![](https://x/assets/a.png)', '', '', moved)).toBeNull();
		expect(rewriteLinks('![](<assets/a.png>)', '', '', moved)).toBe('![](<.fr5a/assets/a.png>)');
		expect(rewriteLinks('[a](#top) [b](other.md)', 'x', 'x', moved)).toBeNull();
	});

	it('refuses moves and rewrites outside its scope', () => {
		expect(storageMoveError({ from: 'a.png', to: '.fr5a/skills/a.png' })).not.toBeNull();
		expect(storageMoveError({ from: '.git/a.png', to: '.fr5a/assets/a.png' })).not.toBeNull();
		expect(storageMoveError({ from: 'a.md', to: '.fr5a/assets/a.md' })).not.toBeNull();
		expect(storageRewriteError({ id: '.fr5a/sessions/a.md', text: '' })).not.toBeNull();
		expect(storageRewriteError({ id: 'a.png', text: '' })).not.toBeNull();
		expect(storageRewriteError({ id: '.fr5a/chats/a.md', text: '' })).toBeNull();
	});

	it('tells a saved chat by its byline', () => {
		expect(isSavedChat('# Talk\n\n*AI chat · 2026-01-02 · Fake (m)*\n\n> **You:** hi')).toBe(true);
		expect(isSavedChat('<!-- ai: local -->\n# Talk\n\n*AI chat*\n')).toBe(true);
		expect(isSavedChat('# Notes about AI chat\n\nplain')).toBe(false);
	});
});
