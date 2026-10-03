import { describe, expect, it } from 'vitest';
import type { PlatformApi } from '../platform/types';
import type { GitChange, NoteMeta } from '../../../../shared/types';
import { isEncryptedNote, splitEncrypted, splitHeader } from '../../../../shared/encrypted';
import { VaultLockedError, wrapNotes, type NoteCrypt } from './wrap';

// A stand-in cipher: base64 inside real armor lines, plus a counter so every
// encryption differs (like PGP's random session keys).
let nonce = 0;
const BEGIN = '-----BEGIN PGP MESSAGE-----\n';
const END = '\n-----END PGP MESSAGE-----\n';
const enc = (plain: string) => {
	const { head, body } = splitHeader(plain);
	return `${head}${BEGIN}${++nonce}:${Buffer.from(body).toString('base64')}${END}`;
};
const dec = (raw: string) => {
	const p = splitEncrypted(raw)!;
	const b64 = p.armor.slice(BEGIN.length, -END.length).split(':')[1];
	return p.head + Buffer.from(b64, 'base64').toString();
};

function setup(files: Record<string, string>) {
	let unlocked = true;
	let decrypts = 0;
	const writes: string[] = [];
	const meta = (id: string): NoteMeta => ({
		id,
		absPath: id,
		title: id.replace(/\.md$/, ''),
		snippet: '',
		mtime: files[id].length,
		tags: [],
		pinned: false,
		locked: false,
		aiLocal: false,
		encrypted: isEncryptedNote(files[id])
	});
	const committed: Record<string, string> = { ...files };
	const host = {
		readNote: async (id: string) => {
			if (!(id in files)) throw new Error('ENOENT');
			return files[id];
		},
		writeNote: async (id: string, content: string) => {
			writes.push(id);
			files[id] = content;
		},
		listNotes: async () => Object.keys(files).map(meta),
		listTags: async () => [],
		syncConflicts: async () => [],
		syncResolve: async () => ({ ok: true, result: { status: 'ok' } }),
		gitChanges: async (): Promise<GitChange[]> =>
			Object.keys(files)
				.filter((id) => files[id] !== committed[id])
				.map((id) => ({ path: id, status: 'modified', before: committed[id], after: files[id] }))
	} as unknown as PlatformApi;
	const crypt: NoteCrypt = {
		unlocked: () => unlocked,
		encrypt: async (p) => enc(p),
		decrypt: async (r) => {
			if (!unlocked) throw new VaultLockedError();
			decrypts++;
			return dec(r);
		}
	};
	const w = wrapNotes(host, crypt);
	return {
		api: w.methods as Required<typeof w.methods>,
		clear: w.clear,
		files,
		writes,
		lock: () => (unlocked = false),
		decrypts: () => decrypts
	};
}

describe('wrapNotes', () => {
	it('leaves plain notes alone', async () => {
		const t = setup({ 'a.md': '# A\n' });
		expect(await t.api.readNote('a.md')).toBe('# A\n');
		await t.api.writeNote('a.md', '# A2\n');
		expect(t.files['a.md']).toBe('# A2\n');
	});

	it('decrypts on read and keeps encrypted notes encrypted on write', async () => {
		const t = setup({ 's.md': enc('<!-- pinned: true -->\n# Secret\nbody #x\n') });
		expect(await t.api.readNote('s.md')).toBe('<!-- pinned: true -->\n# Secret\nbody #x\n');
		await t.api.writeNote('s.md', '<!-- pinned: true -->\n# Secret\nmore\n');
		expect(t.files['s.md']).toMatch(/^<!-- pinned: true -->\n-----BEGIN PGP MESSAGE-----/);
		expect(t.files['s.md']).not.toContain('more');
		expect(dec(t.files['s.md'])).toBe('<!-- pinned: true -->\n# Secret\nmore\n');
	});

	it('skips a write that would not change the text', async () => {
		const t = setup({ 's.md': enc('# Same\n') });
		const before = t.files['s.md'];
		await t.api.writeNote('s.md', '# Same\n');
		expect(t.files['s.md']).toBe(before);
		expect(t.writes).toEqual([]);
	});

	it('refuses to read while locked but still encrypts writes', async () => {
		const t = setup({ 's.md': enc('# S\n') });
		t.lock();
		await expect(t.api.readNote('s.md')).rejects.toBeInstanceOf(VaultLockedError);
		await t.api.writeNote('s.md', '# S edited\n');
		expect(isEncryptedNote(t.files['s.md'])).toBe(true);
		// A metadata-only edit made on the file text passes straight through.
		const raw = `<!-- locked: true -->\n${t.files['s.md']}`;
		await t.api.writeNote('s.md', raw);
		expect(t.files['s.md']).toBe(raw);
	});

	it('shows real titles, snippets and tags while unlocked, decrypting each version once', async () => {
		const t = setup({ 's.md': enc('# Diary\nToday #life\n'), 'p.md': '# Plain\n' });
		const notes = await t.api.listNotes();
		expect(notes.find((n) => n.id === 's.md')).toMatchObject({
			title: 'Diary',
			snippet: 'Today life',
			tags: ['life']
		});
		await t.api.listNotes();
		expect(t.decrypts()).toBe(1);
		const tags = await t.api.listTags();
		expect(tags.map((x) => x.name)).toEqual(['life']);

		t.files['s.md'] = enc('# Diary, edited and longer\n');
		expect((await t.api.listNotes()).find((n) => n.id === 's.md')?.title).toBe(
			'Diary, edited and longer'
		);
		expect(t.decrypts()).toBe(2);

		t.clear();
		t.lock();
		expect((await t.api.listNotes()).find((n) => n.id === 's.md')?.title).toBe('s');
	});

	it('decrypts git diffs only while unlocked', async () => {
		const t = setup({ 's.md': enc('# One\n') });
		t.files['s.md'] = enc('# Two\n');
		const [c] = (await t.api.gitChanges())!;
		expect([c.before, c.after]).toEqual(['# One\n', '# Two\n']);
		t.lock();
		const [l] = (await t.api.gitChanges())!;
		expect(isEncryptedNote(l.after!)).toBe(true);
	});
});
