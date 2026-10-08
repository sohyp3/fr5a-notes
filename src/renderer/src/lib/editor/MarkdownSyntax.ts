import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { cellRanges, findTables, pipeOffsets, tableHtml } from './tables';
import { codeLines } from './blocks';
import { findImages } from './images';
import { imageWidget } from './imageView';
import {
	coveredRanges,
	findHighlights,
	isHighlightComment,
	type Ranges,
	type Stretch
} from './highlights';

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
 *   • Tables (GFM pipe tables, see tables.ts) show as a rendered `<table>`
 *     widget with their lines hidden — until the caret enters them (a click
 *     on a cell puts it there), when the lines show as editable source. View
 *     mode always shows the rendered table.
 *   • Images (a line of just `![alt](src)`, see images.ts) show as a picture
 *     above their line, which (with its size comment) is hidden until the
 *     caret enters it; the picture stays while the source shows below it.
 *   • Dividers draw a rule by kind: `---` a hairline, `***` three dots,
 *     `___` a double rule.
 *   • Highlights (option, see highlights.ts) tint the stretches their
 *     comment names, in its colors; the comment lines stay hidden unless the
 *     caret is on one (or Ghost Syntax is off).
 */

export interface MarkdownSyntaxOptions {
	/** Paint highlight comments (Settings → Editor → Highlights). */
	highlights: boolean;
	/** What an `<img>` loads for an image's `src`; null when it can't be shown. */
	imageUrl: (src: string) => string | null;
}

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
	// inline image ![alt](src) — a line of just an image renders as a picture instead
	{
		re: /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
		build: (m, base) => {
			const s = base + m.index;
			const altEnd = s + 2 + m[1].length;
			return [
				{ from: s, to: s + 2, class: 'md-syntax', syntax: true }, // ![
				{ from: s + 2, to: altEnd, class: 'md-img-alt' },
				{ from: altEnd, to: s + m[0].length, class: 'md-syntax', syntax: true } // ](src)
			];
		}
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
		/^<!--\s*(?:dir:\s*(?:rtl|ltr)|pinned:\s*(?:true|false)|locked:\s*(?:true|false)|ai:\s*local)\s*-->$/i.test(
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
	// `---` / `***` / `___` (spaces between allowed): each kind draws its own rule.
	if ((m = text.match(/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/))) {
		const kind = m[1] === '-' ? 'line' : m[1] === '*' ? 'dots' : 'double';
		return { nodeClass: `md-hr md-hr-${kind}`, prefixLen: text.length };
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
	} else if (block?.nodeClass.startsWith('md-hr')) {
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

	tokens.push(...inlineTokens(text, contentStart, consumed));
	return { tokens, nodeClass: block?.nodeClass };
}

/** Inline rules over the characters not yet `consumed` (marked as they're used). */
function inlineTokens(text: string, contentStart: number, consumed: boolean[]): Token[] {
	const tokens: Token[] = [];
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
	return tokens;
}

/** A table line in source mode: pipes tinted, separator dashes muted, cells styled inline. */
function tokenizeTableSource(text: string, contentStart: number, sep: boolean): Token[] {
	const consumed = new Array(text.length).fill(false);
	const decos: Deco[] = [];
	for (const p of pipeOffsets(text)) {
		decos.push({ from: contentStart + p, to: contentStart + p + 1, class: 'md-tpipe' });
		consumed[p] = true;
	}
	const whole = { outerFrom: contentStart, outerTo: contentStart + text.length, decos };
	if (sep) {
		for (const { from, to } of cellRanges(text))
			if (to > from)
				decos.push({ from: contentStart + from, to: contentStart + to, class: 'md-tsep-text' });
		return [whole];
	}
	return [...inlineTokens(text, contentStart, consumed), whole];
}

/**
 * The rendered table, standing in for its hidden lines. A press on a cell
 * (while editable) puts the caret at the end of that cell's source, which
 * flips the table to source mode.
 */
function tableWidget(
	view: EditorView,
	getPos: () => number | undefined,
	html: string
): HTMLElement {
	const wrap = document.createElement('div');
	wrap.className = 'md-table';
	wrap.contentEditable = 'false';
	wrap.innerHTML = html; // tableHtml escapes every cell (renderInline)
	const toCell = (e: Event) => {
		const cell = (e.target as Element).closest<HTMLElement>('[data-line]');
		const at = getPos();
		if (!cell || at === undefined || !view.editable) return false;
		const $at = view.state.doc.resolve(at);
		const index = $at.index(0) + Number(cell.dataset.line);
		if (index >= view.state.doc.childCount) return false;
		let pos = 0;
		for (let k = 0; k < index; k++) pos += view.state.doc.child(k).nodeSize;
		const text = view.state.doc.child(index).textContent;
		const range = cellRanges(text)[Number(cell.dataset.cell)];
		const head = pos + 1 + (range ? range.to : text.length);
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, head)));
		view.focus();
		return true;
	};
	wrap.addEventListener('mousedown', (e) => {
		if (toCell(e)) e.preventDefault();
	});
	return wrap;
}

