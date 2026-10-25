import { describe, expect, it, vi } from 'vitest';
import type { NoteMeta } from '../../../shared/types';
import { MindMapContentCache } from './mindMapContentCache';

const note = (id: string, mtime = 1, encrypted = false): NoteMeta => ({
	id,
	absPath: `/${id}`,
	title: id,
	snippet: '',
	mtime,
	tags: [],
	pinned: false,
	locked: false,
	aiLocal: false,
	encrypted,
	mindMapVersion: null
});

describe('mind map content cache', () => {
	it('reads a large workspace once across load, self-save and reflow', async () => {
		const read = vi.fn(async (id: string) => `Body of ${id}`);
		const cache = new MindMapContentCache(read);
		const notes = Array.from({ length: 1000 }, (_, i) => note(`${i}.md`));
		cache.retain(notes, false);
		await Promise.all(notes.map((meta) => cache.get(meta)));
		expect(read).toHaveBeenCalledTimes(1000);
		const saved = { ...notes[0], mtime: 2 };
		notes[0] = saved;
		cache.retain(notes, false);
		cache.seed(saved, 'Saved map');
		await Promise.all(notes.map((meta) => cache.get(meta)));
		await Promise.all(notes.map((meta) => cache.get(meta)));
		expect(await cache.get(saved)).toBe('Saved map');
		expect(read).toHaveBeenCalledTimes(1000);
	});

	it('rereads only external changes and evicts removed notes', async () => {
		const read = vi.fn(async () => 'body');
		const cache = new MindMapContentCache(read);
		const a = note('a.md');
		const b = note('b.md');
		cache.retain([a, b], false);
		await Promise.all([cache.get(a), cache.get(b)]);
		const updated = { ...a, mtime: 2 };
		cache.retain([updated, b], false);
		await Promise.all([cache.get(updated), cache.get(b)]);
		expect(read).toHaveBeenCalledTimes(3);
		cache.retain([updated], false);
		await cache.get(b);
		expect(read).toHaveBeenCalledTimes(4);
	});

	it('discards decrypted bodies on lock even when mtimes remain unchanged', async () => {
		let body = 'old plaintext';
		const read = vi.fn(async () => body);
		const cache = new MindMapContentCache(read);
		const encrypted = note('secret.md', 1, true);
		cache.retain([encrypted], true);
		expect(await cache.get(encrypted)).toBe('old plaintext');
		cache.retain([], false);
		body = 'new plaintext';
		cache.retain([encrypted], true);
		expect(await cache.get(encrypted)).toBe('new plaintext');
		expect(read).toHaveBeenCalledTimes(2);
	});

	it('shares in-flight reads but retries failures', async () => {
		const read = vi.fn<(id: string) => Promise<string>>().mockRejectedValueOnce(new Error('busy'));
		const cache = new MindMapContentCache(read);
		const meta = note('note.md');
		const first = cache.get(meta);
		expect(cache.get(meta)).toBe(first);
		await expect(first).rejects.toThrow('busy');
		read.mockResolvedValueOnce('recovered');
		expect(await cache.get(meta)).toBe('recovered');
		expect(read).toHaveBeenCalledTimes(2);
	});
});
