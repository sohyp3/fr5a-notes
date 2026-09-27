import git, { Errors, type HttpClient, type PromiseFsClient } from 'isomorphic-git';
import type {
	ConflictFile,
	ResolveChoice,
	SyncErrorCode,
	SyncResult
} from '../../../../../shared/types';

/**
 * Git sync on top of isomorphic-git, for hosts without a git binary (Android).
 * Same contract as the desktop `main/gitSync.ts`: never rewrite history — a
 * pull is always commit-local-edits-then-merge, push is never forced, and a
 * conflicted merge is left pending for `resolve` / `abort`.
 *
 * `fs` and `http` are injected so the same code runs on Capacitor (device) and
 * on Node (tests, against a real bare repo).
 */

export class GitSyncError extends Error {
	constructor(
		readonly code: SyncErrorCode,
		message: string
	) {
		super(message);
		this.name = 'GitSyncError';
	}
}

export interface IsoGitDeps {
	fs: PromiseFsClient;
	http: HttpClient;
	/** Working-copy root as the fs client sees it. */
	dir: string;
	/** GitHub personal access token (HTTPS basic auth), if one is stored. */
	getToken(): Promise<string | null>;
}

const REMOTE = 'origin';
const DEFAULT_BRANCH = 'main';
/** Pending-merge bookkeeping (isomorphic-git has no MERGE_HEAD of its own). */
const MERGE_STATE = 'fr5a-merge.json';
const FALLBACK_AUTHOR = { name: 'fr5a', email: 'fr5a@localhost' };

interface MergeState {
	branch: string;
	ours: string;
	theirs: string;
	/** Conflicted paths not yet resolved. */
	paths: string[];
}

/** Map an isomorphic-git / transport failure onto the desktop error codes. */
export function classify(err: unknown): GitSyncError {
	if (err instanceof GitSyncError) return err;
	const e = err as { code?: string; data?: { statusCode?: number }; message?: string };
	const message = e?.message ?? String(err);
	if (e?.code === Errors.HttpError.code) {
		const status = e.data?.statusCode ?? 0;
		if (status === 401 || status === 403) return new GitSyncError('auth', message);
		if (status === 404) return new GitSyncError('no-remote', message);
		return new GitSyncError('network', message);
	}
	if (e?.code === Errors.UserCanceledError.code) return new GitSyncError('auth', message);
	if (e?.code === Errors.SmartHttpError.code) return new GitSyncError('network', message);
	if (/fetch|network|timed? ?out|ENOTFOUND|ECONNREFUSED|unable to resolve host/i.test(message))
		return new GitSyncError('network', message);
	return new GitSyncError('git', message);
}