const key = new PluginKey('markdownSyntax');

/** Events a block widget (table, picture) handles itself, not ProseMirror. */
const widgetEvent = (e: Event) => /^(mouse|touch|pointer|drag|dblclick)/.test(e.type);

function buildDecorations(
	state: EditorState,
	editable: boolean,
	opts: MarkdownSyntaxOptions
): DecorationSet {
	const decorations: Decoration[] = [];
	const { from: selFrom, to: selTo } = state.selection;
	// Tables span lines, so find them over the whole document first.
	const lines: string[] = [];
	const starts: number[] = [];
	state.doc.forEach((node, pos) => {
		lines.push(node.textContent);
		starts.push(pos);
	});
	const tables = findTables(lines);
	/** Per table row: show it as source (caret inside, editable) or hide it behind the widget. */
	const source = new Map<number, boolean>();
	for (const [i, row] of tables) {
		if (row.role !== 'head') continue;
		let end = i;
		while (!tables.get(end)?.last) end++;
		const from = starts[i];
		const to = starts[end] + state.doc.child(end).nodeSize;
		const raw = editable && selTo >= from && selFrom <= to;
		for (let k = i; k <= end; k++) source.set(k, raw);
		if (!raw) {
			const html = tableHtml(lines.slice(i, end + 1));
			decorations.push(
				Decoration.widget(from, (view, getPos) => tableWidget(view, getPos, html), {
					side: -1,
					key: `table:${html}`,
					stopEvent: (e) => e.type.startsWith('mouse') || e.type.startsWith('touch')
				})
			);
		}
	}

	// Images: the picture sits above its line; the line (and its size comment)
	// show as source only while the caret is in them.
	const imageRows = new Map<number, { raw: boolean; size: boolean }>();
	for (const [i, img] of findImages(lines)) {
		if (tables.has(i)) continue;
		const last = img.sizeLine ?? i;
		const raw =
			editable && selTo >= starts[i] && selFrom <= starts[last] + state.doc.child(last).nodeSize;
		imageRows.set(i, { raw, size: false });
		if (img.sizeLine !== null) imageRows.set(img.sizeLine, { raw, size: true });
		const url = opts.imageUrl(img.src);
		const view = { url, src: img.src, alt: img.alt, size: img.size };
		decorations.push(
			Decoration.widget(starts[i], (v, getPos) => imageWidget(v, getPos, view), {
				side: -1,
				key: `img:${img.size}:${url}:${img.alt}:${img.src}`,
				stopEvent: widgetEvent
			})
		);
	}

	// Highlights: stretches per marked line; their comment lines are hidden.
	const code = opts.highlights ? codeLines(lines) : null;
	const marks = new Map<number, Ranges[]>();
	if (opts.highlights)
		for (const h of findHighlights(lines))
			marks.set(h.target, [...(marks.get(h.target) ?? []), h.ranges]);

	let line = -1;

	state.doc.forEach((node: PMNode, pos: number) => {
		line++;
		if (!node.isTextblock) return;
		const text = node.textContent;
		const contentStart = pos + 1;
		const row = tables.get(line);
		const end = pos + node.nodeSize;

		const img = row ? undefined : imageRows.get(line);
		if (img) {
			const cls = img.raw ? `md-img-src${img.size ? ' md-img-size' : ''}` : 'md-img-hidden';
			decorations.push(Decoration.node(pos, end, { class: cls }));
			return;
		}
		if (code && !code[line] && !row && isHighlightComment(text)) {
			// Shown (as source) only with the caret on it — or with Ghost Syntax off (CSS).
			const open = editable && selTo > pos && selFrom < end;
			const cls = open ? 'md-hl-comment md-hl-open' : 'md-hl-comment';
			decorations.push(Decoration.node(pos, end, { class: cls }));
			return;
		}

		let tokens: Token[];
		if (row && !source.get(line)) {
			decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'md-trow-hidden' }));
			return;
		} else if (row) {
			const cls = `md-trow md-trow-${row.role}${row.role === 'head' ? ' md-trow-first' : ''}${row.last ? ' md-trow-last' : ''}`;
			decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: cls }));
			tokens = tokenizeTableSource(text, contentStart, row.role === 'sep');
		} else {
			const t = tokenizeLine(text, contentStart);
			tokens = t.tokens;
			if (t.nodeClass)
				decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: t.nodeClass }));
		}

		// Symbols Ghost Syntax collapses (no caret in their token), as line offsets.
		const ghosted: [number, number][] = [];
		for (const token of tokens) {
			// A token is active when the selection overlaps its outer span.
			const active = selTo >= token.outerFrom && selFrom <= token.outerTo;
			for (const d of token.decos) {
				const cls = d.syntax && active ? `${d.class} md-active` : d.class;
				decorations.push(Decoration.inline(d.from, d.to, { class: cls }));
				if (d.syntax && !active) ghosted.push([d.from - contentStart, d.to - contentStart]);
			}
		}

		const hl = row ? undefined : marks.get(line);
		if (hl)
			for (const stretch of coveredRanges(text, hl))
				decorations.push(...markDecos(contentStart, stretch, ghosted));
	});

	return DecorationSet.create(state.doc, decorations);
}

