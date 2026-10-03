import { GitSyncError } from './gitSync';
import {
	workspaceRevert,
	workspaceStash,
	workspaceStashApply,
	workspaceStashDrop,
	workspaceStashes
} from './gitStash';
import { addRepo, findNestedRepos, listRepos, workspaceSync } from './repos';
import { Channels } from '../shared/types';
import type {
	ConflictFile,
	GitOpResponse,
	ResolveChoice,
	SyncResponse,
	SyncResult
} from '../shared/types';

/**
 * IPC surface for git sync. Kept free of `electron` imports so tests can drive
 * the real handlers with a stand-in `ipcMain` against a temp repo.
 */

/** The subset of `ipcMain` used here. */
export interface IpcLike {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors ipcMain.handle
	handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
}

export interface SyncIpcDeps {
	/** Current workspace root, or null when no folder is open. */
	getRoot(): string | null;
	/** Push an event to the main window's renderer. */
	emit(channel: string, ...args: unknown[]): void;
	/** A pull/push stopped on conflicts — open the conflict window. */
	openConflicts(files: ConflictFile[]): void;
	/** The merge was resolved or aborted — close the conflict window. */
	closeConflicts(): void;
	/** Move a note to the trash (reverting a note the last commit doesn't have). */
	trash(id: string): Promise<void>;
}

export function registerSyncHandlers(ipc: IpcLike, deps: SyncIpcDeps) {
	let busy = false;
	/** Files of the merge currently awaiting resolve/abort, if any. */
	let pending: ConflictFile[] | null = null;

	async function guarded(op: () => Promise<SyncResult | void>): Promise<SyncResponse> {
		const root = deps.getRoot();
		if (!root)
			return { ok: false, error: { code: 'no-workspace', message: 'No notes folder is open.' } };
		if (busy) return { ok: false, error: { code: 'busy', message: 'A sync is already running.' } };
		busy = true;
		try {
			const result = (await op()) ?? { status: 'ok' };
			if (result.status === 'conflict') {
				pending = result.files;
				deps.emit(Channels.syncConflict, result.files);
				deps.openConflicts(result.files);
			} else {
				const hadConflicts = pending !== null;
				pending = null;
				if (hadConflicts) deps.closeConflicts();
				deps.emit(Channels.syncDone);
			}
			return { ok: true, result };
		} catch (err) {
			if (err instanceof GitSyncError)
				return { ok: false, error: { code: err.code, message: err.message } };
			return {
				ok: false,
				error: { code: 'git', message: err instanceof Error ? err.message : String(err) }
			};
		} finally {
			busy = false;
		}
	}

	// The root repo plus any nested repos (each with its own remote).
	const sync = () => workspaceSync(deps.getRoot()!);

	const pull = () => guarded(async () => (await sync()).pull());
	const push = () => guarded(async () => (await sync()).push());
	const resolve = (choices: ResolveChoice[]) =>
		guarded(async () => (await sync()).resolve(choices));
	const abort = () => guarded(async () => (await sync()).abort());

	ipc.handle(Channels.syncPull, pull);
	ipc.handle(Channels.syncPush, push);
	ipc.handle(Channels.syncResolve, (_e, choices: ResolveChoice[]) => resolve(choices));
	ipc.handle(Channels.syncAbort, abort);
	ipc.handle(Channels.syncConflicts, () => pending ?? []);
	// Give a folder its own repo (clone into it, or init in place) and sync it once.
	ipc.handle(Channels.syncAddRepo, (_e, folder: string, url: string) =>
		guarded(() => addRepo(deps.getRoot()!, folder, url))
	);
	// Stash / revert (Changes view): one git op at a time, sharing the sync lock.
	async function exclusive(
		op: (root: string, nested: string[]) => Promise<string[] | void>
	): Promise<GitOpResponse> {
		const root = deps.getRoot();
		if (!root) return { ok: false, error: 'No notes folder is open.' };
		if (busy) return { ok: false, error: 'A sync is running — try again in a moment.' };
		busy = true;
		try {
			const conflicts = await op(root, await findNestedRepos(root));
			return conflicts?.length ? { ok: true, conflicts } : { ok: true };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		} finally {
			busy = false;
		}
	}

	ipc.handle(Channels.gitStashes, async () => {
		const root = deps.getRoot();
		return root ? workspaceStashes(root, await findNestedRepos(root)) : [];
	});
	ipc.handle(Channels.gitStash, (_e, paths: string[], message: string) =>
		exclusive((root, nested) => workspaceStash(root, nested, paths, message))
	);
	ipc.handle(Channels.gitStashApply, (_e, repo: string, id: string, drop: boolean) =>
		exclusive((root, nested) => workspaceStashApply(root, nested, repo, id, drop))
	);
	ipc.handle(Channels.gitStashDrop, (_e, repo: string, id: string) =>
		exclusive((root, nested) => workspaceStashDrop(root, nested, repo, id))
	);
	ipc.handle(Channels.gitRevert, (_e, paths: string[]) =>
		exclusive(async (root, nested) => {
			for (const id of await workspaceRevert(root, nested, paths)) await deps.trash(id);
		})
	);

	ipc.handle(Channels.syncRepos, () => {
		const root = deps.getRoot();
		return root ? listRepos(root) : [];
	});

	return {
		/** Abort the pending merge if one is still open (conflict window closed via its frame). */
		async abortPending(): Promise<void> {
			if (pending) await abort();
		}
	};
}
