import { describe, expect, it } from 'vitest';
import { blockedReason, folderPrivacy, isHidden, isLocalOnly } from './privacy';
import { buildSystemPrompt, estimateTokens, fitHistory, truncateToTokens } from './context';
import { canWriteCurrent, createTools, toolsForRun, type ToolDeps, type Tool } from './tools';
import { runLoop } from './loop';
import type { NoteMeta } from '../../../../shared/types';
import { expandMentions } from './mentions';
import { parseCanvas } from '../maps/canvas';
import { mapSummary } from './mapTools';
import { allowedTools, BUILTIN_SKILLS, loadSkillTree, parseSkill, serializeSkill } from './skills';
import { DEFAULT_AI_CONFIG, type ChatMessage, type ProviderProfile } from './types';

const remote: ProviderProfile = {
	id: 'r',
	name: 'Remote',
	baseUrl: 'https://x',
	model: 'm',
	local: false,
	tools: true,
	contextTokens: 1000
};
const config = { ...DEFAULT_AI_CONFIG, localOnlyFolders: ['private'] };

describe('privacy', () => {
	it('blocks local-only notes for remote providers only', () => {
		expect(isLocalOnly('private/a.md', '', config)).toBe(true);
		expect(isLocalOnly('private/deep/a.md', '', config)).toBe(true);
		expect(isLocalOnly('privateer/a.md', '', config)).toBe(false);
		expect(isLocalOnly('a.md', '# x\n<!-- ai: local -->', config)).toBe(true);
		expect(blockedReason('private/a.md', '', remote, config)).toMatch(/hidden from cloud AI/);
		expect(blockedReason('private/a.md', '', { ...remote, local: true }, config)).toBeNull();
		expect(blockedReason('a.md', 'hi', remote, config)).toBeNull();
	});

	it('says whether a folder is hidden itself or through a parent', () => {
		expect(folderPrivacy('private', ['private'])).toEqual({ via: 'self', folder: 'private' });
		expect(folderPrivacy('private/x', ['/private/'])).toEqual({ via: 'parent', folder: 'private' });
		expect(folderPrivacy('work', ['private'])).toBeNull();
		expect(isHidden({ id: 'work/a.md', aiLocal: true }, [])).toBe(true);
		expect(isHidden({ id: 'private/x/a.md' }, ['private'])).toBe(true);
		expect(isHidden({ id: 'a.md' }, ['private'])).toBe(false);
	});
});