/**
 * A highlighted stretch: its tint, plus round padded ends on its first and
 * last character. Other decorations split the tint into several spans, so
 * only those two characters may round off. When Ghost Syntax collapses the
 * symbols at an end (`**bold**`), the outermost visible character also gets
 * one (`md-mark-vs` / `-ve`), worn only while they're collapsed (CSS).
 */
function markDecos(
	start: number,
	[a, b, color]: Stretch,
	ghosted: [number, number][]
): Decoration[] {
	const shown = (i: number) => !ghosted.some(([x, y]) => i >= x && i < y);
	let vs = a;
	while (vs < b && !shown(vs)) vs++;
	let ve = b - 1;
	while (ve > vs && !shown(ve)) ve--;
	const at = (i: number, cls: string) =>
		Decoration.inline(start + i, start + i + 1, { class: cls });
	return [
		Decoration.inline(start + a, start + b, { class: `md-mark md-mark-${color}` }),
		at(a, 'md-mark-s'),
		at(b - 1, 'md-mark-e'),
		...(vs < b && vs !== a ? [at(vs, 'md-mark-vs')] : []),
		...(vs < b && ve !== b - 1 ? [at(ve, 'md-mark-ve')] : [])
	];
}

interface SyntaxState {
	set: DecorationSet;
	/** The view is editable: tables holding the caret show their source. */
	editable: boolean;
}

export const MarkdownSyntax = Extension.create<MarkdownSyntaxOptions>({
	name: 'markdownSyntax',

	addOptions() {
		return { highlights: false, imageUrl: () => null };
	},

	addProseMirrorPlugins() {
		const opts = this.options;
		return [
			new Plugin<SyntaxState>({
				key,
				state: {
					init: (_config, state) => ({
						set: buildDecorations(state, true, opts),
						editable: true
					}),
					// Recompute on any doc or selection change so hover/active track live,
					// and when the view flips between view and edit mode.
					apply: (tr, old, _oldState, newState) => {
						const editable = (tr.getMeta(key) as boolean | undefined) ?? old.editable;
						return tr.docChanged || tr.selectionSet || editable !== old.editable
							? { set: buildDecorations(newState, editable, opts), editable }
							: old;
					}
				},
				view(view) {
					// Mirror `view.editable` into the plugin state (decorations only see state).
					const sync = () => {
						if (view.isDestroyed) return;
						if (key.getState(view.state)?.editable !== view.editable)
							view.dispatch(
								view.state.tr.setMeta(key, view.editable).setMeta('addToHistory', false)
							);
					};
					queueMicrotask(sync);
					return { update: () => queueMicrotask(sync) };
				},
				props: {
					decorations(state) {
						return key.getState(state)?.set;
					}
				}
			})
		];
	}
});
