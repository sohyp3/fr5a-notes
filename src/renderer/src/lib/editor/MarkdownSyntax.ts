import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { cellRanges, findTables, pipeOffsets, tableHtml, type TableRow } from './tables';
import { findCodeRows, type CodeRow } from './blocks';
import { findImages, type ImageBlock } from './images';
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
	/** Hand a clicked web link to the host browser. */
	openLink?: (href: string) => void;
	/** Wiki-link parsing is entirely skipped while the optional feature is off. */
	wikiLinks?: boolean;
	/** Follow a `[[target]]` link (view mode click; Mod+click while editing). */
	onWikiLink?: (target: string) => void;
}

interface Deco {
	from: number;
	to: number;
	class: string;
	/** Extra DOM attributes for interactive decorations such as external links. */
	attrs?: Record<string, string>;
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
			const href = externalHref(m[2]);
			return [
				{ from: s, to: s + 1, class: 'md-syntax', syntax: true }, // [
				{
					from: textStart,
					to: textEnd,
					class: 'md-link',
					attrs: href
						? {
								nodeName: 'a',
								href,
								target: '_blank',
								rel: 'noreferrer noopener',
								title: 'Open in browser'
							}
						: undefined
				},
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

/** Only web links may leave the app; relative/file/custom URLs remain editable text. */
function externalHref(raw: string): string | null {
	const href = raw.trim();
	try {
		const url = new URL(href);
		return url.protocol === 'http:' || url.protocol === 'https:' ? href : null;
	} catch {
		return null;
	}
}

/** Kept outside INLINE_RULES so the disabled feature does not run its regex. */
const WIKI_RULE: (typeof INLINE_RULES)[number] = {
	re: /\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g,
	build: (m, base) => {
		const s = base + m.index;
		const target = m[1].trim();
		const targetStart = s + 2;
		const targetEnd = targetStart + m[1].length;
		const e = s + m[0].length;
		const attrs = { 'data-wiki-target': target, role: 'link', tabindex: '0' };
		if (m[2] !== undefined) {
			const labelStart = targetEnd + 1;
			return [
				{ from: s, to: s + 2, class: 'md-syntax', syntax: true },
				{ from: targetStart, to: labelStart, class: 'md-syntax', syntax: true },
				{ from: labelStart, to: e - 2, class: 'md-link md-wiki-link', attrs },
				{ from: e - 2, to: e, class: 'md-syntax', syntax: true }
			];
		}
		return [
			{ from: s, to: s + 2, class: 'md-syntax', syntax: true },
			{ from: targetStart, to: targetEnd, class: 'md-link md-wiki-link', attrs },
			{ from: e - 2, to: e, class: 'md-syntax', syntax: true }
		];
	}
};
/** Inline code first, so `[[x]]` in a code span stays code. */
const WIKI_RULES = [INLINE_RULES[0], WIKI_RULE, ...INLINE_RULES.slice(1)];

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

function tokenizeLine(
	text: string,
	contentStart: number,
	wikiLinks = false
): { tokens: Token[]; nodeClass?: string } {
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
		// Headings / quotes: hide the leading symbol(s) via Ghost Syntax — the space
		// after them too, or the text sits a space right of the body column.
		const trimmed = text.slice(0, block.prefixLen).replace(/\s+$/, '');
		if (trimmed.length) {
			tokens.push({
				outerFrom: contentStart,
				outerTo: contentStart + text.length, // whole line = node span
				decos: [
					{
						from: contentStart,
						to: contentStart + block.prefixLen,
						class: 'md-syntax',
						syntax: true
					}
				]
			});
			consume(0, block.prefixLen);
		}
	}

	tokens.push(...inlineTokens(text, contentStart, consumed, wikiLinks));
	return { tokens, nodeClass: block?.nodeClass };
}

/** Inline rules over the characters not yet `consumed` (marked as they're used). */
function inlineTokens(
	text: string,
	contentStart: number,
	consumed: boolean[],
	wikiLinks = false
): Token[] {
	const tokens: Token[] = [];
	const rules = wikiLinks ? WIKI_RULES : INLINE_RULES;
	for (const rule of rules) {
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
function tokenizeTableSource(
	text: string,
	contentStart: number,
	sep: boolean,
	wikiLinks: boolean
): Token[] {
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
	return [...inlineTokens(text, contentStart, consumed, wikiLinks), whole];
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

/**
 * What the whole-document pass knows about each line. Only string scans, so
 * cheap (about 0.5 ms for 1 500 lines); it runs on every edit, while the
 * decorations themselves are rebuilt only for the lines that need it.
 */
interface Scan {
	lines: string[];
	/** Position of each line's node, plus the document's end. */
	starts: number[];
	/** Fenced code blocks, including their fence lines. */
	code: Map<number, CodeRow>;
	tables: Map<number, TableRow>;
	/** Image lines (not in a table): the picture shows above them. */
	images: Map<number, ImageBlock>;
	/** Lines of a picture: its own line and its size comment. */
	imageRows: Map<number, { size: boolean }>;
	/** The table / picture each such line belongs to: [first, last] line. */
	blocks: Map<number, [number, number]>;
	/** Highlight comment lines (hidden unless the caret is on one). */
	comments: Set<number>;
	/** Stretches marked on a line, per comment naming it. */
	marks: Map<number, Ranges[]>;
	/**
	 * Per line, what its decorations take from other lines (table row, picture
	 * line, highlight comment, the stretches marked on it). A line whose text
	 * and signature stay the same keeps its decorations across an edit.
	 */
	sig: string[];
}

function scan(state: EditorState, opts: MarkdownSyntaxOptions): Scan {
	const lines: string[] = [];
	const starts: number[] = [];
	state.doc.forEach((node, pos) => {
		lines.push(node.textContent);
		starts.push(pos);
	});
	starts.push(state.doc.content.size);
	const code = findCodeRows(lines);
	// Tables span lines, so find them over the whole document first.
	const tables = findTables(lines);
	for (const i of code.keys()) tables.delete(i);
	const blocks = new Map<number, [number, number]>();
	for (const [i, row] of tables) {
		if (row.role !== 'head') continue;
		let end = i;
		while (!tables.get(end)?.last) end++;
		for (let k = i; k <= end; k++) blocks.set(k, [i, end]);
	}
	// Images: the picture sits above its line; the line (and its size comment)
	// show as source only while the caret is in them.
	const images = new Map<number, ImageBlock>();
	const imageRows = new Map<number, { size: boolean }>();
	for (const [i, img] of findImages(lines)) {
		if (code.has(i) || tables.has(i)) continue;
		images.set(i, img);
		const block: [number, number] = [i, img.sizeLine ?? i];
		imageRows.set(i, { size: false });
		blocks.set(i, block);
		if (img.sizeLine !== null && !tables.has(img.sizeLine)) {
			imageRows.set(img.sizeLine, { size: true });
			blocks.set(img.sizeLine, block);
		}
	}
	// Highlights: stretches per marked line; their comment lines are hidden.
	const marks = new Map<number, Ranges[]>();
	const comments = new Set<number>();
	if (opts.highlights) {
		for (const h of findHighlights(lines))
			if (!code.has(h.target)) marks.set(h.target, [...(marks.get(h.target) ?? []), h.ranges]);
		lines.forEach((text, i) => {
			if (!code.has(i) && !tables.has(i) && !imageRows.has(i) && isHighlightComment(text))
				comments.add(i);
		});
	}
	const sig = lines.map((_, i) => {
		const codeRow = code.get(i);
		if (codeRow)
			return `c${codeRow.fence ? 'f' : 'b'}${codeRow.first ? 1 : 0}${codeRow.last ? 1 : 0}${codeRow.single ? 1 : 0}`;
		const row = tables.get(i);
		if (row) return `t${row.role}${row.last ? 1 : 0}`;
		const img = imageRows.get(i);
		if (img) return img.size ? 's' : `i${images.get(i)?.sizeLine === null ? 0 : 1}`;
		if (comments.has(i)) return 'h';
		const m = marks.get(i);
		return m ? `m${JSON.stringify(m)}` : '';
	});
	return { lines, starts, code, tables, images, imageRows, blocks, comments, marks, sig };
}

/** The line holding `pos` (a position between two lines counts as the later one). */
function lineAt(s: Scan, pos: number): number {
	let lo = 0;
	let hi = s.lines.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (s.starts[mid] <= pos) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/** Line `i`'s decorations, plus the table / picture widget when it starts one. */
function lineDecorations(
	i: number,
	s: Scan,
	state: EditorState,
	editable: boolean,
	opts: MarkdownSyntaxOptions,
	out: Decoration[]
): void {
	const { from: selFrom, to: selTo } = state.selection;
	const pos = s.starts[i];
	const end = s.starts[i + 1];
	const block = s.blocks.get(i);
	/** Its table / picture shows as source: the caret is inside (and editable). */
	const raw =
		!!block && editable && selTo >= s.starts[block[0]] && selFrom < s.starts[block[1] + 1];
	const row = s.tables.get(i);

	if (row?.role === 'head' && !raw) {
		const html = tableHtml(s.lines.slice(i, block![1] + 1));
		out.push(
			Decoration.widget(pos, (view, getPos) => tableWidget(view, getPos, html), {
				side: -1,
				key: `table:${html}`,
				stopEvent: (e) => e.type.startsWith('mouse') || e.type.startsWith('touch')
			})
		);
	}
	const image = s.images.get(i);
	if (image) {
		const url = opts.imageUrl(image.src);
		const view = { url, src: image.src, alt: image.alt, size: image.size };
		out.push(
			Decoration.widget(pos, (v, getPos) => imageWidget(v, getPos, view), {
				side: -1,
				key: `img:${image.size}:${url}:${image.alt}:${image.src}`,
				stopEvent: widgetEvent
			})
		);
	}

	if (!state.doc.child(i).isTextblock) return;
	const text = s.lines[i];
	const contentStart = pos + 1;

	const img = row ? undefined : s.imageRows.get(i);
	if (img) {
		const cls = raw ? `md-img-src${img.size ? ' md-img-size' : ''}` : 'md-img-hidden';
		out.push(Decoration.node(pos, end, { class: cls }));
		return;
	}
	if (s.comments.has(i)) {
		// Shown (as source) only with the caret on it — or with Ghost Syntax off (CSS).
		const open = editable && selTo > pos && selFrom < end;
		out.push(
			Decoration.node(pos, end, { class: open ? 'md-hl-comment md-hl-open' : 'md-hl-comment' })
		);
		return;
	}
	const codeRow = s.code.get(i);
	if (codeRow) {
		const fenceOpen = codeRow.fence && editable && selTo > pos && selFrom < end;
		const classes = [
			'md-codeblock',
			codeRow.first ? 'md-codeblock-first' : '',
			codeRow.last ? 'md-codeblock-last' : '',
			codeRow.fence ? 'md-codeblock-fence' : '',
			fenceOpen ? 'md-codeblock-fence-open' : ''
		]
			.filter(Boolean)
			.join(' ');
		out.push(Decoration.node(pos, end, { class: classes }));
		if (codeRow.single) {
			const m = /^(\s{0,3})(`{3,}|~{3,})(\s+)(.*?)(\s+)(\2)\s*$/.exec(text);
			if (m) {
				const opening = m[1].length + m[2].length + m[3].length;
				const closing = m[5].length + m[6].length;
				out.push(
					Decoration.inline(contentStart, contentStart + opening, { class: 'md-syntax' }),
					Decoration.inline(contentStart + opening, contentStart + text.length - closing, {
						class: 'md-codeblock-text'
					}),
					Decoration.inline(contentStart + text.length - closing, contentStart + text.length, {
						class: 'md-syntax'
					})
				);
			}
		}
		return;
	}

	let tokens: Token[];
	if (row && !raw) {
		out.push(Decoration.node(pos, end, { class: 'md-trow-hidden' }));
		return;
	} else if (row) {
		const cls = `md-trow md-trow-${row.role}${row.role === 'head' ? ' md-trow-first' : ''}${row.last ? ' md-trow-last' : ''}`;
		out.push(Decoration.node(pos, end, { class: cls }));
		tokens = tokenizeTableSource(text, contentStart, row.role === 'sep', !!opts.wikiLinks);
	} else {
		const t = tokenizeLine(text, contentStart, opts.wikiLinks);
		tokens = t.tokens;
		if (t.nodeClass) out.push(Decoration.node(pos, end, { class: t.nodeClass }));
	}

	// Symbols Ghost Syntax collapses (no caret in their token), as line offsets.
	const ghosted: [number, number][] = [];
	for (const token of tokens) {
		// A token is active when the selection overlaps its outer span — only while
		// editable: view mode is the rendered page (the caret parks at 0, in the H1).
		const active = editable && selTo >= token.outerFrom && selFrom <= token.outerTo;
		for (const d of token.decos) {
			const cls = d.syntax && active ? `${d.class} md-active` : d.class;
			out.push(Decoration.inline(d.from, d.to, { ...d.attrs, class: cls }));
			if (d.syntax && !active) ghosted.push([d.from - contentStart, d.to - contentStart]);
		}
	}

	const hl = row ? undefined : s.marks.get(i);
	if (hl)
		for (const stretch of coveredRanges(text, hl))
			out.push(...markDecos(contentStart, stretch, ghosted));
}

/** Every line's decorations. */
function buildAll(
	state: EditorState,
	s: Scan,
	editable: boolean,
	opts: MarkdownSyntaxOptions
): SyntaxState {
	const out: Decoration[] = [];
	for (let i = 0; i < s.lines.length; i++) lineDecorations(i, s, state, editable, opts, out);
	return { set: DecorationSet.create(state.doc, out), editable, scan: s };
}

/** Lines `from`..`to` (positions) touch, into `dirty`. */
function addLines(dirty: Set<number>, s: Scan, from: number, to: number): void {
	const last = lineAt(s, to);
	for (let i = lineAt(s, Math.max(0, from - 1)); i <= last; i++) dirty.add(i);
}

/**
 * The decorations after `tr`, rebuilding only the lines that may differ: the
 * lines the edit touched, those whose context changed (signature), the old
 * and the new selection's, and the whole table / picture of any of them.
 * Every other line keeps its decorations, mapped. Typing in a long note then
 * costs about one line, not the whole document.
 */
function updateDecorations(
	tr: Transaction,
	old: SyntaxState,
	oldState: EditorState,
	state: EditorState,
	opts: MarkdownSyntaxOptions
): SyntaxState {
	const s = tr.docChanged ? scan(state, opts) : old.scan;
	const n = s.lines.length;
	const dirty = new Set<number>();
	let set = old.set;
	if (tr.docChanged) {
		set = set.map(tr.mapping, tr.doc);
		// What the steps replaced, in the new document.
		let from = Infinity;
		let to = -Infinity;
		tr.mapping.maps.forEach((map, m) => {
			const rest = tr.mapping.slice(m + 1);
			map.forEach((_a, _b, start, stop) => {
				from = Math.min(from, rest.map(start, -1));
				to = Math.max(to, rest.map(stop, 1));
			});
		});
		let first = n;
		let last = -1;
		if (from <= to) {
			first = lineAt(s, Math.max(0, from - 1));
			last = lineAt(s, to);
			for (let i = first; i <= last; i++) dirty.add(i);
		}
		// Untouched lines whose context changed: before the edit they line up
		// with the old ones by index, after it from the end.
		const prev = old.scan.sig;
		for (let i = 0; i < Math.min(first, prev.length); i++) if (prev[i] !== s.sig[i]) dirty.add(i);
		for (let j = n - 1, k = prev.length - 1; j > last && k >= 0; j--, k--)
			if (prev[k] !== s.sig[j]) dirty.add(j);
		const sel = oldState.selection;
		addLines(dirty, s, tr.mapping.map(sel.from, -1), tr.mapping.map(sel.to, 1));
	} else addLines(dirty, s, oldState.selection.from, oldState.selection.to);
	addLines(dirty, s, state.selection.from, state.selection.to);
	// A table / picture is drawn from all its lines.
	for (const i of [...dirty]) {
		const block = s.blocks.get(i);
		if (block) for (let k = block[0]; k <= block[1]; k++) dirty.add(k);
	}
	if (dirty.size * 4 > n) return buildAll(state, s, old.editable, opts);

	const lines = [...dirty].sort((a, b) => a - b);
	const gone: Decoration[] = [];
	const fresh: Decoration[] = [];
	for (let r = 0; r < lines.length;) {
		let e = r;
		while (e + 1 < lines.length && lines[e + 1] === lines[e] + 1) e++;
		const a = s.starts[lines[r]];
		const b = s.starts[lines[e] + 1];
		// What lies on these lines; a widget at `b` belongs to the next line.
		for (const d of set.find(a, b))
			if (d.from === d.to ? d.from >= a && d.from < b : d.from < b && d.to > a) gone.push(d);
		r = e + 1;
	}
	for (const i of lines) lineDecorations(i, s, state, old.editable, opts, fresh);
	return { set: set.remove(gone).add(state.doc, fresh), editable: old.editable, scan: s };
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
	scan: Scan;
}

export const MarkdownSyntax = Extension.create<MarkdownSyntaxOptions>({
	name: 'markdownSyntax',

	addOptions() {
		return { highlights: false, imageUrl: () => null, wikiLinks: false, onWikiLink: () => {} };
	},

	addProseMirrorPlugins() {
		const opts = this.options;
		return [
			new Plugin<SyntaxState>({
				key,
				state: {
					init: (_config, state) => buildAll(state, scan(state, opts), true, opts),
					// Update on any doc or selection change so hover/active track live
					// (the lines that changed); all of it when the view flips between
					// view and edit mode.
					apply: (tr, old, oldState, newState) => {
						const editable = (tr.getMeta(key) as boolean | undefined) ?? old.editable;
						if (editable !== old.editable)
							return buildAll(
								newState,
								tr.docChanged ? scan(newState, opts) : old.scan,
								editable,
								opts
							);
						return tr.docChanged || tr.selectionSet
							? updateDecorations(tr, old, oldState, newState, opts)
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
					},
					handleClick(view, _pos, event) {
						const target = event.target;
						if (!(target instanceof Element)) return false;
						if (opts.wikiLinks) {
							const el = target.closest<HTMLElement>('[data-wiki-target]');
							if (el && (!view.editable || event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								opts.onWikiLink?.(el.dataset.wikiTarget ?? '');
								return true;
							}
						}
						const link = target.closest<HTMLAnchorElement>('a.md-link[href]');
						const href = link?.getAttribute('href');
						if (!href || !externalHref(href)) return false;
						event.preventDefault();
						if (opts.openLink) opts.openLink(href);
						else window.open(href, '_blank', 'noopener,noreferrer');
						return true;
					},
					handleKeyDown(_view, event) {
						if (!opts.wikiLinks || (event.key !== 'Enter' && event.key !== ' ')) return false;
						const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
							'[data-wiki-target]'
						);
						if (!el) return false;
						event.preventDefault();
						opts.onWikiLink?.(el.dataset.wikiTarget ?? '');
						return true;
					}
				}
			})
		];
	}
});
