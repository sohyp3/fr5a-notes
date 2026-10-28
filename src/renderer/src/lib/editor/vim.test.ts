import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Plugin, type Transaction } from '@tiptap/pm/state';
import { history } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import { Vim, vimKey } from './vim';

const schema = new Schema({
	nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} }
});

function editor(...text: string[]) {
	const plugins = Vim.config.addProseMirrorPlugins!.call({ options: {} } as never) as Plugin[];
	let state = EditorState.create({
		schema,
		doc: schema.node(
			'doc',
			null,
			text.map((line) => schema.node('paragraph', null, line ? schema.text(line) : undefined))
		),
		plugins: [...plugins, history()]
	});
	const view = {
		get state() {
			return state;
		},
		dispatch(tr: Transaction) {
			state = state.apply(tr);
		},
		focus() {}
	} as unknown as EditorView;
	return {
		text: () =>
			Array.from({ length: state.doc.childCount }, (_, i) => state.doc.child(i).textContent),
		state: () => state,
		cursor(line: number, column = 0) {
			let pos = 1 + column;
			for (let i = 0; i < line; i++) pos += state.doc.child(i).nodeSize;
			view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
		},
		key(key: string, ctrlKey = false) {
			const event = {
				key,
				ctrlKey,
				metaKey: false,
				shiftKey: false,
				preventDefault() {}
			} as KeyboardEvent;
			expect(plugins[0].props.handleKeyDown!.call(plugins[0], view, event)).toBe(true);
		}
	};
}

describe('Vim paragraph edits', () => {
	it.each([0, 1, 2])(
		'dd removes paragraph %i; p inserts its text as a separate paragraph',
		(index) => {
			const e = editor('first', 'middle', 'last');
			e.cursor(index);
			e.key('d');
			e.key('d');
			const remaining = ['first', 'middle', 'last'].filter((_, i) => i !== index);
			expect(e.text()).toEqual(remaining);
			const selected = Math.min(index, remaining.length - 1);
			expect(e.state().selection.$head.parent.textContent).toBe(remaining[selected]);
			e.key('p');
			remaining.splice(selected + 1, 0, ['first', 'middle', 'last'][index]);
			expect(e.text()).toEqual(remaining);
			expect(e.state().selection.$head.parent.textContent).toBe(['first', 'middle', 'last'][index]);
			expect(e.state().selection.$head.parentOffset).toBe(0);
			e.key('u');
			expect(e.text()).toHaveLength(2);
			e.key('u');
			expect(e.text()).toEqual(['first', 'middle', 'last']);
		}
	);

	it.each(['only', ''])('retains a valid document after deleting the only line %j', (line) => {
		const e = editor(line);
		e.key('d');
		e.key('d');
		expect(e.text()).toEqual(['']);
		e.key('p');
		expect(e.text()).toEqual(['', line]);
	});

	it('preserves empty lines in the linewise register', () => {
		const e = editor('before', '', 'after');
		e.cursor(1);
		e.key('d');
		e.key('d');
		expect(e.text()).toEqual(['before', 'after']);
		e.key('p');
		expect(e.text()).toEqual(['before', 'after', '']);
	});

	it('yy does not yank neighbouring text or a leading newline', () => {
		const e = editor('first', 'middle', 'last');
		e.cursor(1);
		e.key('y');
		e.key('y');
		e.key('p');
		expect(e.text()).toEqual(['first', 'middle', 'middle', 'last']);
	});

	it('visual line deletes and pastes multiple paragraphs', () => {
		const e = editor('first', 'middle', 'last');
		e.key('V');
		e.key('j');
		e.key('d');
		e.key('p');
		expect(e.text()).toEqual(['last', 'first', 'middle']);
	});

	it.each(['r'])('%s replaces exactly one character, preserving cursor and undo', (command) => {
		const e = editor('hello');
		e.cursor(0, 1);
		e.key(command);
		e.key('a');
		expect(e.text()).toEqual(['hallo']);
		expect(e.state().selection.head).toBe(2);
		expect(vimKey.getState(e.state())?.pending).toBe('');
		e.key('u');
		expect(e.text()).toEqual(['hello']);
	});

	it('R overwrites subsequent characters and appends at the end until Escape', () => {
		const e = editor('hello');
		e.cursor(0, 3);
		e.key('R');
		e.key('a');
		e.key('b');
		e.key('c');
		e.key('Escape');
		expect(e.text()).toEqual(['helabc']);
		expect(vimKey.getState(e.state())?.mode).toBe('normal');
		e.key('u');
		expect(e.text()).toEqual(['hello']);
	});

	it('Escape cancels a replacement and an empty line is unchanged', () => {
		const e = editor('hello', '');
		e.key('R');
		e.key('Escape');
		expect(e.text()).toEqual(['hello', '']);
		e.cursor(1);
		e.key('r');
		e.key('x');
		expect(e.text()).toEqual(['hello', '']);
	});
});
