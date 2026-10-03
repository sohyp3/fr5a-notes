import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConflictFile, ResolveChoice, SyncErrorCode, SyncResult } from '../shared/types';

/**
 * Git sync for the workspace, driven through the system `git` CLI (no bundled
 * git library). It never rewrites history: no rebase, no force push, no hard
 * reset — a pull is always commit-then-merge, so local edits end up in a commit
 * before anything from the remote touches the working tree.
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
		if ((await revParse(theirs)) === null) return { status: 'ok' }; // remote branch not created yet
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
		if (merge.code === 0) return { status: 'ok' };
		const files = await conflicts();
		if (files.length > 0) return { status: 'conflict', files };
		const msg = (merge.stderr || merge.stdout).trim();
		throw new GitSyncError(classify(msg), msg || 'git merge failed');
	}

	/** Commit everything, pull (merge), then push. Stops at a conflict without pushing. */
	async function push(): Promise<SyncResult> {
		const pulled = await pull();
		if (pulled.status === 'conflict') return pulled;
		const { remote, branch } = await upstream();
		const head = await revParse('HEAD');
		const remoteHead = await revParse(`refs/remotes/${remote}/${branch}`);
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
				await run(['add', '--', choice.path]);
			}
		}
		const left = await unmergedPaths();
		if (left.length > 0) return { status: 'conflict', files: await conflicts() };
		await run([...(await identityArgs()), 'commit', '--no-edit', '--no-verify']);
		return { status: 'ok' };
	}

	/** Abandon an in-progress merge, restoring the pre-pull state. */
	async function abort(): Promise<void> {
		await ensureRepo();
		await run(['merge', '--abort']);
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

	return { push, pull, resolve, abort, inMerge, remoteUrl };
}

export type GitSync = ReturnType<typeof createGitSync>;
