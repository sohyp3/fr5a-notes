import { App } from '@capacitor/app';
import { CapacitorHttp } from '@capacitor/core';
import { Directory, Encoding, Filesystem, type FileInfo } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { buildTagTree, parseTags } from '../../../../main/tags';
import type {
	ConflictFile,
	GitOpResponse,
	GitStash,
	HttpRequest,
	HttpResponse,
	NoteMeta,
	SyncRepo,
	StateKey,
	SyncResponse,
	SyncResult
} from '../../../../shared/types';
import { createCapFs } from './git/capFs';
import { createCapHttp } from './git/capHttp';
import { classify, createIsoGitSync, GitSyncError } from './git/isoGit';
import {
	byRepo,
	createMultiSync,
	isReadOnlyRepo,
	nestedIgnores,
	repoOf,
	syncOrder,
	withNestedIgnored
} from '../../../../shared/multiSync';
import type { PlatformApi } from './types';

/**
 * Android host (Capacitor). Notes live in `notes/` under app-private storage
 * (Directory.Data) — the folder a git working copy will be cloned into once
 * sync lands. No SAF, no storage permissions. The note index is in-memory,
 * rebuilt from disk on launch, on resume and after every sync. There is no
 * window chrome, so the window controls are simply absent.
 *
 * Git sync runs isomorphic-git over Capacitor Filesystem + native HTTP; the
 * GitHub token lives only in Keystore-backed secure storage.
 */

const DIR = Directory.Data;
/** Workspace root, relative to Directory.Data. */
export const NOTES_ROOT = 'notes';
const TRASH_DIR = '.fr5a_trash';
/** Hidden harness folder (sessions, skills); skipped by the walk like the trash. */
const META_DIR = '.fr5a';
const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.txt']);
const STATE_PREFIX = 'fr5a:';
const CHANGE_DEBOUNCE = 120;

// --- pure helpers (mirror main/fileService.ts) -------------------------------

function extname(p: string): string {
	const base = p.slice(p.lastIndexOf('/') + 1);
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(dot) : '';
}

