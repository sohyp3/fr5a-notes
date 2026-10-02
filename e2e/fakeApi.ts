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
	// AI harness: one local provider, in-memory state / secrets / `.fr5a/` files.
	const state: Record<string, unknown> = {
		ai: {
			providers: [
				{
					id: 'fake',
					name: 'Fake',
					baseUrl: 'http://fake/v1',
					model: 'm',
					local: true,
					tools: true,
					contextTokens: 8000
				}
			],
			defaultProvider: 'fake'
		}
	};
	const metaFiles: Record<string, string> = {};
	(window as unknown as { __meta: typeof metaFiles }).__meta = metaFiles;
	const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\ndata: [DONE]\n\n`;
	const call = (name: string, args: unknown) =>
		sse({
			choices: [
				{
					delta: {
						tool_calls: [
							{ index: 0, id: `c-${name}`, function: { name, arguments: JSON.stringify(args) } }
						]
					}
				}
			]
		});
	/**
	 * Scripted model: ask a question → propose an append to the open note →
	 * report the last tool result.
	 */
	const fakeModel = (body: string): string => {
		const { messages } = JSON.parse(body) as { messages: { role: string; content: string }[] };
		const last = messages[messages.length - 1];
		// "context?" → report which notes the system prompt carried.
		if (last.role === 'user' && last.content.includes('context?')) {
			const ids = [...messages[0].content.matchAll(/<note id="([^"]+)">/g)].map((m) => m[1]);
			return sse({ choices: [{ delta: { content: `ctx: ${ids.join(' | ')}` } }] });
		}
		if (last.role === 'user')
			return call('ask_user', { question: 'Which tone?', options: ['Formal', 'Casual'] });
		if (last.content.startsWith('User answered'))
			return call('write_note', { target: 'current', mode: 'append', content: 'AI line' });
		return sse({ choices: [{ delta: { content: `Done: ${last.content}` } }] });
	};
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
		getState: async (key: string) => state[key] ?? null,
		setState: async (key: string, value: unknown) => {
			state[key] = value;
		},
		httpFetch: async (req: { body?: string }) => ({
			status: 200,
			headers: {},
			body: fakeModel(req.body ?? '{}')
		}),
		httpStream: async (_id: string, req: { body?: string }, onChunk: (t: string) => void) => {
			const text = fakeModel(req.body ?? '{}');
			for (let i = 0; i < text.length; i += 16) onChunk(text.slice(i, i + 16));
			return { status: 200, headers: {}, body: '' };
		},
		httpAbort: async () => {},
		getSecret: async () => null,
		setSecret: async () => {},
		readMeta: async (rel: string) => metaFiles[rel] ?? null,
		writeMeta: async (rel: string, content: string) => {
			metaFiles[rel] = content;
		},
		listMeta: async (dir: string) =>
			Object.keys(metaFiles)
				.filter((k) => k.startsWith(`${dir}/`))
				.map((k) => k.slice(dir.length + 1)),
		deleteMeta: async (rel: string) => {
			delete metaFiles[rel];
		},
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
