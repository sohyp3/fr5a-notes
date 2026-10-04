import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConflictFile, ResolveChoice, SyncErrorCode, SyncResult } from '../shared/types';

/**
 * Git sync for the workspace, driven through the system `git` CLI (no bundled
 * git library). It never rewrites pushed history: no rebase, no force push, no
 * hard reset — a pull is always commit-then-merge, so local edits end up in a
 * commit before anything from the remote touches the working tree. A push
 * sends the notes as they are at that moment: the app's own unpushed commits
 * are folded into one first (`squashUnpushed`), so an earlier state, like a
 * note before it was encrypted, never leaves the device.
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

/** Repo-relative path → its mtime before a merge; null when it wasn't on disk. */
type FileTimes = Record<string, number | null>;

/** File times kept across a merge stopped on conflicts (in the git dir, never synced). */
interface SavedTimes {
	theirs: string;
	times: FileTimes;
}
const TIMES_FILE = 'fr5a-mtimes.json';

interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

// Never block on a prompt (credentials, merge message editor) — the app has no terminal.
const GIT_ENV = {
	GIT_TERMINAL_PROMPT: '0',
	GIT_EDITOR: 'true',
	GIT_MERGE_AUTOEDIT: 'no',
	GIT_ASKPASS: '',
	SSH_ASKPASS: '',
	GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
	LC_ALL: 'C'
};

export function classify(stderr: string): SyncErrorCode {
	if (
		/Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey|Host key verification failed|returned error: 40[13]|access denied|invalid credentials/i.test(
			stderr
		)
	)
		return 'auth';
	if (
		/Could not resolve host|unable to access|Connection (refused|timed out)|Network is unreachable/i.test(
			stderr
		)
	)
		return 'network';
	if (/does not appear to be a git repository|No such remote|repository .* not found/i.test(stderr))
		return 'no-remote';
	return 'git';
}

