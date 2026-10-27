import { beforeEach, describe, expect, it, vi } from 'vitest';

const { app, files } = vi.hoisted(() => {
	const files = new Map<string, string>();
	const app = {
		notes: [{ id: 'a.md', title: 'A', locked: false, encrypted: false }],
		activeId: null as string | null,
		activeContent: '',
		editor: null as null | {
			text: string;
			commands: { setContent: (text: string, options: unknown) => void };
		},
		aiBlocksActive: false,
		confirm: vi.fn(async () => true),
		confirmRequest: null as null | object,
		answerConfirm: vi.fn(),
		deleteNote: vi.fn(async (id: string) => {
			files.delete(id);
		}),
		flush: vi.fn(async () => {}),
		refresh: vi.fn(async () => {})
	};
	return { app, files };
});
vi.mock('../stores/app.svelte', () => ({ getAppState: () => app }));
vi.mock('../editor/markdown', () => ({
	docToText: (editor: { text: string }) => editor.text,
	textToDoc: (text: string) => text,
	detectLocked: (text: string) => text.includes('<!-- locked -->')
}));
vi.mock('../platform', () => ({
	platform: {
		readNote: async (id: string) => {
			if (!files.has(id)) throw new Error('Missing note');
			return files.get(id)!;
		},
		writeNote: async (id: string, text: string) => {
			files.set(id, text);
		}
	}
}));

import { prepareDelete, prepareEdit } from './apply';

beforeEach(() => {
	files.clear();
	files.set('a.md', '# A\nhello world');
	app.notes = [{ id: 'a.md', title: 'A', locked: false, encrypted: false }];
	app.activeId = null;
	app.editor = null;
	app.confirm.mockClear();
	app.deleteNote.mockClear();
});

describe('approved note changes', () => {
	it('edits exactly one occurrence without replacing the rest', async () => {
		const edit = await prepareEdit({ target: 'a.md', oldText: 'hello', newText: 'goodbye' });
		expect(edit.after).toBe('# A\ngoodbye world');
		expect(await edit.apply()).toBe('Edited a.md');
		expect(files.get('a.md')).toBe('# A\ngoodbye world');
		await expect(prepareEdit({ target: 'a.md', oldText: 'missing', newText: 'x' })).rejects.toThrow(
			'occur once'
		);
		files.set('a.md', 'hello hello');
		await expect(prepareEdit({ target: 'a.md', oldText: 'hello', newText: 'x' })).rejects.toThrow(
			'occur once'
		);
	});

	it('refuses changes after approval when the source changed or vanished', async () => {
		const edit = await prepareEdit({ target: 'a.md', oldText: 'hello', newText: 'bye' });
		files.set('a.md', '# A\nuser edit');
		await expect(edit.apply()).rejects.toThrow('changed since review');
		expect(files.get('a.md')).toBe('# A\nuser edit');
		const deletion = await prepareDelete('a.md');
		files.delete('a.md');
		app.notes = [];
		await expect(deletion.apply()).rejects.toThrow('no longer exists');
	});

	it('requires destructive confirmation and uses soft-delete, preserving restore eligibility', async () => {
		const deletion = await prepareDelete('a.md');
		app.confirm.mockResolvedValueOnce(false);
		expect(await deletion.apply()).toMatch(/rejected/);
		expect(files.has('a.md')).toBe(true);
		expect(app.deleteNote).not.toHaveBeenCalled();
		const second = await prepareDelete('a.md');
		expect(await second.apply()).toMatch(/Trash/);
		expect(app.confirm).toHaveBeenCalledWith(
			expect.objectContaining({ danger: true, confirm: 'Move to Trash' })
		);
		expect(app.deleteNote).toHaveBeenCalledWith('a.md');
	});

	it('rechecks after confirmation and protects locked notes', async () => {
		const deletion = await prepareDelete('a.md');
		app.confirm.mockImplementationOnce(async () => {
			files.set('a.md', 'new');
			return true;
		});
		await expect(deletion.apply()).rejects.toThrow('changed since review');
		expect(app.deleteNote).not.toHaveBeenCalled();
		app.notes[0].locked = true;
		await expect(prepareDelete('a.md')).rejects.toThrow('locked');
		await expect(prepareEdit({ target: 'a.md', oldText: 'new', newText: 'x' })).rejects.toThrow(
			'locked'
		);
	});

	it('uses the live editor and rejects unsaved keystrokes during approval', async () => {
		app.activeId = 'a.md';
		app.editor = {
			text: '# A\nhello world',
			commands: {
				setContent(text) {
					app.editor!.text = text;
				}
			}
		};
		const edit = await prepareEdit({ target: 'current', oldText: 'hello', newText: 'bye' });
		app.editor.text += '!';
		await expect(edit.apply()).rejects.toThrow('changed since review');
		app.editor.text = '# A\nhello world';
		expect(await edit.apply()).toBe('Edited a.md');
		expect(app.editor.text).toBe('# A\nbye world');
		expect(files.get('a.md')).toBe('# A\nhello world'); // editor saves on update
	});

	it('Stop during destructive confirmation cannot delete afterward', async () => {
		const ctl = new AbortController();
		const deletion = await prepareDelete('a.md');
		app.confirm.mockImplementationOnce(async () => {
			ctl.abort();
			return true;
		});
		await expect(deletion.apply(ctl.signal)).rejects.toThrow();
		expect(app.deleteNote).not.toHaveBeenCalled();
		expect(files.has('a.md')).toBe(true);
	});
});
