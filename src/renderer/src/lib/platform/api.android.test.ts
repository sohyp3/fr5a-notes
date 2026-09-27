import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Capacitor plugin mocks --------------------------------------------------

/** In-memory Directory.Data: files map path -> { data, mtime }, plus a dir set. */
const mem = vi.hoisted(() => ({
	files: new Map<string, { data: string; mtime: number }>(),
	dirs: new Set<string>(),
	prefs: new Map<string, string>(),
	secure: new Map<string, string>(),
	http: [] as unknown[],
	resume: [] as (() => void)[],
	clock: 1000
}));

vi.mock('@capacitor/filesystem', () => {
	const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
	const fail = (msg: string) => Promise.reject(new Error(msg));
	const mkdirs = (p: string) => {
		for (let d = p; d; d = parent(d)) mem.dirs.add(d);
	};
	return {
		Directory: { Data: 'DATA' },
		Encoding: { UTF8: 'utf8' },
		Filesystem: {
			getUri: async ({ path }: { path: string }) => ({ uri: `file:///data/app/files/${path}` }),
			stat: async ({ path }: { path: string }) => {
				const f = mem.files.get(path);
				if (f) return { type: 'file', mtime: f.mtime, name: path, size: 0, uri: '' };
				if (mem.dirs.has(path))
					return { type: 'directory', mtime: 0, name: path, size: 0, uri: '' };
				return fail('File does not exist');
			},
			mkdir: async ({ path }: { path: string }) => {
				if (mem.dirs.has(path) || mem.files.has(path)) return fail('Directory exists');
				mkdirs(path);
			},
			readdir: async ({ path }: { path: string }) => {
				if (!mem.dirs.has(path)) return fail('Directory does not exist');
				const kids = new Map<string, { type: string; mtime: number }>();
				for (const d of mem.dirs)
					if (parent(d) === path)
						kids.set(d.slice(path.length + 1), { type: 'directory', mtime: 0 });
				for (const [f, v] of mem.files)
					if (parent(f) === path)
						kids.set(f.slice(path.length + 1), { type: 'file', mtime: v.mtime });
				return {
					files: [...kids].map(([name, v]) => ({ name, ...v, size: 0, uri: '' }))
				};
			},
			readFile: async ({ path }: { path: string }) => {
				const f = mem.files.get(path);
				return f ? { data: f.data } : fail('File does not exist');
			},
			writeFile: async ({
				path,
				data,
				recursive
			}: {
				path: string;
				data: string;
				recursive?: boolean;
			}) => {
				if (!mem.dirs.has(parent(path))) {
					if (!recursive) return fail('Parent directory missing');
					mkdirs(parent(path));
				}
				mem.files.set(path, { data, mtime: ++mem.clock });
				return { uri: path };
			},
			deleteFile: async ({ path }: { path: string }) => {
				if (!mem.files.delete(path)) return fail('File does not exist');
			},
			rename: async ({ from, to }: { from: string; to: string }) => {
				const f = mem.files.get(from);
				if (!f) return fail('File does not exist');
				if (!mem.dirs.has(parent(to))) return fail('Parent directory missing');
				mem.files.delete(from);
				mem.files.set(to, f);
			}
		}
	};
});

vi.mock('@capacitor/preferences', () => ({
	Preferences: {
		get: async ({ key }: { key: string }) => ({ value: mem.prefs.get(key) ?? null }),
		set: async ({ key, value }: { key: string; value: string }) => void mem.prefs.set(key, value),
		remove: async ({ key }: { key: string }) => void mem.prefs.delete(key)
	}
}));

vi.mock('@capacitor/app', () => ({
	App: {
		addListener: async (event: string, cb: () => void) => {
			if (event === 'resume') mem.resume.push(cb);
			return { remove: async () => {} };
		}
	}
}));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
	SecureStorage: {
		getItem: async (key: string) => mem.secure.get(key) ?? null,
		setItem: async (key: string, value: string) => void mem.secure.set(key, value),
		remove: async (key: string) => mem.secure.delete(key)
	}
}));

vi.mock('@capacitor/core', () => ({
	CapacitorHttp: {
		request: async (opts: unknown) => {
			mem.http.push(opts);
			return { status: 401, headers: {}, data: '', url: '' };
		}
	}
}));

import { buildMeta, createAndroidPlatform, safeSubdir, TOKEN_KEY } from './api.android';