export function createGitSync(root: string) {
	function run(args: string[], allowFail = false): Promise<RunResult> {
		return new Promise((resolve, reject) => {
			execFile(
				'git',
				args,
				{ cwd: root, env: { ...process.env, ...GIT_ENV }, maxBuffer: 64 * 1024 * 1024 },
				(err, stdout, stderr) => {
					const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
					if (e && e.code === 'ENOENT') {
						reject(new GitSyncError('no-git', 'git was not found on PATH.'));
						return;
					}
					const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0;
					if (code !== 0 && !allowFail) {
						const msg = (stderr || stdout || `git ${args[0]} failed`).trim();
						reject(new GitSyncError(classify(msg), msg));
						return;
					}
					resolve({ code, stdout, stderr });
				}
			);
		});
	}

	async function ensureRepo(): Promise<void> {
		const r = await run(['rev-parse', '--is-inside-work-tree'], true);
		if (r.code !== 0 || r.stdout.trim() !== 'true')
			throw new GitSyncError('not-a-repo', 'The notes folder is not a git repository.');
	}

	/** `-c user.*` fallbacks so committing works on machines with no git identity set. */
	async function identityArgs(): Promise<string[]> {
		const name = (await run(['config', 'user.name'], true)).stdout.trim();
		const email = (await run(['config', 'user.email'], true)).stdout.trim();
		const args: string[] = [];
		if (!name) args.push('-c', 'user.name=fr5a');
		if (!email) args.push('-c', 'user.email=fr5a@localhost');
		return args;
	}

	async function currentBranch(): Promise<string> {
		const r = await run(['symbolic-ref', '--short', 'HEAD'], true);
		if (r.code !== 0)
			throw new GitSyncError('git', 'HEAD is detached; check out a branch to sync.');
		return r.stdout.trim();
	}

	/** Where this branch syncs to: its configured upstream, else `origin/<branch>`. */
	async function upstream(): Promise<{ remote: string; branch: string }> {
		const local = await currentBranch();
		const remotes = (await run(['remote'])).stdout.split('\n').filter(Boolean);
		if (remotes.length === 0) throw new GitSyncError('no-remote', 'No git remote is configured.');
		const cfgRemote = (await run(['config', `branch.${local}.remote`], true)).stdout.trim();
		const cfgMerge = (await run(['config', `branch.${local}.merge`], true)).stdout.trim();
		const remote =
			cfgRemote && remotes.includes(cfgRemote)
				? cfgRemote
				: remotes.includes('origin')
					? 'origin'
					: remotes[0];
		const branch = cfgMerge ? cfgMerge.replace(/^refs\/heads\//, '') : local;
		return { remote, branch };
	}

	async function revParse(ref: string): Promise<string | null> {
		const r = await run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], true);
		return r.code === 0 ? r.stdout.trim() : null;
	}

	async function mergeInProgress(): Promise<boolean> {
		return (await revParse('MERGE_HEAD')) !== null;
	}

	async function unmergedPaths(): Promise<string[]> {
		const r = await run(['diff', '--name-only', '-z', '--diff-filter=U']);
		return r.stdout.split('\0').filter(Boolean);
	}

	/** Content of `file` at merge stage 2 (ours) or 3 (theirs); null when that side deleted it. */
	async function stage(file: string, n: 2 | 3): Promise<string | null> {
		const r = await run(['show', `:${n}:${file}`], true);
		return r.code === 0 ? r.stdout : null;
	}

	async function conflicts(): Promise<ConflictFile[]> {
		const files: ConflictFile[] = [];
		for (const p of await unmergedPaths()) {
			files.push({ path: p, mine: await stage(p, 2), theirs: await stage(p, 3) });
		}
		return files;
	}

	// --- file times ---------------------------------------------------------
	// A merge rewrites every file the remote changed, and the fresh mtime would
	// sort the note to the top of the list as if it had just been edited here.
	// So a pull keeps each file's time from before it; a file new to this device
	// gets the time of the last commit that changed it.

	const absOf = (p: string) => path.join(root, p);
	const statOf = (p: string) => fs.stat(absOf(p)).catch(() => null);

	/** Files that differ between two commits (every file of `b` when `a` is null). */
	async function changedFiles(a: string | null, b: string): Promise<string[]> {
		const r = a
			? await run(['diff', '--name-only', '-z', '--no-renames', a, b])
			: await run(['ls-tree', '-r', '--name-only', '-z', b]);
		return r.stdout.split('\0').filter(Boolean);
	}

	/** Times of the files a merge of `theirs` into `ours` may rewrite. */
	async function timesBefore(ours: string | null, theirs: string): Promise<FileTimes> {
		const paths = await changedFiles(ours, theirs);
		const stats = await Promise.all(paths.map(statOf));
		return Object.fromEntries(
			paths.map((p, i) => [p, stats[i]?.isFile() ? stats[i].mtimeMs : null])
		);
	}

	/** When each path was last changed in `ref`'s history (author time). */
	async function commitTimes(paths: string[], ref: string): Promise<Map<string, number>> {
		const out = new Map<string, number>();
		for (let i = 0; i < paths.length; i += 200) {
			const r = await run(
				[
					'--literal-pathspecs',
					'log',
					'-z',
					'--format=%x01%at',
					'--name-only',
					ref,
					'--',
					...paths.slice(i, i + 200)
				],
				true
			);
			// `\x01<time>\0\n<path>\0<path>\0` per commit, newest first.
			let at = 0;
			for (const token of r.stdout.split('\0')) {
				if (token.startsWith('\x01')) at = Number(token.slice(1)) * 1000;
				else {
					const p = token.replace(/^\n/, '');
					if (p && at && !out.has(p)) out.set(p, at);
				}
			}
		}
		return out;
	}

	async function setMtime(p: string, ms: number): Promise<void> {
		const st = await statOf(p);
		if (st) await fs.utimes(absOf(p), st.atime, ms / 1000).catch(() => {});
	}

	/**
	 * Put back the times from before a merge (`only`: just these paths); files
	 * the merge created get their last commit's time from `ref`.
	 */
	async function restoreTimes(times: FileTimes, ref: string, only?: string[]): Promise<void> {
		const fresh: string[] = [];
		for (const p of only ?? Object.keys(times)) {
			if (!(p in times)) continue;
			const now = await statOf(p);
			const before = times[p];
			if (!now?.isFile()) continue;
			if (before === null) fresh.push(p);
			else if (now.mtimeMs !== before) await setMtime(p, before);
		}
		if (fresh.length) for (const [p, at] of await commitTimes(fresh, ref)) await setMtime(p, at);
	}

	async function timesFile(): Promise<string> {
		return path.resolve(root, (await run(['rev-parse', '--git-path', TIMES_FILE])).stdout.trim());
	}

	async function saveTimes(saved: SavedTimes | null): Promise<void> {
		const file = await timesFile();
		if (saved) await fs.writeFile(file, JSON.stringify(saved), 'utf8');
		else await fs.rm(file, { force: true });
	}

	/** Times saved by the pull that started the merge in progress (not a merge begun elsewhere). */
	async function pendingTimes(): Promise<SavedTimes | null> {
		try {
			const saved = JSON.parse(await fs.readFile(await timesFile(), 'utf8')) as SavedTimes;
			return saved.theirs === (await revParse('MERGE_HEAD')) ? saved : null;
		} catch {
			return null;
		}
	}

	/** After a clone: every file gets the time of the last commit that changed it. */
	async function commitTimesAfterClone(): Promise<void> {
		const head = await revParse('HEAD');
		if (!head) return;
		const fresh = (await changedFiles(null, head)).map((p) => [p, null]);
		await restoreTimes(Object.fromEntries(fresh), head);
	}

	/** Stage everything and commit it as `sync: <timestamp>`; no-op on a clean tree. */
	async function commitAll(): Promise<void> {
		await run(['add', '-A']);
		const staged = await run(['diff', '--cached', '--quiet'], true);
		if (staged.code === 0) return;
		await run([
			...(await identityArgs()),
			'commit',
			'--no-verify',
			'-m',
			`sync: ${new Date().toISOString()}`
		]);
	}

	/**
	 * Commit local edits, fetch, and merge the upstream branch (never rebase).
	 * A merge that stops on conflicts is left in progress for `resolve`/`abort`.
	 * `allowUnrelated`: first sync of a folder that became a repo in place, whose
	 * history starts apart from the remote's.
	 */
	async function pull({ allowUnrelated = false } = {}): Promise<SyncResult> {
		await ensureRepo();
		if (await mergeInProgress()) {
			const files = await conflicts();
			if (files.length > 0) return { status: 'conflict', files };
			throw new GitSyncError('git', 'A merge is already in progress.');
		}
		const { remote, branch } = await upstream();
		await commitAll();
		await run(['fetch', '--quiet', remote]);
		const theirs = `refs/remotes/${remote}/${branch}`;
		const theirsOid = await revParse(theirs);
		if (theirsOid === null) return { status: 'ok' }; // remote branch not created yet
		const times = await timesBefore(await revParse('HEAD'), theirsOid);
		const merge = await run(
			[
				...(await identityArgs()),
				'merge',
				'--no-edit',
				'--no-verify',
				...(allowUnrelated ? ['--allow-unrelated-histories'] : []),
				theirs
			],
			true
		);
		if (merge.code === 0) {
			await restoreTimes(times, theirsOid);
			return { status: 'ok' };
		}
		const files = await conflicts();
		if (files.length > 0) {
			await saveTimes({ theirs: theirsOid, times });
			// Conflicted files get their old time back as each one is resolved.
			const conflicted = new Set(files.map((f) => f.path));
			const merged = Object.keys(times).filter((p) => !conflicted.has(p));
			await restoreTimes(times, theirsOid, merged);
			return { status: 'conflict', files };
		}
		const msg = (merge.stderr || merge.stdout).trim();
		throw new GitSyncError(classify(msg), msg || 'git merge failed');
	}

	/**
	 * Fold the unpushed commits into one on top of the remote branch, when they
	 * are all the app's own (`sync: …` commits and merges). Commits made by hand
	 * keep their history. Nothing is committed when the result equals the remote.
	 */
	async function squashUnpushed(remoteHead: string | null): Promise<void> {
		if (!remoteHead) return;
		if ((await run(['merge-base', '--is-ancestor', remoteHead, 'HEAD'], true)).code !== 0) return;
		const subjects = (await run(['log', '--format=%s', `${remoteHead}..HEAD`])).stdout
			.split('\n')
			.filter(Boolean);
		if (subjects.length < 2 || !subjects.every((s) => /^(sync: |Merge )/.test(s))) return;
		await run(['reset', '--soft', remoteHead]);
		if ((await run(['diff', '--cached', '--quiet'], true)).code === 0) return;
		await run([
			...(await identityArgs()),
			'commit',
			'--no-verify',
			'-m',
			`sync: ${new Date().toISOString()}`
		]);
	}

	/** Commit everything, pull (merge), fold the app's unpushed commits, then push. Stops at a conflict. */
	async function push(): Promise<SyncResult> {
		const pulled = await pull();
		if (pulled.status === 'conflict') return pulled;
		const { remote, branch } = await upstream();
		const remoteHead = await revParse(`refs/remotes/${remote}/${branch}`);
		await squashUnpushed(remoteHead);
		const head = await revParse('HEAD');
		if (head === null || head === remoteHead)
			throw new GitSyncError('nothing-to-push', 'Nothing to push — already up to date.');
		const local = await currentBranch();
		const hasUpstream = (await run(['config', `branch.${local}.merge`], true)).stdout.trim() !== '';
		await run(['push', ...(hasUpstream ? [] : ['-u']), remote, `HEAD:refs/heads/${branch}`]);
		return { status: 'ok' };
	}

	/** Write the chosen content for each conflicted file, stage it, and conclude the merge. */
	async function resolve(choices: ResolveChoice[]): Promise<SyncResult> {
		await ensureRepo();
		if (!(await mergeInProgress())) throw new GitSyncError('git', 'No merge is in progress.');
		const pending = new Set(await unmergedPaths());
		const saved = await pendingTimes();
		const absRoot = path.resolve(root);
		for (const choice of choices) {
			if (!pending.has(choice.path))
				throw new GitSyncError('git', `${choice.path} is not a conflicted file.`);
			const abs = path.resolve(absRoot, choice.path);
			if (!abs.startsWith(absRoot + path.sep))
				throw new GitSyncError('git', `${choice.path} is outside the notes folder.`);
			const content =
				'content' in choice
					? choice.content
					: await stage(choice.path, choice.pick === 'mine' ? 2 : 3);
			if (content === null) {
				await run(['rm', '--quiet', '--cached', '--ignore-unmatch', '--', choice.path]);
				await fs.rm(abs, { force: true });
			} else {
				await fs.mkdir(path.dirname(abs), { recursive: true });
				await fs.writeFile(abs, content, 'utf8');
				if (saved) await restoreTimes(saved.times, saved.theirs, [choice.path]);
				await run(['add', '--', choice.path]);
			}
		}
		const left = await unmergedPaths();
		if (left.length > 0) return { status: 'conflict', files: await conflicts() };
		await run([...(await identityArgs()), 'commit', '--no-edit', '--no-verify']);
		await saveTimes(null);
		return { status: 'ok' };
	}

	/** Abandon an in-progress merge, restoring the pre-pull state. */
	async function abort(): Promise<void> {
		await ensureRepo();
		const saved = await pendingTimes();
		await run(['merge', '--abort']);
		if (saved) {
			// Back to the times from before the pull (files it brought in are gone).
			const times = Object.entries(saved.times).filter(([, t]) => t !== null);
			await restoreTimes(Object.fromEntries(times), saved.theirs);
		}
		await saveTimes(null);
	}

	/** A merge is stopped awaiting resolve/abort (false when not a repo). */
	async function inMerge(): Promise<boolean> {
		const r = await run(['rev-parse', '--is-inside-work-tree'], true);
		return r.code === 0 && (await mergeInProgress());
	}

	/** URL of the remote this branch syncs to, or null. */
	async function remoteUrl(): Promise<string | null> {
		try {
			await ensureRepo();
			const { remote } = await upstream();
			return (await run(['remote', 'get-url', remote], true)).stdout.trim() || null;
		} catch {
			return null;
		}
	}

	return { push, pull, resolve, abort, inMerge, remoteUrl, commitTimesAfterClone };
}

export type GitSync = ReturnType<typeof createGitSync>;
