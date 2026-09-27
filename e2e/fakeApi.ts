/**
 * In-memory stand-in for the Electron preload bridge (`window.api`), installed
 * before the app boots. Runs in the page, so it must be self-contained.
 */
export function installFakeApi(): void {
	const files: Record<string, string> = {
		'Work/plan.md': '# Plan\n\nfirst line',
		'hello.md': '# Hello\n\nworld'
	};
	const writes: { id: string; content: string }[] = [];
	(window as unknown as { __writes: typeof writes }).__writes = writes;
	const meta = (id: string) => {
		const raw = files[id];
		const title = raw.split('\n')[0].replace(/^#+\s*/, '');
		return {
			id,
			absPath: `/notes/${id}`,
			title,
			snippet: raw.split('\n').slice(1).join(' ').trim(),
			mtime: 1,
			tags: [],
			pinned: false,
			locked: false
		};
	};
	const noop = () => () => {};
	const ok = async () => ({ ok: true, result: { status: 'ok' } });
	(window as unknown as { api: unknown }).api = {
		platform: 'linux',
		getWorkspace: async () => '/notes',
		pickWorkspace: async () => '/notes',
		listNotes: async () => Object.keys(files).map(meta),
		listTags: async () => [],
		listFolders: async () => ['Work'],
		listTrash: async () => [],
		readNote: async (id: string) => files[id],
		writeNote: async (id: string, content: string) => {
			files[id] = content;
			writes.push({ id, content });
		},
		createNote: async () => meta('hello.md'),
		deleteNote: async () => {},
		createFolder: async (name: string) => name,
		restoreNote: async (id: string) => id,
		permanentDelete: async () => {},
		getState: async () => null,
		setState: async () => {},
		minimize: async () => {},
		maximize: async () => {},
		close: async () => {},
		syncPull: ok,
		syncPush: ok,
		syncResolve: ok,
		syncAbort: ok,
		syncConflicts: async () => [],
		onSyncConflict: noop,
		onSyncDone: noop,
		onNotesChanged: noop
	};
}
