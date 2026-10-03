import type { ConflictFile, ResolveChoice, SyncErrorCode, SyncResult } from './types';

/**
 * Several git repos in one workspace: the root plus nested repos (e.g.
 * `private/` → your own server, `.fr5a/` → AI sessions). Each nested repo is
 * listed in the root's `.gitignore`, so its files can never reach the root's
 * remote. A sync walks the repos in order and stops at the first conflict;
 * conflict paths are prefixed with the repo folder so they read as workspace
 * paths, and resolve/abort go to whichever repo has the merge in progress.
 *
 * Shared by desktop (system git) and Android (isomorphic-git).
 */

export interface RepoSync {
	pull(): Promise<SyncResult>;
	push(): Promise<SyncResult>;
	resolve(choices: ResolveChoice[]): Promise<SyncResult>;
	abort(): Promise<void>;
	inMerge(): Promise<boolean>;
}

export interface Repo {
	/** Workspace-relative folder; '' is the root. */
	rel: string;
	sync: RepoSync;
	/** Pull-only (e.g. a skill pack cloned from someone else's repo): push just pulls. */
	readOnly?: boolean;
}

/** Skill packs cloned from git are someone else's repo: never pushed. */
export const isReadOnlyRepo = (rel: string) => rel.startsWith('.fr5a/skills/');

/** Deepest repos first, the root last (so its commit picks up .gitignore edits). */
export function syncOrder(rels: string[]): string[] {
	return [...rels].sort(
		(a, b) => (b ? b.split('/').length : 0) - (a ? a.split('/').length : 0) || a.localeCompare(b)
	);
}

/**
 * Which `.gitignore` gets which entries: every repo (root '' included) ignores
 * the repos directly inside it, as paths relative to itself.
 */
export function nestedIgnores(rels: string[]): { repo: string; entries: string[] }[] {
	const all = ['', ...rels.filter(Boolean)];
	const parentOf = (r: string) =>
		all
			.filter((p) => p !== r && (p === '' || r.startsWith(`${p}/`)))
			.sort((a, b) => b.length - a.length)[0] ?? '';
	const plan = new Map<string, string[]>();
	for (const r of all.slice(1)) {
		const parent = parentOf(r);
		const rel = parent ? r.slice(parent.length + 1) : r;
		plan.set(parent, [...(plan.get(parent) ?? []), rel]);
	}
	return [...plan].map(([repo, entries]) => ({ repo, entries }));
}

/**
 * The repo a workspace path belongs to (the deepest nested repo containing
 * it, else the root '') and the path relative to that repo.
 */
export function repoOf(path: string, rels: string[]): { repo: string; rel: string } {
	const repo =
		rels.filter((r) => r && path.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0] ?? '';
	return { repo, rel: repo ? path.slice(repo.length + 1) : path };
}

/** Workspace paths grouped by repo, each relative to its repo. */
export function byRepo(paths: string[], rels: string[]): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const p of paths) {
		const { repo, rel } = repoOf(p, rels);
		out.set(repo, [...(out.get(repo) ?? []), rel]);
	}
	return out;
}

type ErrorFactory = (code: SyncErrorCode, message: string) => Error;

/** Repos that can't sync (no remote / not set up) are skipped while another one works. */
const SKIPPABLE = new Set(['no-remote', 'not-a-repo', 'nothing-to-push']);

const codeOf = (e: unknown) => (e as { code?: string })?.code ?? 'git';

function prefixed(rel: string, r: SyncResult): SyncResult {
	if (r.status !== 'conflict' || !rel) return r;
	return {
		status: 'conflict',
		files: r.files.map((f: ConflictFile) => ({ ...f, path: `${rel}/${f.path}` }))
	};
}

export function createMultiSync(repos: Repo[], makeError: ErrorFactory) {
	const label = (rel: string) => rel || 'notes';

	async function each(op: (r: Repo) => Promise<SyncResult>): Promise<SyncResult> {
		const skipped: unknown[] = [];
		let done = 0;
		for (const repo of repos) {
			try {
				const r = await op(repo);
				if (r.status === 'conflict') return prefixed(repo.rel, r);
				done++;
			} catch (err) {
				if (SKIPPABLE.has(codeOf(err))) {
					skipped.push(err);
					continue;
				}
				if (repos.length === 1) throw err;
				const msg = err instanceof Error ? err.message : String(err);
				throw makeError(codeOf(err) as SyncErrorCode, `${label(repo.rel)}: ${msg}`);
			}
		}
		if (!done && skipped.length)
			throw skipped.find((e) => codeOf(e) === 'nothing-to-push') ?? skipped[0];
		return { status: 'ok' };
	}

	async function merging(): Promise<Repo | null> {
		for (const repo of repos) if (await repo.sync.inMerge().catch(() => false)) return repo;
		return null;
	}

	return {
		pull: () => each((r) => r.sync.pull()),
		push: () => each((r) => (r.readOnly ? r.sync.pull() : r.sync.push())),
		async resolve(choices: ResolveChoice[]): Promise<SyncResult> {
			const repo = (await merging()) ?? repos[0];
			const strip = repo.rel ? `${repo.rel}/` : '';
			const mine = choices
				.filter((c) => !strip || c.path.startsWith(strip))
				.map((c) => ({ ...c, path: c.path.slice(strip.length) }));
			return prefixed(repo.rel, await repo.sync.resolve(mine));
		},
		async abort(): Promise<void> {
			await ((await merging()) ?? repos[0]).sync.abort();
		}
	};
}

const IGNORE_HEADER = '# fr5a: nested sync repos (they push to their own remotes)';

/**
 * `.gitignore` text with every nested repo folder listed, or null when it
 * already is. Entries are anchored (`/private/`) so same-named subfolders
 * elsewhere are untouched.
 */
export function withNestedIgnored(gitignore: string, rels: string[]): string | null {
	const lines = gitignore.split(/\r?\n/).map((l) => l.trim());
	const missing = rels
		.filter(Boolean)
		.map((r) => `/${r.replace(/^\/+|\/+$/g, '')}/`)
		.filter((entry) => !lines.includes(entry) && !lines.includes(entry.slice(0, -1)));
	if (!missing.length) return null;
	let text = gitignore.replace(/\s*$/, '');
	if (!lines.includes(IGNORE_HEADER)) text += `${text ? '\n\n' : ''}${IGNORE_HEADER}`;
	return `${text}\n${missing.join('\n')}\n`;
}
