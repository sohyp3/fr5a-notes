import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

/**
 * MarkdownSyntax
 * --------------
 * The document is stored as *raw Markdown text* — one paragraph per line — so
 * the file on disk and the editor buffer are literally the same string. We
 * never transform `# ` into a heading node; instead this plugin paints
 * decorations over the syntax so the symbols *stay in the text* but can be
 * styled and hidden.
 *
 *   • Marker characters (`#`, `**`, `>`, backticks …) get the `md-syntax`
 *     class. CSS keeps them at opacity 0, 0.3 on line hover, 1 when active.
 *   • The rendered content (bold text, headings) gets its own class so it
 *     looks formatted while the raw symbols remain.
 *   • A token is "active" (md-active → opacity 1) when the selection sits
 *     inside its full span, i.e. the cursor is inside that word/node.
 */

interface Deco {
	from: number;
	to: number;
	class: string;
	/** Syntax markers get lit when the caret enters the token's outer span. */
	syntax?: boolean;
}

interface Token {
	outerFrom: number;
	outerTo: number;
	decos: Deco[];
}

/** Inline patterns, tried in priority order; earlier wins on overlap. */
const INLINE_RULES: { re: RegExp; build: (m: RegExpExecArray, base: number) => Deco[] }[] = [
	// inline code `code`
	{
		re: /`([^`\n]+)`/g,
		build: (m, base) => {
			const s = base + m.index;
			const e = s + m[0].length;
			return [
				{ from: s, to: s + 1, class: 'md-syntax', syntax: true },
				{ from: s + 1, to: e - 1, class: 'md-code' },
				{ from: e - 1, to: e, class: 'md-syntax', syntax: true }
			];
		}
	},
	// bold **text** or __text__
	{
		re: /(\*\*|__)(?=\S)([^\n]+?)(?<=\S)\1/g,
		build: (m, base) => wrap(m, base, 2, 'md-bold')
	},
	// strikethrough ~~text~~
	{
		re: /(~~)(?=\S)([^\n]+?)(?<=\S)~~/g,
		build: (m, base) => wrap(m, base, 2, 'md-strike')
	},
	// italic *text* / _text_ (single, not part of ** or __)
	{
		re: /(?<![*\w])(\*)(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g,
		build: (m, base) => wrap(m, base, 1, 'md-italic')
	},
	{
		re: /(?<![_\w])(_)(?!\s)([^_\n]+?)(?<!\s)_(?![_\w])/g,
		build: (m, base) => wrap(m, base, 1, 'md-italic')
	},
	// link [text](url)
	{
		re: /\[([^\]\n]+)\]\(([^)\n]+)\)/g,
		build: (m, base) => {
			const s = base + m.index;
			const textStart = s + 1;
			const textEnd = textStart + m[1].length;
			const e = s + m[0].length;
			return [
				{ from: s, to: s + 1, class: 'md-syntax', syntax: true }, // [
				{ from: textStart, to: textEnd, class: 'md-link' },
				{ from: textEnd, to: e, class: 'md-syntax', syntax: true } // ](url)
			];
		}
	},
	// inline tag #work/project1 (Unicode letters supported, e.g. Arabic #عمل)
	{
		re: /(?:^|\s)(#\p{L}[\p{L}\p{M}\p{N}_-]*(?:\/[\p{L}\p{M}\p{N}_-]+)*)/gu,
		build: (m, base) => {
			const hashAt = base + m.index + m[0].indexOf('#');
			const e = hashAt + m[1].length;
			return [
				{ from: hashAt, to: hashAt + 1, class: 'md-syntax', syntax: true },
				{ from: hashAt, to: e, class: 'md-tag' }
			];
		}
	}
];

/** Helper for symmetric wrappers like **x** where marker length is fixed. */
function wrap(m: RegExpExecArray, base: number, markLen: number, innerClass: string): Deco[] {
	const s = base + m.index;
	const e = s + m[0].length;
	return [
		{ from: s, to: s + markLen, class: 'md-syntax', syntax: true },
		{ from: s + markLen, to: e - markLen, class: innerClass },
		{ from: e - markLen, to: e, class: 'md-syntax', syntax: true }
	];
}

/** Block-level classification derived from the start of the line. */
function blockInfo(text: string): { nodeClass: string; prefixLen: number } | null {
	let m: RegExpMatchArray | null;
	// Hidden metadata comments, e.g. `<!-- dir: rtl -->` / `<!-- pinned: true -->`
	// / `<!-- locked: true -->`.
	if (
		/^<!--\s*(?:dir:\s*(?:rtl|ltr)|pinned:\s*(?:true|false)|locked:\s*(?:true|false))\s*-->$/i.test(
			text.trim()
		)
	) {
		return { nodeClass: 'md-meta', prefixLen: text.length };
	}
	if ((m = text.match(/^(#{1,6})\s/))) {
		return { nodeClass: `md-h${m[1].length}`, prefixLen: m[0].length };
	}
	if ((m = text.match(/^>\s?/))) {
		return { nodeClass: 'md-quote', prefixLen: m[0].length };
	}
	if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
		return { nodeClass: 'md-hr', prefixLen: text.length };
	}
	if ((m = text.match(/^(\s*)([-*+])\s/))) {
		return { nodeClass: 'md-bullet', prefixLen: m[0].length };
	}
	if ((m = text.match(/^(\s*)(\d+\.)\s/))) {
		return { nodeClass: 'md-ordered', prefixLen: m[0].length };
	}
	return null;
}

function tokenizeLine(text: string, contentStart: number): { tokens: Token[]; nodeClass?: string } {
	const tokens: Token[] = [];
	const consumed = new Array(text.length).fill(false);

	const consume = (from: number, to: number) => {
		for (let i = from; i < to; i++) consumed[i] = true;
	};

	// Block prefix handling.
	const block = blockInfo(text);
	if (block?.nodeClass === 'md-meta') {
		// Directionality metadata: always hidden (independent of Ghost Syntax).
		tokens.push({
			outerFrom: contentStart,
			outerTo: contentStart + text.length,
			decos: [{ from: contentStart, to: contentStart + text.length, class: 'md-meta-text' }]
		});
		consume(0, text.length);
	} else if (block?.nodeClass === 'md-hr') {
		tokens.push({
			outerFrom: contentStart,
			outerTo: contentStart + text.length,
			decos: [
				{ from: contentStart, to: contentStart + text.length, class: 'md-syntax', syntax: true }
			]
		});
	} else if (block?.nodeClass === 'md-bullet') {
		// EXCEPTION: bullet markers are never hidden — they're styled to look
		// designed. Colour just the marker glyph, leaving the trailing space.
		const indent = text.match(/^\s*/)?.[0].length ?? 0;
		tokens.push({
			outerFrom: contentStart + indent,
			outerTo: contentStart + indent + 1,
			decos: [
				{ from: contentStart + indent, to: contentStart + indent + 1, class: 'md-bullet-mark' }
			]
		});
		consume(0, block.prefixLen);
	} else if (block?.nodeClass === 'md-ordered') {
		// Ordered markers (`1.`) stay visible and readable; just style them.
		const indent = text.match(/^\s*/)?.[0].length ?? 0;
		const markEnd = block.prefixLen - 1; // exclude the trailing space
		tokens.push({
			outerFrom: contentStart + indent,
			outerTo: contentStart + markEnd,
			decos: [{ from: contentStart + indent, to: contentStart + markEnd, class: 'md-ordered-mark' }]
		});
		consume(0, block.prefixLen);
	} else if (block && block.prefixLen > 0) {
		// Headings / quotes: hide the leading symbol(s) via Ghost Syntax.
		const trimmed = text.slice(0, block.prefixLen).replace(/\s+$/, '');
		if (trimmed.length) {
			tokens.push({
				outerFrom: contentStart,
				outerTo: contentStart + text.length, // whole line = node span
				decos: [
					{
						from: contentStart,
						to: contentStart + trimmed.length,
						class: 'md-syntax',
						syntax: true
					}
				]
			});
			consume(0, trimmed.length);
		}
	}

	// Inline rules.
	for (const rule of INLINE_RULES) {
		rule.re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = rule.re.exec(text))) {
			const decos = rule.build(m, contentStart);
			const outerFrom = Math.min(...decos.map((d) => d.from));
			const outerTo = Math.max(...decos.map((d) => d.to));
			const lo = outerFrom - contentStart;
			const hi = outerTo - contentStart;
			let free = true;
			for (let i = lo; i < hi; i++) if (consumed[i]) free = false;
			if (!free) continue;
			for (let i = lo; i < hi; i++) consumed[i] = true;
			tokens.push({ outerFrom, outerTo, decos });
		}
	}

	return { tokens, nodeClass: block?.nodeClass };
}

const key = new PluginKey('markdownSyntax');

function buildDecorations(state: EditorState): DecorationSet {
	const decorations: Decoration[] = [];
	const { from: selFrom, to: selTo } = state.selection;

	state.doc.descendants((node: PMNode, pos: number) => {
		if (!node.isTextblock) return;
		const text = node.textContent;
		const contentStart = pos + 1;

		const { tokens, nodeClass } = tokenizeLine(text, contentStart);
		if (nodeClass) {
			decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: nodeClass }));
		}

		for (const token of tokens) {
			// A token is active when the selection overlaps its outer span.
			const active = selTo >= token.outerFrom && selFrom <= token.outerTo;
			for (const d of token.decos) {
				const cls = d.syntax && active ? `${d.class} md-active` : d.class;
				decorations.push(Decoration.inline(d.from, d.to, { class: cls }));
			}
		}
		return false; // don't descend into inline text
	});

	return DecorationSet.create(state.doc, decorations);
}

export const MarkdownSyntax = Extension.create({
	name: 'markdownSyntax',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key,
				state: {
					init: (_config, state) => buildDecorations(state),
					// Recompute on any doc or selection change so hover/active track live.
					apply: (tr, old, _oldState, newState) =>
						tr.docChanged || tr.selectionSet ? buildDecorations(newState) : old
				},
				props: {
					decorations(state) {
						return key.getState(state);
					}
				}
			})
		];
	}
});
