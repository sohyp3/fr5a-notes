import { describe, expect, it, vi } from 'vitest';
import { createTools } from './tools';
import { DEFAULT_AI_CONFIG } from './types';
import type { ToolDeps } from './tools';
import type { NoteMeta } from '../../../../shared/types';

const note = (id: string, extra: Partial<NoteMeta> = {}): NoteMeta => ({
	id,
	absPath: `/notes/${id}`,
	title: id,
	snippet: 'sample',
	tags: [],
	mtime: 0,
	pinned: false,
	locked: false,
	encrypted: false,
	aiLocal: false,
	...extra
});

function setup(local = false, all = false) {
	const proposeEdit = vi.fn(async () => 'Edited');
	const proposeDelete = vi.fn(async () => 'Moved to Trash');
	const deps: ToolDeps = {
		profile: {
			id: 'x',
			name: 'Test',
			baseUrl: '',
			model: 'x',
			tools: true,
			contextTokens: 1000,
			local
		},
		config: { ...DEFAULT_AI_CONFIG, localOnlyFolders: ['private'] },
		notes: () => [
			note('public.md'),
			note('private/x.md'),
			note('locked.md', { locked: true }),
			note('encrypted.md', { encrypted: true }),
			note('marker.md', { aiLocal: true })
		],
		allowedNoteIds: all ? null : new Set(['public.md']),
		readNote: async () => '',
		ask: async () => [],
		proposeWrite: async () => '',
		proposeEdit,
		proposeDelete
	};
	const tools = createTools(deps);
	const run = (name: string, args: Record<string, unknown>) =>
		tools.find((t) => t.def.name === name)!.run(args);
	return { run, proposeEdit, proposeDelete };
}

describe('edit and delete tool access', () => {
	it('cannot edit or delete unmentioned or hidden notes, including map-linked paths', async () => {
		const { run, proposeEdit, proposeDelete } = setup();
		expect(await run('edit_note', { target: 'private/x.md', oldText: 'a', newText: 'b' })).toMatch(
			/wasn't mentioned/
		);
		expect(await run('delete_note', { id: 'private/x.md' })).toMatch(/wasn't mentioned/);
		expect(await run('delete_note', { id: 'missing.md' })).toMatch(/wasn't mentioned/);
		expect(proposeEdit).not.toHaveBeenCalled();
		expect(proposeDelete).not.toHaveBeenCalled();
	});

	it('validates exact edit parameters and routes eligible proposals', async () => {
		const { run, proposeEdit, proposeDelete } = setup();
		expect(await run('edit_note', { target: 'public.md', oldText: '', newText: 'x' })).toMatch(
			/Not edited/
		);
		expect(await run('edit_note', { target: 'public.md', oldText: 'before', newText: '' })).toBe(
			'Edited'
		);
		expect(proposeEdit).toHaveBeenCalledWith({
			target: 'public.md',
			oldText: 'before',
			newText: ''
		});
		expect(await run('delete_note', { id: 'public.md' })).toBe('Moved to Trash');
		expect(proposeDelete).toHaveBeenCalledWith('public.md');
	});

	it('blocks cloud privacy and locked/encrypted notes even with Read all', async () => {
		const { run, proposeDelete } = setup(false, true);
		for (const id of ['private/x.md', 'marker.md', 'locked.md', 'encrypted.md']) {
			expect(await run('edit_note', { target: id, oldText: 'a', newText: 'b' })).toMatch(
				/Cannot change/
			);
			expect(await run('delete_note', { id })).toMatch(/Cannot change/);
		}
		expect(proposeDelete).not.toHaveBeenCalled();
		const local = setup(true, true);
		expect(await local.run('delete_note', { id: 'private/x.md' })).toBe('Moved to Trash');
		expect(await local.run('delete_note', { id: 'locked.md' })).toMatch(/locked/);
	});
});
