import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state';
import { taskBox, toggleCheck, toggleCheckAt, toggleTask } from './tasks';

const schema = new Schema({
	nodes: {
		doc: { content: 'paragraph+' },
		paragraph: { content: 'text*' },
		text: {}
	}
});

const para = (line: string) => schema.node('paragraph', null, line ? schema.text(line) : []);

/** A state over `lines`, the selection from line `a` to line `b` (their starts). */
function state(lines: string[], a = 0, b = a): EditorState {
	const doc = schema.node('doc', null, lines.map(para));
	const start = (i: number) => {
		let pos = 1;
		for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
		return pos;
	};
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, start(a), start(b))
	});
}

function run(cmd: Command, s: EditorState): string[] | null {
	let out: string[] | null = null;
	const ok = cmd(s, (tr) => {
		const lines: string[] = [];
		tr.doc.forEach((n) => lines.push(n.textContent));
		out = lines;
	});
	return ok ? out : null;
}

describe('to-dos', () => {
	it('finds the box', () => {
		expect(taskBox('- [ ] milk')).toEqual({ mark: 3, done: false, prefixLen: 6 });
		expect(taskBox('  * [x] done')).toEqual({ mark: 5, done: true, prefixLen: 8 });
		expect(taskBox('- [X]')).toMatchObject({ done: true, prefixLen: 5 });
		expect(taskBox('- [ ]milk')).toBeNull();
		expect(taskBox('[ ] milk')).toBeNull();
		expect(taskBox('- [y] milk')).toBeNull();
	});

	it('checks and unchecks the line at a position', () => {
		const s = state(['- [ ] milk', '- [x] eggs']);
		expect(toggleCheckAt(s, 4)!.doc.child(0).textContent).toBe('- [x] milk');
		expect(toggleCheckAt(s, 14)!.doc.child(1).textContent).toBe('- [ ] eggs');
		expect(toggleCheckAt(state(['- milk']), 2)).toBeNull();
		expect(run(toggleCheck, state(['- [ ] milk']))).toEqual(['- [x] milk']);
		expect(run(toggleCheck, state(['plain']))).toBeNull();
	});

	it('turns lines into to-dos, and back when they all are', () => {
		expect(run(toggleTask, state(['milk', '- eggs', '2. bread', '  ham'], 0, 3))).toEqual([
			'- [ ] milk',
			'- [ ] eggs',
			'- [ ] bread',
			'  - [ ] ham'
		]);
		expect(run(toggleTask, state(['- [ ] milk', '  - [x] eggs'], 0, 1))).toEqual([
			'milk',
			'  eggs'
		]);
		// Mixed: the plain lines join the to-dos.
		expect(run(toggleTask, state(['- [x] milk', 'eggs'], 0, 1))).toEqual([
			'- [x] milk',
			'- [ ] eggs'
		]);
	});
});