/** Seed a note under the workspace (`notes/`) as if it came from a git clone. */
function seed(id: string, data: string) {
	const path = `notes/${id}`;
	for (
		let d = path.slice(0, path.lastIndexOf('/'));
		d;
		d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : ''
	)
		mem.dirs.add(d);
	mem.files.set(path, { data, mtime: ++mem.clock });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	mem.files.clear();
	mem.dirs.clear();
	mem.prefs.clear();
	mem.secure.clear();
	mem.http.length = 0;
	mem.resume.length = 0;
	mem.clock = 1000;
});

describe('pure helpers', () => {
	it('safeSubdir keeps folders inside the workspace', () => {
		expect(safeSubdir('')).toBe('');
		expect(safeSubdir('work/ideas/')).toBe('work/ideas');
		expect(safeSubdir('../../etc')).toBe('etc');
		expect(safeSubdir('/abs\\win')).toBe('abs/win');
	});

	it('buildMeta derives title, snippet, tags and hidden metadata', () => {
		const raw = '<!-- pinned: true -->\n<!-- locked: true -->\n# Hello\n\nBody #work/a text';
		const m = buildMeta('dir/n.md', '/x/dir/n.md', raw, 5);
		expect(m).toMatchObject({
			id: 'dir/n.md',
			title: 'Hello',
			snippet: 'Body work/a text',
			tags: ['work/a'],
			pinned: true,
			locked: true,
			mtime: 5
		});
		expect(buildMeta('empty.md', '', '\n', 0).title).toBe('empty');
	});
});

