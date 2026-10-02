import { describe, expect, it } from 'vitest';
import { createMultiSync, withNestedIgnored, type RepoSync } from './multiSync';
import type { SyncErrorCode, SyncResult } from './types';

class E extends Error {
	constructor(
		readonly code: SyncErrorCode,
		msg: string
	) {
		super(msg);
	}
}

function repo(over: Partial<RepoSync> = {}, log: string[] = [], name = ''): RepoSync {
	const ok = async (): Promise<SyncResult> => ({ status: 'ok' });
	return {
		pull: async () => (log.push(`pull ${name}`), ok()),
		push: async () => (log.push(`push ${name}`), ok()),
		resolve: ok,
		abort: async () => {},
		inMerge: async () => false,
		...over
	};
}

describe('createMultiSync', () => {
	it('syncs every repo in order', async () => {
		const log: string[] = [];
		const m = createMultiSync(
			[
				{ rel: '', sync: repo({}, log, 'root') },
				{ rel: 'private', sync: repo({}, log, 'private') }
			],
			(c, msg) => new E(c, msg)
		);
		expect(await m.push()).toEqual({ status: 'ok' });
		expect(log).toEqual(['push root', 'push private']);
	});

	it('skips repos without a remote, but fails when none synced', async () => {
		const noRemote = repo({ pull: async () => Promise.reject(new E('no-remote', 'none')) });
		const m = createMultiSync(
			[
				{ rel: '', sync: noRemote },
				{ rel: 'private', sync: repo() }
			],
			(c, msg) => new E(c, msg)
		);
		expect(await m.pull()).toEqual({ status: 'ok' });
		const only = createMultiSync([{ rel: '', sync: noRemote }], (c, msg) => new E(c, msg));
		await expect(only.pull()).rejects.toMatchObject({ code: 'no-remote' });
	});

	it('names the repo in hard errors', async () => {
		const m = createMultiSync(
			[
				{ rel: '', sync: repo() },
				{
					rel: 'private',
					sync: repo({ pull: async () => Promise.reject(new E('auth', 'denied')) })
				}
			],
			(c, msg) => new E(c, msg)
		);
		await expect(m.pull()).rejects.toMatchObject({ code: 'auth', message: 'private: denied' });
	});

	it('prefixes conflicts and routes resolve to the merging repo', async () => {
		let resolved: unknown = null;
		const conflicted = repo({
			pull: async () => ({ status: 'conflict', files: [{ path: 'a.md', mine: '1', theirs: '2' }] }),
			inMerge: async () => true,
			resolve: async (c) => ((resolved = c), { status: 'ok' })
		});
		const log: string[] = [];
		const m = createMultiSync(
			[
				{ rel: 'private', sync: conflicted },
				{ rel: '', sync: repo({}, log, 'root') }
			],
			(c, msg) => new E(c, msg)
		);
		expect(await m.pull()).toEqual({
			status: 'conflict',
			files: [{ path: 'private/a.md', mine: '1', theirs: '2' }]
		});
		expect(log).toEqual([]); // stopped at the conflict
		await m.resolve([{ path: 'private/a.md', pick: 'mine' }]);
		expect(resolved).toEqual([{ path: 'a.md', pick: 'mine' }]);
	});
});

describe('withNestedIgnored', () => {
	it('adds anchored entries once', () => {
		const once = withNestedIgnored('node_modules\n', ['private', '.fr5a']);
		expect(once).toBe(
			'node_modules\n\n# fr5a: nested sync repos (they push to their own remotes)\n/private/\n/.fr5a/\n'
		);
		expect(withNestedIgnored(once!, ['private', '.fr5a'])).toBeNull();
		expect(withNestedIgnored('', ['x'])).toBe(
			'# fr5a: nested sync repos (they push to their own remotes)\n/x/\n'
		);
	});
});

describe('nested repo layout', () => {
	it('plans .gitignore entries per parent repo and orders deepest first', async () => {
		const { nestedIgnores, syncOrder, isReadOnlyRepo } = await import('./multiSync');
		expect(nestedIgnores(['private', '.fr5a', '.fr5a/skills/pack'])).toEqual([
			{ repo: '', entries: ['private', '.fr5a'] },
			{ repo: '.fr5a', entries: ['skills/pack'] }
		]);
		expect(syncOrder(['', 'private', '.fr5a/skills/pack', '.fr5a'])).toEqual([
			'.fr5a/skills/pack',
			'.fr5a',
			'private',
			''
		]);
		expect(isReadOnlyRepo('.fr5a/skills/pack')).toBe(true);
		expect(isReadOnlyRepo('.fr5a')).toBe(false);
	});

	it('pulls instead of pushing read-only repos', async () => {
		const log: string[] = [];
		const m = createMultiSync(
			[{ rel: '.fr5a/skills/p', sync: repo({}, log, 'pack'), readOnly: true }],
			(c, msg) => new E(c, msg)
		);
		await m.push();
		expect(log).toEqual(['pull pack']);
	});
});