describe('context', () => {
	const prompt = (
		tools: Tool[],
		opts: {
			readAll?: boolean;
			currentNoteAttached?: boolean;
			localProvider?: boolean;
			skillPrompt?: string;
		} = {}
	) =>
		buildSystemPrompt({
			tools,
			notes: [],
			noteBudget: 1000,
			readAll: opts.readAll ?? false,
			currentNoteAttached: opts.currentNoteAttached ?? false,
			localProvider: opts.localProvider ?? false,
			skillPrompt: opts.skillPrompt
		});

	it('describes exactly the tools selected for default, skill, web and tool-less provider runs', () => {
		const defaults = toolsForRun(null, toolDeps({ allowedNoteIds: new Set() }));
		const plain = prompt(defaults);
		expect(plain).toContain('write_note:');
		expect(plain).not.toContain('web_search:');
		expect(plain).toContain('The open/current note is not attached');
		expect(plain).toContain('Only the operations in Available tools can be called');
		const withWeb = toolsForRun(
			null,
			toolDeps({ search: async () => [], fetchPage: async () => '' })
		);
		const restricted = toolsForRun(
			BUILTIN_SKILLS.find((s) => s.name === 'summarize')!,
			toolDeps({ search: async () => [] })
		);
		expect(restricted.map((t) => t.def.name)).toEqual(['read_note']);
		expect(prompt(restricted)).not.toMatch(
			/write_note:|web_search:|ask_user:|Read a note before editing/
		);
		expect(prompt(withWeb)).toContain('web_search:');
		const noTools = toolsForRun(
			null,
			toolDeps({ profile: { ...remote, tools: false }, search: async () => [] })
		);
		expect(noTools).toEqual([]);
		expect(prompt(noTools)).toContain('No tools are available');
		for (const t of withWeb)
			expect(prompt(withWeb)).toContain(`- ${t.def.name}: ${t.def.description}`);
	});

	it('matches the effective Read all and open-note attachment permissions', async () => {
		const all = toolsForRun(null, toolDeps({ allowedNoteIds: null }));
		const allPrompt = prompt(all, { readAll: true, localProvider: false });
		expect(allPrompt).toContain('Read all notes is enabled');
		expect(allPrompt).toContain('Local-only notes are hidden from cloud providers');
		expect(all.find((t) => t.def.name === 'read_note')!.def.description).toContain('any note');
		expect(all.find((t) => t.def.name === 'list_notes')!.def.description).toContain(
			'workspace notes'
		);
		expect(all.find((t) => t.def.name === 'search_notes')!.def.description).toContain(
			'workspace notes'
		);
		expect(await all.find((t) => t.def.name === 'read_note')!.run({ id: 'public.md' })).toBe(
			'# public.md'
		);
		const attached = prompt(toolsForRun(null, toolDeps()), { currentNoteAttached: true });
		expect(attached).toContain('the attached open/current note');
		expect(attached).not.toContain('The open/current note is not attached');
		const detached = toolsForRun(null, toolDeps({ allowedNoteIds: new Set() }));
		expect(prompt(detached)).not.toContain('the attached open/current note');
		expect(
			await detached.find((t) => t.def.name === 'read_note')!.run({ id: 'public.md' })
		).toMatch(/wasn't mentioned/);
		expect(canWriteCurrent(false, { id: 'public.md' })).toBe(false);
		expect(canWriteCurrent(true, null)).toBe(false);
		expect(canWriteCurrent(true, { id: 'public.md' })).toBe(true);
		expect(canWriteCurrent(true, { id: null })).toBe(true); // attached unsaved draft
	});

	it('hands a tool-less provider the same empty list described in its prompt', async () => {
		const profile = { ...remote, tools: false };
		const tools = toolsForRun(null, toolDeps({ profile }));
		const messages: ChatMessage[] = [{ role: 'system', content: prompt(tools) }];
		let supplied: string[] | null = null;
		await runLoop({
			profile,
			tools,
			messages,
			maxSteps: 1,
			complete: async (request) => {
				supplied = request.tools?.map((t) => t.name) ?? [];
				return { content: 'Done', toolCalls: [], finishReason: 'stop', usage: null };
			}
		});
		expect(supplied).toEqual([]);
		expect(messages[0].content).toContain('No tools are available');
	});

	it('does not instruct built-in web skills to call unavailable tools', () => {
		for (const name of ['sources', 'fact-check']) {
			const skill = BUILTIN_SKILLS.find((s) => s.name === name)!;
			const noWeb = toolsForRun(skill, toolDeps());
			const text = prompt(noWeb, { skillPrompt: skill.prompt });
			expect(text).not.toMatch(/web_search|fetch_url/);
			expect(text).toContain('web search is unavailable');
			expect(
				prompt(
					toolsForRun(skill, toolDeps({ search: async () => [], fetchPage: async () => '' })),
					{ skillPrompt: skill.prompt }
				)
			).toContain('web_search:');
		}
	});
	it('estimates and truncates', () => {
		expect(estimateTokens('abcd'.repeat(10))).toBe(10);
		const cut = truncateToTokens('word '.repeat(1000), 50);
		expect(estimateTokens(cut)).toBeLessThan(70);
		expect(cut).toContain('truncated');
	});

	it('keeps system + newest messages and drops orphaned tool results', () => {
		const big = 'x'.repeat(400); // ~100 tokens
		const msgs: ChatMessage[] = [
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: big },
			{ role: 'assistant', content: null, tool_calls: [{ id: 'c', name: 't', arguments: '{}' }] },
			{ role: 'tool', tool_call_id: 'c', content: big },
			{ role: 'assistant', content: big },
			{ role: 'user', content: 'last' }
		];
		const kept = fitHistory(msgs, 230);
		expect(kept[0].role).toBe('system');
		expect(kept[1].role).not.toBe('tool');
		expect(kept.at(-1)).toEqual({ role: 'user', content: 'last' });
		expect(fitHistory(msgs, 100000)).toEqual(msgs);
	});
});