describe('android platform', () => {
	it('creates the app-private workspace and has no window controls', async () => {
		const api = createAndroidPlatform();
		expect(await api.getWorkspace()).toBe('/data/app/files/notes');
		expect(await api.pickWorkspace()).toBe('/data/app/files/notes');
		expect(mem.dirs.has('notes')).toBe(true);
		expect(api.platform).toBe('android');
		expect(api.minimize).toBeUndefined();
		expect(api.maximize).toBeUndefined();
		expect(api.close).toBeUndefined();
	});

	it('indexes existing notes on launch, skipping dot-dirs and non-notes', async () => {
		seed('a.md', '# Alpha\n#tag1');
		seed('sub/b.md', '<!-- pinned: true -->\n# Beta\n#tag1/child');
		seed('.git/HEAD.md', '# not a note');
		seed('image.png', 'bin');
		const api = createAndroidPlatform();
		const notes = await api.listNotes();
		expect(notes.map((n) => n.id)).toEqual(['sub/b.md', 'a.md']); // pinned first
		expect(notes[0].absPath).toBe('/data/app/files/notes/sub/b.md');
		const tags = await api.listTags();
		expect(tags).toEqual([
			{
				name: 'tag1',
				path: 'tag1',
				count: 2,
				children: [{ name: 'child', path: 'tag1/child', count: 1, children: [] }]
			}
		]);
	});

	it('reads, writes and re-indexes a note', async () => {
		seed('a.md', '# Alpha');
		const api = createAndroidPlatform();
		const changed = vi.fn();
		api.onNotesChanged(changed);
		await api.writeNote('a.md', '# Renamed\nnew #x');
		expect(await api.readNote('a.md')).toBe('# Renamed\nnew #x');
		expect((await api.listNotes())[0]).toMatchObject({ title: 'Renamed', tags: ['x'] });
		await new Promise((r) => setTimeout(r, 150));
		expect(changed).toHaveBeenCalledTimes(1);
	});

	it('creates notes with unique names inside a safe folder', async () => {
		const api = createAndroidPlatform();
		const a = await api.createNote('My/Note', 'work');
		expect(a.id).toBe('work/My-Note.md');
		expect(await api.readNote(a.id)).toBe('# My-Note\n\n');
		const b = await api.createNote('My/Note', 'work', '# body');
		expect(b.id).toBe('work/My-Note 2.md');
		expect(b.title).toBe('body');
		const c = await api.createNote(undefined, '../..');
		expect(c.id).toBe('Untitled.md');
		expect((await api.listNotes()).length).toBe(3);
	});

	it('lists and creates folders, including empty ones', async () => {
		seed('x/y/n.md', 'n');
		const api = createAndroidPlatform();
		expect(await api.createFolder('new', 'x')).toBe('x/new');
		expect(await api.createFolder('new', 'x')).toBe('x/new 2');
		await expect(api.createFolder('  ')).rejects.toThrow('empty');
		expect(await api.listFolders()).toEqual(['x', 'x/new', 'x/new 2', 'x/y']);
	});

	it('soft-deletes into the trash, restores and permanently deletes', async () => {
		seed('d/n.md', '# N');
		const api = createAndroidPlatform();
		await api.deleteNote('d/n.md');
		expect(await api.listNotes()).toEqual([]);
		const trash = await api.listTrash();
		expect(trash.map((t) => t.id)).toEqual(['.fr5a_trash/d/n.md']);

		// Restoring onto an occupied path dedupes the name.
		await api.writeNote('d/n.md', '# Newer');
		const restored = await api.restoreNote('.fr5a_trash/d/n.md');
		expect(restored).toBe('d/n 2.md');
		expect((await api.listNotes()).map((n) => n.id).sort()).toEqual(['d/n 2.md', 'd/n.md']);

		await api.deleteNote('d/n.md');
		await api.permanentDelete('.fr5a_trash/d/n.md');
		expect(await api.listTrash()).toEqual([]);
	});

	it('refuses to delete a locked note', async () => {
		seed('l.md', '<!-- locked: true -->\n# L');
		const api = createAndroidPlatform();
		await expect(api.deleteNote('l.md')).rejects.toThrow('locked');
		expect((await api.listNotes()).length).toBe(1);
	});

	it('rebuilds the index on resume and notifies listeners', async () => {
		const api = createAndroidPlatform();
		expect(await api.listNotes()).toEqual([]);
		const changed = vi.fn();
		api.onNotesChanged(changed);
		seed('pulled.md', '# From elsewhere'); // e.g. written while backgrounded
		expect(mem.resume).toHaveLength(1);
		mem.resume[0]();
		await flush();
		await flush();
		expect((await api.listNotes()).map((n) => n.id)).toEqual(['pulled.md']);
		expect(changed).toHaveBeenCalled();
	});

	it('persists UI state as JSON in Preferences', async () => {
		const api = createAndroidPlatform();
		expect(await api.getState('settings')).toBeNull();
		await api.setState('settings', { vim: true });
		expect(mem.prefs.get('fr5a:settings')).toBe('{"vim":true}');
		expect(await api.getState('settings')).toEqual({ vim: true });
		await api.setState('settings', null);
		expect(await api.getState('settings')).toBeNull();
	});

	it('unsubscribes listeners', async () => {
		const api = createAndroidPlatform();
		const changed = vi.fn();
		const off = api.onNotesChanged(changed);
		off();
		await api.createNote('x');
		await new Promise((r) => setTimeout(r, 150));
		expect(changed).not.toHaveBeenCalled();
	});

	it('reports sync as not set up until a remote is connected', async () => {
		const api = createAndroidPlatform();
		expect(await api.syncStatus!()).toEqual({ remote: null, hasToken: false });
		expect(await api.syncPull()).toEqual({
			ok: false,
			error: { code: 'not-a-repo', message: 'The notes folder is not a git repository.' }
		});
		expect(await api.syncConflicts()).toEqual([]);
	});

	it('rejects non-HTTPS remotes before storing anything', async () => {
		const api = createAndroidPlatform();
		const res = await api.syncSetup!('git@github.com:me/notes.git', 'tok');
		expect(res).toMatchObject({ ok: false, error: { code: 'no-remote' } });
		expect(mem.secure.size).toBe(0);
	});

	it('keeps the token in secure storage only, and sends it over native HTTP', async () => {
		const api = createAndroidPlatform();
		const res = await api.syncSetup!('https://github.com/me/notes.git', ' ghp_secret ');
		// The mocked remote answers 401: surfaced as an auth error, nothing cloned.
		expect(res).toMatchObject({ ok: false, error: { code: 'auth' } });
		expect(mem.secure.get(TOKEN_KEY)).toBe('ghp_secret');
		for (const [, v] of mem.prefs) expect(v).not.toContain('ghp_secret');
		for (const [, f] of mem.files) expect(f.data).not.toContain('ghp_secret');
		const req = mem.http[0] as { url: string; headers: Record<string, string> };
		expect(req.url).toBe('https://github.com/me/notes.git/info/refs?service=git-upload-pack');
		expect(req.headers.Authorization).toBe(`Basic ${btoa('ghp_secret:x-oauth-basic')}`);
		expect(await api.syncStatus!()).toEqual({ remote: null, hasToken: true });
		await api.syncForgetToken!();
		expect(mem.secure.has(TOKEN_KEY)).toBe(false);
	});
});