export function createIsoGitSync({ fs, http, dir, getToken }: IsoGitDeps) {
	const gitdir = `${dir}/.git`;
	const cache = {};
	const base = { fs, dir, gitdir, cache };

	async function onAuth() {
		const token = await getToken();
		if (!token) return { cancel: true };
		// GitHub accepts a PAT as the basic-auth username.
		return { username: token, password: 'x-oauth-basic' };
	}
	const onAuthFailure = () => ({ cancel: true as const });
	const net = { http, onAuth, onAuthFailure };

	async function exists(p: string): Promise<boolean> {
		try {
			await fs.promises.stat(p);
			return true;
		} catch {
			return false;
		}
	}

	async function isRepo(): Promise<boolean> {
		return exists(gitdir);
	}

	async function ensureRepo(): Promise<void> {
		if (!(await isRepo()))
			throw new GitSyncError('not-a-repo', 'The notes folder is not a git repository.');
	}

	async function author() {
		const name = await git.getConfig({ ...base, path: 'user.name' });
		const email = await git.getConfig({ ...base, path: 'user.email' });
		return { name: name || FALLBACK_AUTHOR.name, email: email || FALLBACK_AUTHOR.email };
	}

	async function currentBranch(): Promise<string> {
		const b = await git.currentBranch({ ...base, fullname: false });
		if (!b) throw new GitSyncError('git', 'HEAD is detached; check out a branch to sync.');
		return b;
	}

	async function resolveRef(ref: string): Promise<string | null> {
		try {
			return await git.resolveRef({ ...base, ref });
		} catch {
			return null;
		}
	}

	async function ensureRemote(): Promise<void> {
		const remotes = await git.listRemotes({ ...base });
		if (!remotes.some((r) => r.remote === REMOTE))
			throw new GitSyncError('no-remote', 'No git remote is configured.');
	}

	// --- merge bookkeeping --------------------------------------------------

	async function readState(): Promise<MergeState | null> {
		try {
			const raw = await fs.promises.readFile(`${gitdir}/${MERGE_STATE}`, 'utf8');
			return JSON.parse(raw as string) as MergeState;
		} catch {
			return null;
		}
	}

	async function writeState(state: MergeState | null): Promise<void> {
		const p = `${gitdir}/${MERGE_STATE}`;
		if (state) await fs.promises.writeFile(p, JSON.stringify(state), 'utf8');
		else await fs.promises.unlink(p).catch(() => {});
	}

	async function blobAt(oid: string, filepath: string): Promise<string | null> {
		try {
			const { blob } = await git.readBlob({ ...base, oid, filepath });
			return new TextDecoder().decode(blob);
		} catch {
			return null;
		}
	}

	async function conflictsOf(state: MergeState): Promise<ConflictFile[]> {
		return Promise.all(
			state.paths.map(async (p) => ({
				path: p,
				mine: await blobAt(state.ours, p),
				theirs: await blobAt(state.theirs, p)
			}))
		);
	}

	/** Conflicted files of the pending merge (empty when none). */
	async function conflicts(): Promise<ConflictFile[]> {
		const state = await readState();
		return state ? conflictsOf(state) : [];
	}

	// --- working tree -------------------------------------------------------

	/** Stage everything (adds, edits, deletions) and commit; no-op on a clean tree. */
	async function commitAll(): Promise<void> {
		const rows = await git.statusMatrix({ ...base });
		const changed = rows.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1));
		if (changed.length === 0) return;
		for (const [filepath, , w] of changed) {
			if (w === 0) await git.remove({ ...base, filepath });
			else await git.add({ ...base, filepath });
		}
		const after = await git.statusMatrix({ ...base });
		const head = await resolveRef('HEAD');
		// Nothing staged differs from HEAD (e.g. an add then delete of an untracked file).
		if (head && after.every(([, h, , s]) => (h === 1 && s === 1) || (h === 0 && s === 0))) return;
		await git.commit({
			...base,
			message: `sync: ${new Date().toISOString()}`,
			author: await author()
		});
	}

	async function setUpstream(branch: string): Promise<void> {
		await git.setConfig({ ...base, path: `branch.${branch}.remote`, value: REMOTE });
		await git.setConfig({ ...base, path: `branch.${branch}.merge`, value: `refs/heads/${branch}` });
	}

	// --- operations ---------------------------------------------------------

	/**
	 * First-run setup: clone `url` into the (empty) notes folder. If notes
	 * already exist locally, or the remote is empty, init in place and point
	 * `origin` at `url` instead — the next pull merges the two histories.
	 */
	async function connect(url: string): Promise<void> {
		if (await isRepo()) {
			await git.setConfig({ ...base, path: `remote.${REMOTE}.url`, value: url });
			return;
		}
		// Refuse early (and without touching disk) when the URL or token is bad.
		let info: Awaited<ReturnType<typeof git.getRemoteInfo>>;
		try {
			info = await git.getRemoteInfo({ ...net, url });
		} catch (err) {
			throw classify(err);
		}
		const remoteHead = info.HEAD?.replace(/^refs\/heads\//, '');
		const remoteEmpty = !info.refs?.heads || Object.keys(info.refs.heads).length === 0;
		const local = (await fs.promises.readdir(dir).catch(() => [])) as string[];
		if (local.length === 0 && !remoteEmpty) {
			try {
				await git.clone({ ...base, ...net, url, singleBranch: true, ref: remoteHead });
			} catch (err) {
				await rmrf(gitdir);
				throw classify(err);
			}
			return;
		}
		await git.init({ ...base, defaultBranch: remoteHead || DEFAULT_BRANCH });
		await git.addRemote({ ...base, remote: REMOTE, url });
	}

	async function rmrf(p: string): Promise<void> {
		let st;
		try {
			st = await fs.promises.lstat(p);
		} catch {
			return;
		}
		if (st.isDirectory()) {
			for (const name of (await fs.promises.readdir(p)) as string[]) await rmrf(`${p}/${name}`);
			await fs.promises.rmdir(p);
		} else await fs.promises.unlink(p);
	}

	/** Commit local edits, fetch, merge the upstream branch (never rebase). */
	async function pull(): Promise<SyncResult> {
		await ensureRepo();
		const pending = await readState();
		if (pending) return { status: 'conflict', files: await conflictsOf(pending) };
		await ensureRemote();
		const branch = await currentBranch();
		await commitAll();
		try {
			await git.fetch({ ...base, ...net, remote: REMOTE, ref: branch, singleBranch: true });
		} catch (err) {
			// A brand-new empty remote has no branch to fetch yet.
			if ((err as { code?: string }).code === Errors.NotFoundError.code) return { status: 'ok' };
			throw classify(err);
		}
		const theirs = await resolveRef(`refs/remotes/${REMOTE}/${branch}`);
		if (!theirs) return { status: 'ok' };
		const ours = await resolveRef('HEAD');
		if (!ours) {
			// Unborn local branch (nothing written yet): adopt the remote branch.
			await git.writeRef({ ...base, ref: `refs/heads/${branch}`, value: theirs, force: true });
			await git.checkout({ ...base, ref: branch });
			await setUpstream(branch);
			return { status: 'ok' };
		}
		try {
			await git.merge({
				...base,
				ours: branch,
				theirs: `refs/remotes/${REMOTE}/${branch}`,
				abortOnConflict: false,
				allowUnrelatedHistories: true,
				author: await author(),
				message: `Merge ${REMOTE}/${branch} into ${branch}`
			});
		} catch (err) {
			if ((err as { code?: string }).code === Errors.MergeConflictError.code) {
				const paths = (err as InstanceType<typeof Errors.MergeConflictError>).data.filepaths;
				const state: MergeState = { branch, ours, theirs, paths };
				await writeState(state);
				return { status: 'conflict', files: await conflictsOf(state) };
			}
			throw classify(err);
		}
		// Local edits were committed above, so the tree matches the old HEAD and a
		// forced checkout only moves it to the merge result (merge may have
		// updated the index already, which a plain checkout would take as current).
		await git.checkout({ ...base, ref: branch, force: true });
		return { status: 'ok' };
	}

	/** Pull (merge), then push. Stops at a conflict without pushing; never forces. */
	async function push(): Promise<SyncResult> {
		const pulled = await pull();
		if (pulled.status === 'conflict') return pulled;
		const branch = await currentBranch();
		const head = await resolveRef('HEAD');
		const remoteHead = await resolveRef(`refs/remotes/${REMOTE}/${branch}`);
		if (head === null || head === remoteHead)
			throw new GitSyncError('nothing-to-push', 'Nothing to push — already up to date.');
		let res;
		try {
			res = await git.push({
				...base,
				...net,
				remote: REMOTE,
				ref: branch,
				remoteRef: branch,
				force: false
			});
		} catch (err) {
			throw classify(err);
		}
		if (!res.ok) throw new GitSyncError('git', res.error || 'Push was rejected.');
		await setUpstream(branch);
		return { status: 'ok' };
	}

	function safePath(p: string): string {
		const parts = p.split('/');
		if (!p || p.startsWith('/') || parts.some((s) => s === '..' || s === '' || s === '.git'))
			throw new GitSyncError('git', `${p} is outside the notes folder.`);
		return p;
	}

	async function mkdirp(p: string): Promise<void> {
		if (p === dir || (await exists(p))) return;
		await mkdirp(p.slice(0, p.lastIndexOf('/')));
		await fs.promises.mkdir(p).catch(() => {});
	}

	/** Write the chosen side (or manual content) per file; conclude the merge when none remain. */
	async function resolve(choices: ResolveChoice[]): Promise<SyncResult> {
		await ensureRepo();
		const state = await readState();
		if (!state) throw new GitSyncError('git', 'No merge is in progress.');
		const pending = new Set(state.paths);
		for (const choice of choices) {
			if (!pending.has(choice.path))
				throw new GitSyncError('git', `${choice.path} is not a conflicted file.`);
			const filepath = safePath(choice.path);
			const abs = `${dir}/${filepath}`;
			const content =
				'content' in choice
					? choice.content
					: await blobAt(choice.pick === 'mine' ? state.ours : state.theirs, filepath);
			if (content === null) {
				await fs.promises.unlink(abs).catch(() => {});
				await git.remove({ ...base, filepath });
			} else {
				await mkdirp(abs.slice(0, abs.lastIndexOf('/')));
				await fs.promises.writeFile(abs, content, 'utf8');
				await git.add({ ...base, filepath });
			}
			pending.delete(filepath);
		}
		if (pending.size > 0) {
			const next = { ...state, paths: [...pending] };
			await writeState(next);
			return { status: 'conflict', files: await conflictsOf(next) };
		}
		await git.commit({
			...base,
			message: `Merge ${REMOTE}/${state.branch} into ${state.branch}`,
			parent: [state.ours, state.theirs],
			author: await author()
		});
		await writeState(null);
		return { status: 'ok' };
	}

	/** Abandon the pending merge: restore the pre-merge (committed local) tree. */
	async function abort(): Promise<void> {
		await ensureRepo();
		const state = await readState();
		if (!state) throw new GitSyncError('git', 'No merge is in progress.');
		// Files the merge brought in (in theirs, not ours) and left untouched since.
		const ours = new Set(await git.listFiles({ ...base, ref: state.ours }));
		const added: string[] = [];
		for (const filepath of await git.listFiles({ ...base, ref: state.theirs })) {
			if (ours.has(filepath)) continue;
			const disk = await fs.promises.readFile(`${dir}/${filepath}`, 'utf8').catch(() => null);
			if (disk !== null && disk === (await blobAt(state.theirs, filepath))) added.push(filepath);
		}
		await git.checkout({ ...base, ref: state.branch, force: true });
		for (const filepath of added) {
			await git.remove({ ...base, filepath }).catch(() => {});
			await fs.promises.unlink(`${dir}/${filepath}`).catch(() => {});
		}
		await writeState(null);
	}

	/** `origin`'s URL, or null when not connected yet. */
	async function remoteUrl(): Promise<string | null> {
		if (!(await isRepo())) return null;
		return (await git.getConfig({ ...base, path: `remote.${REMOTE}.url` })) ?? null;
	}

	return { isRepo, connect, pull, push, resolve, abort, conflicts, remoteUrl };
}

export type IsoGitSync = ReturnType<typeof createIsoGitSync>;