const meta = (id: string, overrides: Partial<NoteMeta> = {}): NoteMeta => ({
	id,
	absPath: `/w/${id}`,
	title: id,
	snippet: 'preview',
	tags: [],
	mtime: 0,
	pinned: false,
	locked: false,
	aiLocal: false,
	encrypted: false,
	...overrides
});

function toolDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
	return {
		profile: remote,
		config,
		notes: () => [meta('public.md'), meta('private/a.md'), meta('local.md', { aiLocal: true })],
		allowedNoteIds: new Set(['public.md']),
		readNote: async (id) => `# ${id}`,
		ask: async () => [],
		proposeWrite: async () => 'Applied',
		...overrides
	};
}

describe('note tool access', () => {
	it('exposes map operations only when enabled, and links never authorize note reads', async () => {
		const maps = {
			list: async () => ['Project'],
			read: async () =>
				mapSummary(
					'Project',
					JSON.stringify({
						nodes: [
							{ id: 'n', type: 'file', file: 'private/a.md', x: 0, y: 0, width: 200, height: 60 }
						],
						edges: []
					}),
					[meta('private/a.md')]
				),
			create: async () => 'proposed',
			edit: async () => 'proposed',
			delete: async () => 'proposed'
		};
		const tools = toolsForRun(null, toolDeps({ maps }));
		const call = (name: string, args: Record<string, unknown>) =>
			tools.find((t) => t.def.name === name)!.run(args);
		expect(await call('read_map', { name: 'Project' })).toContain('private/a.md');
		expect(await call('read_note', { id: 'private/a.md' })).toMatch(/wasn't mentioned/);
		expect(await call('delete_map', { name: '../private' })).toMatch(/Invalid map name/);
		expect(await call('list_maps', {})).toBe('["Project"]');
		const restricted = toolsForRun(
			BUILTIN_SKILLS.find((s) => s.name === 'summarize')!,
			toolDeps({ maps })
		);
		expect(restricted.map((t) => t.def.name)).toEqual(['read_note']);
		expect(
			buildSystemPrompt({
				tools,
				notes: [],
				noteBudget: 100,
				readAll: false,
				currentNoteAttached: false,
				localProvider: false
			})
		).toContain('list_maps:');
		expect(
			buildSystemPrompt({
				tools: restricted,
				notes: [],
				noteBudget: 100,
				readAll: false,
				currentNoteAttached: false,
				localProvider: false
			})
		).not.toContain('list_maps:');
	});
	it('does not expose unmentioned notes through discovery or reads', async () => {
		const tools = createTools(toolDeps());
		const call = (name: string, args: Record<string, unknown>) =>
			tools.find((t) => t.def.name === name)!.run(args);
		expect(await call('read_note', { id: 'private/a.md' })).toMatch(/wasn't mentioned/);
		expect(await call('read_note', { id: 'public.md' })).toBe('# public.md');
		expect(await call('list_notes', {})).toContain('public.md');
		expect(await call('list_notes', {})).not.toContain('private/a.md');
		expect(await call('search_notes', { query: 'private' })).toBe('No matching notes.');
		expect(await call('search_notes', { query: 'public' })).toContain('public.md');
		expect(await call('write_note', { target: 'private/a.md', content: 'x' })).toMatch(
			/Cannot change/
		);
		expect(await call('write_note', { target: 'public.md', content: 'x' })).toBe('Applied');
	});

	it('a real canvas file link does not add its note to the chat read/write allowlist', async () => {
		const canvas = parseCanvas(
			JSON.stringify({
				nodes: [
					{ id: 'node-1', type: 'file', file: 'linked.md', x: 0, y: 0, width: 200, height: 100 }
				],
				edges: []
			})
		);
		const linkedId = canvas.doc.nodes[0].file!;
		const notes = [meta('public.md'), meta(linkedId)];
		// The chat explicitly mentions public.md; a map node is not a chat mention.
		const mentioned = expandMentions(['public.md'], notes);
		const allowedNoteIds = new Set([...mentioned.ids, ...mentioned.groups.flatMap((g) => g.ids)]);
		const tools = createTools(toolDeps({ notes: () => notes, allowedNoteIds }));
		const run = (name: string, args: Record<string, unknown>) =>
			tools.find((t) => t.def.name === name)!.run(args);
		expect(linkedId).toBe('linked.md');
		expect(allowedNoteIds.has(linkedId)).toBe(false);
		expect(await run('read_note', { id: linkedId })).toMatch(/wasn't mentioned/);
		expect(await run('write_note', { target: linkedId, content: 'x' })).toMatch(/Cannot change/);
		expect(await run('search_notes', { query: 'linked' })).toBe('No matching notes.');
	});

	it('Read all still hides local-only metadata from cloud AI, but permits local providers', async () => {
		const cloud = createTools(toolDeps({ allowedNoteIds: null }));
		const local = createTools(
			toolDeps({ allowedNoteIds: null, profile: { ...remote, local: true } })
		);
		const invoke = (tools: typeof cloud, name: string, args: Record<string, unknown>) =>
			tools.find((t) => t.def.name === name)!.run(args);
		expect(await invoke(cloud, 'list_notes', {})).not.toContain('private/a.md');
		expect(await invoke(cloud, 'search_notes', { query: 'local' })).toBe('No matching notes.');
		expect(await invoke(cloud, 'read_note', { id: 'private/a.md' })).toMatch(
			/hidden from cloud AI/
		);
		expect(await invoke(cloud, 'write_note', { target: 'private/a.md', content: 'x' })).toMatch(
			/hidden from cloud AI/
		);
		expect(await invoke(cloud, 'write_note', { target: 'local.md', content: 'x' })).toMatch(
			/hidden from cloud AI/
		);
		expect(await invoke(local, 'read_note', { id: 'private/a.md' })).toBe('# private/a.md');
		expect(await invoke(local, 'write_note', { target: 'private/a.md', content: 'x' })).toBe(
			'Applied'
		);
	});
});

describe('skills', () => {
	it('round-trips built-ins and filters tools', () => {
		for (const s of BUILTIN_SKILLS)
			expect(parseSkill(`${s.name}.md`, serializeSkill(s))).toEqual(s);
		const all = [{ name: 'read_note' }, { name: 'web_search' }];
		const summarize = BUILTIN_SKILLS.find((s) => s.name === 'summarize')!;
		expect(allowedTools(summarize, all, (t) => t.name)).toEqual([{ name: 'read_note' }]);
		expect(allowedTools(null, all, (t) => t.name)).toEqual(all);
	});

	it('defaults name and output from the file', () => {
		const s = parseSkill('mine.md', 'Just a prompt');
		expect(s).toMatchObject({ name: 'mine', output: 'chat', tools: null, prompt: 'Just a prompt' });
	});
});

describe('loadSkillTree', () => {
	it('loads loose skills and git packs (SKILL.md folders), first name wins', async () => {
		const files: Record<string, string> = {
			'skills/mine.md': '---\nname: outline\ndescription: mine\n---\nmy prompt',
			'skills/pack/README.md': '# readme',
			'skills/pack/outline.md': '---\nname: outline\n---\nshadowed',
			'skills/pack/skills/pdf/SKILL.md': '---\nname: pdf\ndescription: PDFs\n---\nUse pdf tools',
			'skills/pack/skills/pdf/reference.md': 'not a skill',
			'skills/pack/.git/HEAD.md': 'ignored'
		};
		const fs = {
			async list(dir: string) {
				const kids = new Set<string>();
				for (const k of Object.keys(files)) {
					if (!k.startsWith(`${dir}/`)) continue;
					const rest = k.slice(dir.length + 1);
					kids.add(rest.includes('/') ? `${rest.split('/')[0]}/` : rest);
				}
				return [...kids];
			},
			read: async (p: string) => files[p] ?? null
		};
		const skills = await loadSkillTree(fs);
		expect(skills.map((s) => [s.name, s.prompt, s.source])).toEqual([
			['outline', 'my prompt', 'skills/mine.md'],
			['pdf', 'Use pdf tools', 'skills/pack/skills/pdf/SKILL.md']
		]);
	});
});
