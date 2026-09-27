import type { ConflictFile, ResolveChoice, SyncResponse } from '../../../shared/types';

/** Friendly text for a failed sync call. */
export function syncErrorMessage(error: Extract<SyncResponse, { ok: false }>['error']): string {
	switch (error.code) {
		case 'no-git':
			return 'git is not installed or not on PATH.';
		case 'not-a-repo':
			return 'This notes folder is not a git repository.';
		case 'no-remote':
			return 'No git remote is set up for this notes folder.';
		case 'auth':
			return 'Authentication failed. Check your SSH key or git credential helper.';
		case 'network':
			return 'Could not reach the remote. Check your connection.';
		case 'nothing-to-push':
			return 'Nothing to push, already up to date.';
		case 'busy':
			return 'A sync is already running.';
		case 'no-workspace':
			return 'Open a notes folder first.';
		default:
			return error.message.split('\n')[0] || 'git failed.';
	}
}

// --- conflict window -------------------------------------------------------

export type ConflictPick = 'mine' | 'theirs' | 'manual';

export interface ConflictDraft {
	pick: ConflictPick;
	/** Textarea content used when `pick` is 'manual'. */
	manual: string;
}

/** Manual-edit starting point: both versions, fenced so the user sees which is which. */
export function prefillManual(file: ConflictFile): string {
	return `<<<<<<< mine\n${file.mine ?? ''}=======\n${file.theirs ?? ''}>>>>>>> theirs\n`;
}

export function initialDrafts(files: ConflictFile[]): Record<string, ConflictDraft> {
	return Object.fromEntries(
		files.map((f) => [f.path, { pick: 'mine' as ConflictPick, manual: prefillManual(f) }])
	);
}

export function toChoices(
	files: ConflictFile[],
	drafts: Record<string, ConflictDraft>
): ResolveChoice[] {
	return files.map((f) => {
		const d = drafts[f.path] ?? { pick: 'mine', manual: '' };
		return d.pick === 'manual'
			? { path: f.path, content: d.manual }
			: { path: f.path, pick: d.pick };
	});
}

type ConflictApi = Pick<Window['api'], 'syncResolve' | 'syncAbort'>;

/** Apply: resolve every file with its chosen side. Main closes the window and reloads notes. */
export async function applyConflicts(
	api: ConflictApi,
	files: ConflictFile[],
	drafts: Record<string, ConflictDraft>
): Promise<SyncResponse> {
	return api.syncResolve(toChoices(files, drafts));
}

/** Cancel: abort the merge, restoring the pre-pull state. */
export async function cancelConflicts(api: ConflictApi): Promise<SyncResponse> {
	return api.syncAbort();
}
