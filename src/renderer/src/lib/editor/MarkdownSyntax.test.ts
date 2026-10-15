import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Plugin, type Transaction } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import { MarkdownSyntax, type MarkdownSyntaxOptions } from './MarkdownSyntax';

const schema = new Schema({
	nodes: {
		doc: { content: 'paragraph+' },
		paragraph: { content: 'text*' },
		text: {}
	}
});

const para = (line: string) => schema.node('paragraph', null, line ? schema.text(line) : []);
const doc = (lines: string[]) => schema.node('doc', null, lines.map(para));

function syntaxPlugin(opts: MarkdownSyntaxOptions): Plugin<{ set: DecorationSet }> {
	const ext = MarkdownSyntax.configure(opts);
	const make = ext.config.addProseMirrorPlugins as (this: { options: unknown }) => Plugin[];
	return make.call({ options: ext.options })[0];
}

/** A decoration set as comparable rows: position, kind, class or widget key. */
function rows(set: DecorationSet): string[] {
	return set
		.find()
		.map((d) => {
			// `type` / `inline` aren't in the public typings.
			const { type, inline } = d as unknown as {
				type: { attrs?: { class?: string } };
				inline: boolean;
			};
			const what = type.attrs
				? `${inline ? 'inline' : 'node'} ${type.attrs.class}`
				: `widget ${(d.spec as { key?: string }).key}`;
			return `${d.from}-${d.to} ${what}`;
		})
		.sort();
}

/** Lines a note is made of: every kind the plugin paints differently. */
const LINES = [
	'# Title **bold**',
	'',
	'- item `code` [link](https://x.y) #tag',
	'  - nested **b** and *it*',
	'> quote ~~gone~~',
	'Plain text with **bold** words here.',
	'1. one',
	'---',
	'***',
	'| a | b |',
	'| --- | --- |',
	'| 1 | **2** |',
	'![alt](pic.png)',
	'<!-- size: 50% -->',
	'<!-- highlight -->',
	'<!-- highlight: 0-3, pink 5-8 -->',
	'<!-- highlight: green -->',
	'```',
	'const x = 1',
	'<!-- dir: rtl -->'
];
const SNIPPETS = ['a', ' ', '|', '**', '# ', '`', '![x](y.png)', '<!--', '-->', '| c |', '```'];

/** Small seeded PRNG, so a failure replays. */
function rng(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Line start positions of `d` (each paragraph's opening). */
function lineStarts(state: EditorState): number[] {
	const out: number[] = [];
	state.doc.forEach((_n, pos) => out.push(pos));
	return out;
}

function randomStep(state: EditorState, rand: () => number): Transaction {
	const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
	const size = state.doc.content.size;
	const at = () => Math.floor(rand() * (size + 1));
	const near = (p: number) => TextSelection.near(state.doc.resolve(p));
	const tr = state.tr;
	const op = rand();
	if (op < 0.25) return tr.setSelection(near(at()));
	if (op < 0.32) {
		const a = near(at()).from;
		const b = near(at()).from;
		return tr.setSelection(TextSelection.create(state.doc, Math.min(a, b), Math.max(a, b)));
	}
	if (op < 0.55) return tr.insertText(pick(SNIPPETS));
	if (op < 0.62) return tr.split(state.selection.from);
	if (op < 0.72) {
		const a = at();
		return tr.delete(a, Math.min(size, a + 1 + Math.floor(rand() * 4)));
	}
	const starts = lineStarts(state);
	const k = Math.floor(rand() * starts.length);
	if (op < 0.82) return tr.insert(starts[k], para(pick(LINES)));
	if (op < 0.92) {
		const node = state.doc.child(k);
		const from = starts[k] + 1;
		const text = pick(LINES);
		return text
			? tr.insertText(text, from, from + node.content.size)
			: tr.delete(from, from + node.content.size);
	}
	// Backspace at a line start: join it with the line above.
	return k > 0 ? tr.delete(starts[k] - 1, starts[k] + 1) : tr.setSelection(near(0));
}

describe('MarkdownSyntax decorations', () => {
	const opts: MarkdownSyntaxOptions = { highlights: true, imageUrl: (src) => `fr5a:${src}` };
	const plugin = syntaxPlugin(opts);
	/** What a full rebuild paints for this document and selection. */
	const fresh = (state: EditorState) =>
		rows(
			plugin.getState(
				EditorState.create({ doc: state.doc, selection: state.selection, plugins: [plugin] })
			)!.set
		);

	it('rebuilt line by line, match a full rebuild after every edit and caret move', () => {
		for (let seed = 1; seed <= 12; seed++) {
			const rand = rng(seed);
			const lines = Array.from(
				{ length: 30 + seed * 4 },
				() => LINES[Math.floor(rand() * LINES.length)]
			);
			let state = EditorState.create({ doc: doc(lines), plugins: [plugin] });
			for (let step = 0; step < 250; step++) {
				let tr: Transaction;
				try {
					tr = randomStep(state, rand);
				} catch {
					continue; // a random range that can't be deleted / split
				}
				state = state.apply(tr);
				const got = rows(plugin.getState(state)!.set);
				if (got.join('\n') !== fresh(state).join('\n'))
					expect({ seed, step, got }).toEqual({ seed, step, got: fresh(state) });
			}
		}
	});

	it('only rebuilds what changed: typing keeps other lines’ decorations', () => {
		const lines = Array.from({ length: 200 }, (_, i) => `Line ${i} with **bold** and \`code\``);
		let state = EditorState.create({ doc: doc(lines), plugins: [plugin] });
		const far = plugin.getState(state)!.set.find(state.doc.content.size - 20);
		state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
		state = state.apply(state.tr.insertText('x'));
		// The last line's decorations are the same objects, mapped by one character.
		const after = plugin.getState(state)!.set.find(state.doc.content.size - 20);
		expect(after.map((d) => d.spec)).toEqual(far.map((d) => d.spec));
		expect(after.map((d) => d.from)).toEqual(far.map((d) => d.from + 1));
		expect(rows(plugin.getState(state)!.set)).toEqual(fresh(state));
	});
});