function basename(p: string, ext = ''): string {
	const base = p.slice(p.lastIndexOf('/') + 1);
	return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

function dirname(p: string): string {
	const i = p.lastIndexOf('/');
	return i === -1 ? '' : p.slice(0, i);
}

function join(...parts: string[]): string {
	return parts.filter(Boolean).join('/');
}

function isNote(p: string): boolean {
	return MD_EXT.has(extname(p).toLowerCase());
}

const LOCKED_RE = /^\s*<!--\s*locked:\s*true\s*-->\s*$/im;

/** Normalise a caller-supplied folder to a safe, workspace-relative path. */
export function safeSubdir(folder: string): string {
	const out: string[] = [];
	for (const seg of folder.replace(/\\/g, '/').split('/')) {
		if (!seg || seg === '.') continue;
		if (seg === '..') out.pop();
		else out.push(seg);
	}
	return out.join('/');
}

/** Derive list metadata from a note's raw contents (same rules as desktop). */
export function buildMeta(id: string, absPath: string, raw: string, mtime: number): NoteMeta {
	const pinned = /^\s*<!--\s*pinned:\s*true\s*-->\s*$/im.test(raw);
	const locked = LOCKED_RE.test(raw);
	const body = raw.replace(
		/^\s*<!--\s*(?:dir:\s*(?:rtl|ltr)|pinned:\s*(?:true|false)|locked:\s*(?:true|false)|ai:\s*local)\s*-->\s*$/gim,
		''
	);
	let title = '';
	for (const line of body.split('\n')) {
		const t = line.trim();
		if (!t) continue;
		title = t.replace(/^#{1,6}\s*/, '');
		break;
	}
	if (!title) title = basename(id, extname(id));
	const snippet = body
		.replace(/^#{1,6}\s.*$/m, '')
		.replace(/[#>*_`~-]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 140);
	return { id, absPath, title, snippet, mtime, tags: parseTags(body), pinned, locked };
}

function sortNotes(notes: NoteMeta[]): NoteMeta[] {
	return notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.mtime - a.mtime);
}

/** Keystore-backed secure storage key prefix for harness secrets (API keys). */
const SECRET_PREFIX = 'secret:';

/**
 * CapacitorHttp serialises `data` itself; hand it parsed JSON for JSON bodies
 * so it isn't double-encoded as a string.
 */
function capBody(req: HttpRequest): unknown {
	if (req.body === undefined) return undefined;
	const type = Object.entries(req.headers ?? {}).find(
		([k]) => k.toLowerCase() === 'content-type'
	)?.[1];
	if (type?.includes('json')) {
		try {
			return JSON.parse(req.body);
		} catch {
			/* send as-is */
		}
	}
	return req.body;
}

/** Keystore-backed secure storage key for the GitHub personal access token. */
export const TOKEN_KEY = 'github-token';

// --- implementation ----------------------------------------------------------

export function createAndroidPlatform(): PlatformApi {
	const index = new Map<string, NoteMeta>();
	const changeListeners = new Set<() => void>();
	const doneListeners = new Set<() => void>();
	const conflictListeners = new Set<(files: ConflictFile[]) => void>();
	let rootUri = '';
	let changeTimer: ReturnType<typeof setTimeout> | null = null;

	/** Path under Directory.Data for a workspace-relative id. */
	const rel = (id: string) => join(NOTES_ROOT, id);
	const abs = (id: string) => join(rootUri, id);

	/** Workspace-relative id of a `.fr5a/` path (`..` can't climb out). */
	const metaId = (path: string) => join(META_DIR, safeSubdir(path));

	const emitChange = () => {
		if (changeTimer) clearTimeout(changeTimer);
		changeTimer = setTimeout(() => {
			changeTimer = null;
			for (const cb of changeListeners) cb();
		}, CHANGE_DEBOUNCE);
	};

	async function exists(id: string): Promise<boolean> {
		try {
			await Filesystem.stat({ path: rel(id), directory: DIR });
			return true;
		} catch {
			return false;
		}
	}

	/** mkdir -p that tolerates an existing directory (Capacitor throws on it). */
	async function ensureDir(id: string): Promise<void> {
		if (await exists(id)) return;
		try {
			await Filesystem.mkdir({ path: rel(id), directory: DIR, recursive: true });
		} catch (err) {
			if (!(await exists(id))) throw err;
		}
	}

	async function list(id: string): Promise<FileInfo[]> {
		try {
			return (await Filesystem.readdir({ path: rel(id), directory: DIR })).files;
		} catch {
			return [];
		}
	}

	async function readRaw(id: string): Promise<string> {
		const { data } = await Filesystem.readFile({
			path: rel(id),
			directory: DIR,
			encoding: Encoding.UTF8
		});
		return typeof data === 'string' ? data : await data.text();
	}

	async function metaFor(id: string, mtime?: number): Promise<NoteMeta> {
		const raw = await readRaw(id);
		const m = mtime ?? (await Filesystem.stat({ path: rel(id), directory: DIR })).mtime;
		return buildMeta(id, abs(id), raw, m);
	}

	/** Walk `dir`; `all` includes dot-dirs (used for the trash). */
	async function walk(
		dir: string,
		all: boolean,
		onFile: (id: string, info: FileInfo) => void,
		onDir?: (id: string) => void
	): Promise<void> {
		for (const entry of await list(dir)) {
			if (!all && (entry.name.startsWith('.') || entry.name === 'node_modules')) continue;
			const id = join(dir, entry.name);
			if (entry.type === 'directory') {
				onDir?.(id);
				await walk(id, all, onFile, onDir);
			} else if (isNote(id)) onFile(id, entry);
		}
	}

	async function reindexFile(id: string, mtime?: number): Promise<void> {
		try {
			index.set(id, await metaFor(id, mtime));
		} catch {
			index.delete(id);
		}
	}

	/** Full rescan of the working copy into the in-memory index. */
	async function rebuild(): Promise<void> {
		const found: [string, number][] = [];
		await walk('', false, (id, info) => found.push([id, info.mtime]));
		index.clear();
		await Promise.all(found.map(([id, mtime]) => reindexFile(id, mtime)));
	}

	/** Soft delete: move a note into the trash folder (locked notes refuse). */
	async function trash(id: string): Promise<void> {
		let raw: string | null = null;
		try {
			raw = await readRaw(id);
		} catch {
			// Missing file: nothing to protect.
		}
		if (raw !== null && LOCKED_RE.test(raw)) throw new Error(`Note is locked: ${id}`);
		const dest = await uniqueId(join(TRASH_DIR, id));
		try {
			await ensureDir(dirname(dest));
			await Filesystem.rename({ from: rel(id), to: rel(dest), directory: DIR, toDirectory: DIR });
		} catch {
			await Filesystem.deleteFile({ path: rel(id), directory: DIR }).catch(() => {});
		}
		index.delete(id);
		emitChange();
	}

	async function uniqueId(id: string): Promise<string> {
		if (!(await exists(id))) return id;
		const dir = dirname(id);
		const ext = extname(id);
		const base = basename(id, ext);
		let n = 1;
		let candidate = join(dir, `${base} ${++n}${ext}`);
		while (await exists(candidate)) candidate = join(dir, `${base} ${++n}${ext}`);
		return candidate;
	}

	async function write(id: string, content: string): Promise<void> {
		await Filesystem.writeFile({
			path: rel(id),
			directory: DIR,
			data: content,
			encoding: Encoding.UTF8,
			recursive: true
		});
		await reindexFile(id);
		emitChange();
	}

	const ready = (async () => {
		await ensureDir('');
		rootUri = (await Filesystem.getUri({ path: NOTES_ROOT, directory: DIR })).uri.replace(
			/^file:\/\//,
			''
		);
		await rebuild();
	})();

	// --- git sync (mirrors main/syncIpc.ts: one op at a time, pending conflicts) --

	const getToken = async () => (await SecureStorage.getItem(TOKEN_KEY)) || null;
	const git = createIsoGitSync({
		fs: createCapFs(),
		http: createCapHttp(),
		dir: `/${NOTES_ROOT}`,
		getToken
	});

	// Nested repos (e.g. `private/` → your own server): each its own working
	// copy + token, listed in the root's .gitignore.
	const REPOS_KEY = 'fr5a:syncRepos';
	const repoTokenKey = (path: string) => `token:${path}`;
	async function nestedRepos(): Promise<string[]> {
		const { value } = await Preferences.get({ key: REPOS_KEY });
		try {
			return value ? (JSON.parse(value) as string[]) : [];
		} catch {
			return [];
		}
	}
	async function setNestedRepos(paths: string[]): Promise<void> {
		await Preferences.set({ key: REPOS_KEY, value: JSON.stringify([...new Set(paths)].sort()) });
	}
	function repoGit(path: string) {
		return createIsoGitSync({
			fs: createCapFs(),
			http: createCapHttp(),
			dir: `/${NOTES_ROOT}/${path}`,
			getToken: async () => (await SecureStorage.getItem(repoTokenKey(path))) || null
		});
	}
	async function ignoreNested(paths: string[]): Promise<void> {
		for (const { repo, entries } of nestedIgnores(paths)) {
			if (!(await (repo ? repoGit(repo) : git).isRepo())) continue;
			const file = join(repo, '.gitignore');
			const current = await readRaw(file).catch(() => '');
			const next = withNestedIgnored(current, entries);
			if (next !== null)
				await Filesystem.writeFile({
					path: rel(file),
					directory: DIR,
					data: next,
					encoding: Encoding.UTF8
				});
		}
	}
	async function multi() {
		const nested = await nestedRepos();
		await ignoreNested(nested);
		const repos = syncOrder(['', ...nested]).map((path) => ({
			rel: path,
			sync: path ? repoGit(path) : git,
			readOnly: isReadOnlyRepo(path)
		}));
		return createMultiSync(repos, (code, message) => new GitSyncError(code, message));
	}

	let busy = false;
	/** Files of the merge currently awaiting resolve/abort, if any. */
	let pending: ConflictFile[] | null = null;

	async function guarded(op: () => Promise<SyncResult | void>): Promise<SyncResponse> {
		await ready;
		if (busy) return { ok: false, error: { code: 'busy', message: 'A sync is already running.' } };
		busy = true;
		try {
			const result = (await op()) ?? { status: 'ok' };
			// Files on disk may have changed: rebuild before anyone refetches.
			await rebuild();
			if (result.status === 'conflict') {
				pending = result.files;
				for (const cb of conflictListeners) cb(result.files);
			} else {
				pending = null;
				for (const cb of doneListeners) cb();
			}
			return { ok: true, result };
		} catch (err) {
			const e = classify(err);
			return { ok: false, error: { code: e.code, message: e.message } };
		} finally {
			busy = false;
		}
	}

	/** Stash / revert: shares the sync lock; the index is rebuilt afterwards. */
	async function gitOp(op: (nested: string[]) => Promise<void>): Promise<GitOpResponse> {
		await ready;
		if (busy) return { ok: false, error: 'A sync is running — try again in a moment.' };
		busy = true;
		try {
			await op(await nestedRepos());
			return { ok: true };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		} finally {
			busy = false;
			await rebuild();
			emitChange();
		}
	}

	const repoSync = (repo: string) => (repo ? repoGit(repo) : git);

	void App.addListener('resume', () => {
		void ready.then(rebuild).then(() => {
			for (const cb of changeListeners) cb();
		});
	});

	return {
		platform: 'android',
		conflictsInline: true,

		async getWorkspace() {
			await ready;
			return rootUri;
		},
		// Fixed app-private workspace: nothing to pick (no SAF).
		async pickWorkspace() {
			await ready;
			return rootUri;
		},

		async listNotes() {
			await ready;
			return sortNotes([...index.values()]);
		},
		async listTags() {
			await ready;
			const pairs = [...index.values()].flatMap((n) =>
				n.tags.map((tag) => ({ tag, noteId: n.id }))
			);
			return buildTagTree(pairs);
		},

		async readNote(id) {
			await ready;
			return readRaw(id);
		},
		async writeNote(id, content) {
			await ready;
			// Unchanged content: skip the write so the mtime (list order) stays put.
			if ((await readRaw(id).catch(() => null)) === content) return;
			await write(id, content);
		},
		async createNote(title = 'Untitled', folder = '', content) {
			await ready;
			const base = title.trim().replace(/[/\\?%*:|"<>]/g, '-') || 'Untitled';
			const dir = safeSubdir(folder);
			let name = `${base}.md`;
			let n = 1;
			while (await exists(join(dir, name))) name = `${base} ${++n}.md`;
			const id = join(dir, name);
			await write(id, content ?? `# ${base}\n\n`);
			return index.get(id) ?? metaFor(id);
		},
		async deleteNote(id) {
			await ready;
			await trash(id);
		},

		async listFolders() {
			await ready;
			const out: string[] = [];
			await walk(
				'',
				false,
				() => {},
				(id) => out.push(id)
			);
			return out.sort();
		},
		async createFolder(name, parent = '') {
			await ready;
			const clean = name.trim().replace(/[/\\?%*:|"<>]/g, '-');
			if (!clean) throw new Error('Folder name is empty');
			const dir = safeSubdir(parent);
			let id = join(dir, clean);
			let n = 1;
			while (await exists(id)) id = join(dir, `${clean} ${++n}`);
			await ensureDir(id);
			emitChange();
			return id;
		},

		async listTrash() {
			await ready;
			const found: [string, number][] = [];
			await walk(TRASH_DIR, true, (id, info) => found.push([id, info.mtime]));
			const metas = await Promise.all(
				found.map(([id, mtime]) => metaFor(id, mtime).catch(() => null))
			);
			return metas.filter((m): m is NoteMeta => m !== null).sort((a, b) => b.mtime - a.mtime);
		},
		async restoreNote(trashId) {
			await ready;
			const prefix = `${TRASH_DIR}/`;
			const original = trashId.startsWith(prefix)
				? trashId.slice(prefix.length)
				: basename(trashId);
			const dest = await uniqueId(original);
			await ensureDir(dirname(dest));
			await Filesystem.rename({
				from: rel(trashId),
				to: rel(dest),
				directory: DIR,
				toDirectory: DIR
			});
			await reindexFile(dest);
			emitChange();
			return dest;
		},
		async permanentDelete(trashId) {
			await ready;
			await Filesystem.deleteFile({ path: rel(trashId), directory: DIR }).catch(() => {});
			emitChange();
		},

		async getState<T = unknown>(key: StateKey): Promise<T | null> {
			const { value } = await Preferences.get({ key: STATE_PREFIX + key });
			if (value == null) return null;
			try {
				return JSON.parse(value) as T;
			} catch {
				return null;
			}
		},
		async setState(key, value) {
			const k = STATE_PREFIX + key;
			if (value === undefined || value === null) await Preferences.remove({ key: k });
			else await Preferences.set({ key: k, value: JSON.stringify(value) });
		},

		// Native HTTP: no CORS, but no streaming either — the harness parses the
		// buffered body (SSE included) in one go.
		async httpFetch(req): Promise<HttpResponse> {
			if (!/^https?:\/\//i.test(req.url))
				throw new Error(`Only http(s) URLs are allowed: ${req.url}`);
			const timeout = req.timeoutMs ?? 120_000;
			const res = await CapacitorHttp.request({
				url: req.url,
				method: req.method ?? (req.body ? 'POST' : 'GET'),
				headers: req.headers ?? {},
				data: capBody(req),
				responseType: 'text',
				connectTimeout: timeout,
				readTimeout: timeout
			});
			const headers: Record<string, string> = {};
			for (const [k, v] of Object.entries(res.headers ?? {})) headers[k.toLowerCase()] = String(v);
			const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
			return { status: res.status, headers, body };
		},

		async getSecret(name) {
			return ((await SecureStorage.getItem(SECRET_PREFIX + name)) as string | null) || null;
		},
		async setSecret(name, value) {
			if (value) await SecureStorage.setItem(SECRET_PREFIX + name, value);
			else await SecureStorage.remove(SECRET_PREFIX + name);
		},

		async readMeta(path) {
			await ready;
			try {
				return await readRaw(metaId(path));
			} catch {
				return null;
			}
		},
		async writeMeta(path, content) {
			await ready;
			// Not a note: no reindex / change event.
			await Filesystem.writeFile({
				path: rel(metaId(path)),
				directory: DIR,
				data: content,
				encoding: Encoding.UTF8,
				recursive: true
			});
		},
		async listMeta(path) {
			await ready;
			const all = await list(metaId(path));
			const files = all.filter((f) => f.type === 'file').sort((a, b) => b.mtime - a.mtime);
			const dirs = all.filter((f) => f.type === 'directory' && f.name !== '.git');
			return [...files.map((f) => f.name), ...dirs.map((f) => `${f.name}/`).sort()];
		},
		async deleteMeta(path) {
			await ready;
			await Filesystem.deleteFile({ path: rel(metaId(path)), directory: DIR }).catch(() => {});
		},

		syncPull: () => guarded(async () => (await multi()).pull()),
		syncPush: () => guarded(async () => (await multi()).push()),
		syncResolve: (choices) => guarded(async () => (await multi()).resolve(choices)),
		syncAbort: () => guarded(async () => (await multi()).abort()),

		async syncRepos(): Promise<SyncRepo[]> {
			await ready;
			const root: SyncRepo = {
				path: '',
				remote: await git.remoteUrl(),
				hasToken: (await getToken()) !== null
			};
			const nested = await Promise.all(
				(await nestedRepos()).map(async (path) => ({
					path,
					remote: await repoGit(path).remoteUrl(),
					hasToken: !!(await SecureStorage.getItem(repoTokenKey(path)))
				}))
			);
			return [root, ...nested];
		},
		async syncAddRepo(folder, url, token) {
			const path = safeSubdir(folder);
			if (!path || path === TRASH_DIR || path.startsWith(`${TRASH_DIR}/`))
				return { ok: false, error: { code: 'git', message: 'Pick a folder inside your notes.' } };
			if (!/^https:\/\/\S+$/i.test(url.trim()))
				return { ok: false, error: { code: 'no-remote', message: 'Use an HTTPS clone URL.' } };
			if (token.trim()) await SecureStorage.setItem(repoTokenKey(path), token.trim());
			return guarded(async () => {
				await ensureDir(path);
				// Ignore first, so the root never commits the folder's notes, and
				// stop tracking what the parent repo already had there.
				const parent = repoOf(path, await nestedRepos());
				await setNestedRepos([...(await nestedRepos()), path]);
				await ignoreNested(await nestedRepos());
				await repoSync(parent.repo).untrack(parent.rel);
				const repo = repoGit(path);
				await repo.connect(url.trim());
				const r = await repo.pull();
				return r.status === 'conflict'
					? { status: 'conflict', files: r.files.map((f) => ({ ...f, path: `${path}/${f.path}` })) }
					: r;
			});
		},
		async syncRemoveRepo(folder) {
			const path = safeSubdir(folder);
			await setNestedRepos((await nestedRepos()).filter((p) => p !== path));
			await SecureStorage.remove(repoTokenKey(path));
		},
		syncConflicts: async () => pending ?? [],

		async gitChanges() {
			await ready;
			const nested = await nestedRepos();
			const all = [
				await git.changes(),
				...(await Promise.all(
					nested.map(async (path) =>
						((await repoGit(path).changes()) ?? null)?.map((c) => ({
							...c,
							path: `${path}/${c.path}`
						}))
					)
				))
			];
			if (all.every((c) => c == null)) return null;
			return all.flatMap((c) => c ?? []).sort((a, b) => a.path.localeCompare(b.path));
		},

		async gitStashes(): Promise<GitStash[]> {
			await ready;
			const all = await Promise.all(
				['', ...(await nestedRepos())].map(async (repo) =>
					(await repoSync(repo).stashes()).map((s) => ({
						...s,
						repo,
						files: s.files.map((f) => ({ ...f, path: repo ? `${repo}/${f.path}` : f.path }))
					}))
				)
			);
			return all.flat().sort((a, b) => b.date - a.date);
		},
		gitStash: (paths, message) =>
			gitOp(async (nested) => {
				for (const [repo, rels] of byRepo(paths, nested))
					await repoSync(repo).stashPush(rels, message);
			}),
		gitStashApply: (repo, id, drop) =>
			gitOp(async (nested) => {
				if (repo && !nested.includes(repo)) throw new Error(`No repository at ${repo}.`);
				await repoSync(repo).stashApply(id, drop);
			}),
		gitStashDrop: (repo, id) =>
			gitOp(async (nested) => {
				if (repo && !nested.includes(repo)) throw new Error(`No repository at ${repo}.`);
				await repoSync(repo).stashDrop(id);
			}),
		gitRevert: (paths) =>
			gitOp(async (nested) => {
				for (const [repo, rels] of byRepo(paths, nested))
					for (const p of await repoSync(repo).revert(rels)) await trash(repo ? `${repo}/${p}` : p);
			}),

		async syncSetup(url, token) {
			if (!/^https:\/\/\S+$/i.test(url.trim()))
				return { ok: false, error: { code: 'no-remote', message: 'Use an HTTPS clone URL.' } };
			if (token.trim()) await SecureStorage.setItem(TOKEN_KEY, token.trim());
			return guarded(async () => {
				await git.connect(url.trim());
				return git.pull();
			});
		},
		async syncStatus() {
			await ready;
			return { remote: await git.remoteUrl(), hasToken: (await getToken()) !== null };
		},
		async syncForgetToken() {
			await SecureStorage.remove(TOKEN_KEY);
		},

		onBackButton(cb) {
			const handle = App.addListener('backButton', () => {
				if (!cb()) void App.exitApp();
			});
			return () => void handle.then((h) => h.remove());
		},

		onSyncConflict(cb) {
			conflictListeners.add(cb);
			return () => conflictListeners.delete(cb);
		},
		onSyncDone(cb) {
			doneListeners.add(cb);
			return () => doneListeners.delete(cb);
		},
		onNotesChanged(cb) {
			changeListeners.add(cb);
			return () => changeListeners.delete(cb);
		}
	};
}
