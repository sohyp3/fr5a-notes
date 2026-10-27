import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state';
import { enter, lift, sink } from './ListBehavior';

const schema = new Schema({
	nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} }
});

function editor(...lines: string[]) {
	let state = EditorState.create({
		schema,
		doc: schema.node(
			'doc',
			null,
			lines.map((line) => schema.node('paragraph', null, line ? schema.text(line) : undefined))
		)
	});
	const text = () => state.doc.content.content.map((node) => node.textContent);
	const cursor = (line: number) => {
		let pos = 1;
		for (let i = 0; i < line; i++) pos += state.doc.child(i).nodeSize;
		pos += state.doc.child(line).content.size;
		state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
	};
	const run = (command: Command) => {
		expect(command(state, (tr) => (state = state.apply(tr)))).toBe(true);
	};
	return { text, cursor, run };
}

describe('raw Markdown numbered lists', () => {
	it('continues on Enter, starts a nested sequence at one on Tab', () => {
		const e = editor('1. First');
		e.cursor(0);
		e.run(enter);
		expect(e.text()).toEqual(['1. First', '2. ']);
		e.run(sink);
		expect(e.text()).toEqual(['1. First', '  1. ']);
		e.cursor(1);
		e.run(enter);
		expect(e.text()).toEqual(['1. First', '']); // empty item clears instead of continuing
	});

	it('continues nested siblings and lifts to the next outer number', () => {
		const e = editor(
			'1. Parent',
			'  1. Inner',
			'  2. Next',
			'  - [ ] task',
			'    1. Deep',
			'  3. Last'
		);
		e.cursor(5);
		e.run(lift);
		expect(e.text()[5]).toBe('2. Last');
		expect(e.text().slice(0, 5)).toEqual([
			'1. Parent',
			'  1. Inner',
			'  2. Next',
			'  - [ ] task',
			'    1. Deep'
		]);
	});

	it('reuses the nested level sequence on Tab and supports multiple levels', () => {
		const e = editor('1. Outer', '  1. First', '  2. Second', '    1. Deep', '    8. Next');
		e.cursor(4);
		e.run(sink);
		expect(e.text()[4]).toBe('      1. Next');
		e.run(sink);
		expect(e.text()[4]).toBe('        1. Next');
		e.run(lift);
		expect(e.text()[4]).toBe('      1. Next');
		e.run(lift);
		expect(e.text()[4]).toBe('    2. Next');
	});

	it('leaves bullets, tasks, prose and other literal numbers unchanged', () => {
		const e = editor('9. Standalone', 'plain prose', '- bullet', '  - [x] task', '7. Item');
		e.cursor(4);
		e.run(sink);
		expect(e.text()).toEqual([
			'9. Standalone',
			'plain prose',
			'- bullet',
			'  - [x] task',
			'  1. Item'
		]);
		e.cursor(3);
		e.run(lift);
		expect(e.text()[3]).toBe('- [x] task');
	});

	it('increments Enter within the current level', () => {
		const e = editor('1. Parent', '  1. Child');
		e.cursor(1);
		e.run(enter);
		expect(e.text()).toEqual(['1. Parent', '  1. Child', '  2. ']);
	});

	it('continues after a moved subtree when indenting a parent with empty children', () => {
		const e = editor('1. Parent', '2. Child', '  1. ', '  - [ ] task');
		e.cursor(1);
		e.run(sink);
		expect(e.text()[1]).toBe('  1. Child');
		e.run(enter);
		expect(e.text()).toEqual(['1. Parent', '  1. Child', '    1. ', '    - [ ] task', '  2. ']);
	});

	it('uses the actual outdent remainder with one space and mixed whitespace', () => {
		const e = editor('1. Parent', '  1. First', '  2. Second', '   7. One extra', ' \t8. Mixed');
		e.cursor(3);
		e.run(lift);
		expect(e.text()[3]).toBe(' 1. One extra');
		e.cursor(4);
		e.run(lift);
		expect(e.text()[4]).toBe(' 2. Mixed');
		e.run(lift);
		expect(e.text()[4]).toBe('2. Mixed');
	});

	it('ignores indented continuation prose but stops at unrelated paragraphs', () => {
		const e = editor(
			'1. Outer',
			'  1. Inner',
			'    1. Deep',
			'    continuation',
			'  8. Later',
			'plain paragraph',
			'  9. Separate'
		);
		e.cursor(4);
		e.run(sink);
		expect(e.text()[4]).toBe('    2. Later');
		e.cursor(6);
		e.run(sink);
		expect(e.text()[6]).toBe('    1. Separate');
	});

	it('lifts descendants and restarts the following siblings at their new level', () => {
		const e = editor(
			'1. Outer',
			'  1. Parent',
			'    1. Child',
			'      - [ ] task',
			'    continuation',
			'  2. Sibling'
		);
		e.cursor(1);
		e.run(lift);
		expect(e.text()).toEqual([
			'1. Outer',
			'2. Parent',
			'  1. Child',
			'    - [ ] task',
			'  continuation',
			'  1. Sibling'
		]);
	});

	it('Tab carries a numbered parent and nested bullets/tasks through multiple levels', () => {
		const e = editor('1. Parent', '  - [ ] task', '    1. Grandchild', '2. Sibling');
		e.cursor(0);
		e.run(sink);
		expect(e.text()).toEqual([
			'  1. Parent',
			'    - [ ] task',
			'      1. Grandchild',
			'2. Sibling'
		]);
		e.cursor(1);
		e.run(sink);
		expect(e.text()[1]).toBe('      - [ ] task');
		expect(e.text()[2]).toBe('        1. Grandchild');
	});

	it('Tab carries bullet and task children without altering their markers', () => {
		for (const parent of ['- bullet', '- [x] task']) {
			const e = editor('1. Outer', parent, '  1. Child', '    - nested', '2. Next');
			e.cursor(1);
			e.run(sink);
			expect(e.text()).toEqual([
				'1. Outer',
				`  ${parent}`,
				'    1. Child',
				'      - nested',
				'2. Next'
			]);
		}
	});

	it('Shift-Tab restarts a contiguous sibling sequence but preserves custom ordinals', () => {
		const e = editor(
			'1. Outer',
			'  1. First',
			'  2. Second',
			'    - child',
			'  3. Third',
			'  8. Custom'
		);
		e.cursor(1);
		e.run(lift);
		expect(e.text()).toEqual([
			'1. Outer',
			'2. First',
			'  1. Second',
			'    - child',
			'  2. Third',
			'  8. Custom'
		]);
	});

	it('Enter on a task never renumbers a following numbered list', () => {
		const e = editor('- [ ] task', '1. One', '2. Two');
		e.cursor(0);
		e.run(enter);
		expect(e.text()).toEqual(['- [ ] task', '- [ ] ', '1. One', '2. Two']);
	});

	it('Enter after a parent inserts after its children and advances a matching sibling run', () => {
		const e = editor('1. Parent', '  1. Child', '    - task', '2. Sibling', '3. Next', '8. Custom');
		e.cursor(0);
		e.run(enter);
		expect(e.text()).toEqual([
			'1. Parent',
			'  1. Child',
			'    - task',
			'2. ',
			'3. Sibling',
			'4. Next',
			'8. Custom'
		]);
	});

	it('Enter across a blank paragraph keeps separate literal Markdown lists intact', () => {
		const e = editor('1. One', '', '2. Two');
		e.cursor(0);
		e.run(enter);
		expect(e.text()).toEqual(['1. One', '2. ', '', '2. Two']);
	});

	it('avoids duplicate ordinals on Enter without rewriting a custom later number', () => {
		const e = editor('1. First', '2. Second', '3. Third', '8. Deliberate');
		e.cursor(0);
		e.run(enter);
		expect(e.text()).toEqual(['1. First', '2. ', '3. Second', '4. Third', '8. Deliberate']);
	});
});
