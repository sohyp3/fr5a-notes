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
	// "Last commit": git status compares the files against this snapshot.
	const committed: Record<string, string> = { ...files };
	(window as unknown as { __writes: typeof writes }).__writes = writes;
	const meta = (id: string) => {
		const raw = files[id] ?? trash[id];
		const encrypted = raw.includes('-----BEGIN PGP MESSAGE-----');
		const title = encrypted
			? id.replace(/^.*\//, '').replace(/\.md$/, '')
			: raw.split('\n')[0].replace(/^#+\s*/, '');
		return {
			id,
			absPath: `/notes/${id}`,
			title,
			snippet: encrypted ? '' : raw.split('\n').slice(1).join(' ').trim(),
			mtime: 1,
			tags: [],
			pinned: false,
			locked: false,
			aiLocal: /^<!-- ai: local -->$/m.test(raw),
			encrypted
		};
	};
	const folders = new Set(['Work']);
	const parentDirs = (p: string) => {
		const segs = p.split('/');
		for (let i = 1; i < segs.length; i++) folders.add(segs.slice(0, i).join('/'));
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
	const secrets: Record<string, string> = {};
	(window as unknown as { __meta: typeof metaFiles }).__meta = metaFiles;
	// Every reply reports its tokens in a last chunk, like `stream_options.include_usage`.
	const sse = (obj: unknown, usage: object = { prompt_tokens: 1200, completion_tokens: 34 }) =>
		`data: ${JSON.stringify(obj)}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`;
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
		const say = (content: string) => sse({ choices: [{ delta: { content } }] });
		// "context?" → report which notes the system prompt carried.
		if (last.role === 'user' && last.content.includes('context?')) {
			const ids = [...messages[0].content.matchAll(/<note id="([^"]+)">/g)].map((m) => m[1]);
			return say(`ctx: ${ids.join(' | ')}`);
		}
		// "cost?" → the provider reports a cost too (as OpenRouter does).
		if (last.role === 'user' && last.content.includes('cost?'))
			return sse(
				{ choices: [{ delta: { content: 'Priced reply' } }] },
				{ prompt_tokens: 1500, completion_tokens: 50, cost: 0.0021 }
			);
		// "md?" → a Markdown reply, with raw HTML that must stay text.
		if (last.role === 'user' && last.content.includes('md?'))
			return say(
				'# Title\n\n- **bold** item\n- [link](https://example.com)\n\n```json\n{"a": 1}\n```\n\n<img src=x onerror="window.__xss=1">'
			);
		// "long?" → a reply long enough to scroll.
		if (last.role === 'user' && last.content.includes('long?'))
			return say(Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n\n'));
		// "multi?" → several questions in one ask_user call.
		if (last.role === 'user' && last.content.includes('multi?'))
			return call('ask_user', {
				questions: [
					{
						question: 'Who is it for?',
						header: 'Audience',
						options: [{ label: 'Team', description: 'internal readers' }, { label: 'Public' }]
					},
					{
						question: 'Which sections?',
						header: 'Sections',
						options: ['Intro', 'Body'],
						multiSelect: true
					}
				]
			});
		if (last.role === 'user')
			return call('ask_user', { question: 'Which tone?', options: ['Formal', 'Casual'] });
		if (last.content.startsWith('User answered:\n')) return say(`Done: ${last.content}`);
		if (last.content.startsWith('User answered'))
			return call('write_note', { target: 'current', mode: 'append', content: 'AI line' });
		return say(`Done: ${last.content}`);
	};
	/** "flaky?" fails the first request like a dropped connection. */
	let flaky = 0;
	const maybeFail = (body: string) => {
		if (body.includes('flaky?') && flaky++ === 0) throw new Error('net::ERR_INTERNET_DISCONNECTED');
	};
	const trash: Record<string, string> = { '.fr5a_trash/old.md': '# Old\n\ngone soon' };
	const deleted: string[] = [];
	(window as unknown as { __deleted: string[] }).__deleted = deleted;
	/** Notes moved to the trash (deleteNote). */
	const trashed: string[] = [];
	(window as unknown as { __trashed: string[] }).__trashed = trashed;
	const ok = async () => ({ ok: true, result: { status: 'ok' } });
	/** git status: notes that differ from the last commit. */
	const changesNow = () =>
		[...new Set([...Object.keys(files), ...Object.keys(committed)])]
			.filter((p) => files[p] !== committed[p])
			.sort()
			.map((p) => ({
				path: p,
				status: !(p in committed) ? 'added' : !(p in files) ? 'deleted' : 'modified',
				before: committed[p] ?? null,
				after: files[p] ?? null
			}));
	type Change = ReturnType<typeof changesNow>[number];
	const stashes: { repo: string; id: string; message: string; date: number; files: Change[] }[] =
		[];
	/** Put a note back to its committed text (or remove it when the commit lacks it). */
	const restore = (p: string) => {
		if (p in committed) files[p] = committed[p];
		else delete files[p];
	};
	(window as unknown as { api: unknown }).api = {
		platform: 'linux',
		getWorkspace: async () => '/notes',
		pickWorkspace: async () => '/notes',
		listNotes: async () => Object.keys(files).map(meta),
		listTags: async () => [],
		listFolders: async () => [...folders].sort(),
		listTrash: async () => Object.keys(trash).map(meta),
		readNote: async (id: string) => files[id],
		writeNote: async (id: string, content: string) => {
			files[id] = content;
			writes.push({ id, content });
		},
		createNote: async (title?: string, folder = '', content?: string) => {
			// Drafts in the existing tests only need some note back.
			if (!title) return meta('hello.md');
			let id = folder ? `${folder}/${title}.md` : `${title}.md`;
			for (let n = 2; id in files; n++)
				id = folder ? `${folder}/${title} ${n}.md` : `${title} ${n}.md`;
			files[id] = content ?? `# ${title}\n\n`;
			if (folder) parentDirs(`${folder}/x`);
			return meta(id);
		},
		deleteNote: async (id: string) => {
			trashed.push(id);
		},
		createFolder: async (name: string, parent = '') => {
			const rel = parent ? `${parent}/${name}` : name;
			folders.add(rel);
			return rel;
		},
		moveNote: async (id: string, to: string) => {
			const dest = /\.md$/.test(to) ? to : `${to}.md`;
			if (dest in files) throw new Error('taken');
			files[dest] = files[id];
			delete files[id];
			parentDirs(dest);
			return dest;
		},
		moveFolder: async (dir: string, to: string) => {
			if (folders.has(to)) throw new Error(`“${to}” already exists.`);
			const moved = (p: string) =>
				p === dir || p.startsWith(`${dir}/`) ? to + p.slice(dir.length) : p;
			for (const id of Object.keys(files)) {
				const next = moved(id);
				if (next === id) continue;
				files[next] = files[id];
				delete files[id];
			}
			for (const f of [...folders]) {
				folders.delete(f);
				folders.add(moved(f));
			}
			parentDirs(`${to}/x`);
			return to;
		},
		deleteFolder: async (dir: string) => {
			const inside = (p: string) => p === dir || p.startsWith(`${dir}/`);
			for (const id of Object.keys(files)) {
				if (!inside(id)) continue;
				trash[`.fr5a_trash/${id}`] = files[id];
				delete files[id];
			}
			for (const f of [...folders]) if (inside(f)) folders.delete(f);
		},
		restoreNote: async (id: string) => {
			const to = id.replace('.fr5a_trash/', '');
			files[to] = trash[id];
			delete trash[id];
			return to;
		},
		permanentDelete: async (id: string) => {
			deleted.push(id);
			delete trash[id];
		},
		getState: async (key: string) => state[key] ?? null,
		setState: async (key: string, value: unknown) => {
			state[key] = value;
		},
		httpFetch: async (req: { url: string; body?: string }) => ({
			status: 200,
			headers: {},
			body: req.url.endsWith('/models')
				? JSON.stringify({ data: [{ id: 'big-pickle' }, { id: 'gpt-5-nano' }, { id: 'm' }] })
				: fakeModel(req.body ?? '{}')
		}),
		httpStream: async (_id: string, req: { body?: string }, onChunk: (t: string) => void) => {
			maybeFail(req.body ?? '');
			const text = fakeModel(req.body ?? '{}');
			for (let i = 0; i < text.length; i += 16) onChunk(text.slice(i, i + 16));
			return { status: 200, headers: {}, body: '' };
		},
		httpAbort: async () => {},
		getSecret: async (name: string) => secrets[name] ?? null,
		setSecret: async (name: string, value: string | null) => {
			if (value) secrets[name] = value;
			else delete secrets[name];
		},
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
		gitChanges: async () => changesNow(),
		gitStash: async (paths: string[], message: string) => {
			const held = changesNow().filter((c) => paths.includes(c.path));
			stashes.unshift({
				repo: '',
				id: `s${stashes.length + 1}`,
				message,
				date: Date.now(),
				files: held
			});
			for (const c of held) restore(c.path);
			return { ok: true };
		},
		gitStashes: async () => stashes.map((s) => ({ ...s })),
		gitStashApply: async (_repo: string, id: string, drop: boolean) => {
			const s = stashes.find((x) => x.id === id);
			if (!s) return { ok: false, error: 'That stash no longer exists.' };
			for (const c of s.files)
				if (c.after === null) delete files[c.path];
				else files[c.path] = c.after;
			if (drop) stashes.splice(stashes.indexOf(s), 1);
			return { ok: true };
		},
		gitStashDrop: async (_repo: string, id: string) => {
			stashes.splice(
				stashes.findIndex((x) => x.id === id),
				1
			);
			return { ok: true };
		},
		gitRevert: async (paths: string[]) => {
			for (const p of paths) {
				if (!(p in committed)) trashed.push(p);
				restore(p);
			}
			return { ok: true };
		},
		onSyncConflict: noop,
		onSyncDone: noop,
		onNotesChanged: noop
	};
}
