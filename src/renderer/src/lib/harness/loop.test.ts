import { describe, expect, it } from 'vitest';
import { runLoop } from './loop';
import { createTools, type ToolDeps, type WriteProposal } from './tools';
import type { CompletionResult } from './openai';
import { DEFAULT_AI_CONFIG, type ChatMessage, type ProviderProfile } from './types';
import type { NoteMeta } from '../../../../shared/types';

const profile: ProviderProfile = {
	id: 'p',
	name: 'Cloud',
	baseUrl: 'https://x',
	model: 'm',
	local: false,
	tools: true,
	contextTokens: 32000
};

const note = (id: string, title: string): NoteMeta => ({
	id,
	absPath: `/w/${id}`,
	title,
	snippet: '',
	mtime: 0,
	tags: [],
	pinned: false,
	locked: false,
	aiLocal: false,
	encrypted: false
});

function deps(over: Partial<ToolDeps> = {}): ToolDeps {
	const files: Record<string, string> = { 'a.md': '# Alpha\nbody', 'private/s.md': '# Secret' };
	return {
		profile,
		config: { ...DEFAULT_AI_CONFIG, localOnlyFolders: ['private'] },
		notes: () => [note('a.md', 'Alpha'), note('private/s.md', 'Secret')],
		readNote: async (id) => files[id],
		ask: async () => ['B'],
		proposeWrite: async () => 'Applied',
		...over
	};
}

/** Scripted model: returns each canned result in turn, recording what it saw. */
function scripted(results: Partial<CompletionResult>[]) {
	const seen: ChatMessage[][] = [];
	let i = 0;
	return {
		seen,
		complete: async ({ messages }: { messages: ChatMessage[] }) => {
			seen.push(structuredClone(messages));
			return { content: '', toolCalls: [], finishReason: 'stop', ...results[i++] };
		}
	};
}

describe('runLoop', () => {
	it('runs tool calls, asks the user, and finishes with an answer', async () => {
		const writes: WriteProposal[] = [];
		const model = scripted([
			{
				toolCalls: [
					{ id: '1', name: 'read_note', arguments: '{"id":"a.md"}' },
					{ id: '2', name: 'ask_user', arguments: '{"question":"Which?","options":["A","B"]}' }
				]
			},
			{
				toolCalls: [
					{
						id: '3',
						name: 'write_note',
						arguments: '{"target":"new","mode":"append","content":"x"}'
					}
				]
			},
			{ content: 'All done' }
		]);
		const messages: ChatMessage[] = [
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: 'go' }
		];
		const tools = createTools(
			deps({
				proposeWrite: async (p) => {
					writes.push(p);
					return 'Applied as new note';
				}
			})
		);
		const outcome = await runLoop({
			profile,
			messages,
			tools,
			maxSteps: 5,
			complete: model.complete
		});
		expect(outcome).toBe('done');
		const toolMsgs = messages.filter((m) => m.role === 'tool').map((m) => m.content);
		expect(toolMsgs).toEqual(['# Alpha\nbody', 'User answered: B', 'Applied as new note']);
		expect(writes).toEqual([{ target: 'new', mode: 'append', content: 'x', title: undefined }]);
		expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'All done' });
		// The second request saw the tool results.
		expect(model.seen[1].some((m) => m.role === 'tool')).toBe(true);
	});

	it('refuses local-only notes to a remote provider and reports tool errors', async () => {
		const model = scripted([
			{
				toolCalls: [
					{ id: '1', name: 'read_note', arguments: '{"id":"private/s.md"}' },
					{ id: '2', name: 'nope', arguments: '{}' },
					{ id: '3', name: 'list_notes', arguments: '{bad' }
				]
			},
			{ content: 'ok' }
		]);
		const messages: ChatMessage[] = [{ role: 'system', content: 's' }];
		await runLoop({
			profile,
			messages,
			tools: createTools(deps()),
			maxSteps: 3,
			complete: model.complete
		});
		const results = messages.filter((m) => m.role === 'tool').map((m) => m.content);
		expect(results[0]).toMatch(/hidden from cloud AI/);
		expect(results[1]).toMatch(/Unknown tool/);
		expect(results[2]).toMatch(/Invalid JSON/);
	});

	it('stops at maxSteps', async () => {
		const loopCall = { toolCalls: [{ id: 'x', name: 'list_notes', arguments: '{}' }] };
		const model = scripted([loopCall, loopCall, loopCall]);
		const outcome = await runLoop({
			profile,
			messages: [{ role: 'system', content: 's' }],
			tools: createTools(deps()),
			maxSteps: 2,
			complete: model.complete
		});
		expect(outcome).toBe('max-steps');
	});

	it('searches notes by title first', async () => {
		const search = createTools(deps()).find((t) => t.def.name === 'search_notes')!;
		expect(await search.run({ query: 'alp' })).toMatch(/^- a\.md — Alpha/);
		expect(await search.run({ query: 'zzz' })).toBe('No matching notes.');
	});
});
