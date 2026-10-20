import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey, TextSelection } from '@tiptap/pm/state';
import type { NoteMeta } from '../../../../shared/types';
import { parentOf } from '../../../../shared/paths';
import { relativeLink } from './images';
import { span, suggestMenu } from './suggestMenu';

/**
 * Note-link autocomplete (linked notes on). Writing a link — `[my text](` —
 * lists notes by title; picking one fills in its path relative to this note,
 * `[my text](path/to/note.md)`. A link with no text yet (`[](`, what
 * Insert → Link to note types) takes the note's title, selected so it can be
 * typed over.
 */

export interface NoteLinkSuggestOptions {
	/** Notes a link may point at (hidden folders already left out). */
	getNotes: () => readonly NoteMeta[];
	/** The open note's id, or the path a draft will be saved at: links are relative to its folder. */
	fromId: () => string;
}

const MAX_ITEMS = 8;

function rank(notes: readonly NoteMeta[], query: string, fromId: string): NoteMeta[] {
	const q = query.trim().toLowerCase();
	const scored: { note: NoteMeta; score: number }[] = [];
	for (const note of notes) {
		if (note.id === fromId) continue;
		const title = note.title.toLowerCase();
		const score = !q
			? 0
			: title.startsWith(q)
				? 0
				: title.includes(q)
					? 1
					: note.id.toLowerCase().includes(q)
						? 2
						: -1;
		if (score >= 0) scored.push({ note, score });
	}
	// Best match first; among equals, the most recently edited.
	scored.sort((a, b) => a.score - b.score || b.note.mtime - a.note.mtime);
	return scored.slice(0, MAX_ITEMS).map((s) => s.note);
}

const row = (note: NoteMeta): Node[] => {
	const dir = parentOf(note.id);
	return dir
		? [span('title', note.title || note.id), span('dir', dir)]
		: [span('title', note.title || note.id)];
};

export const NoteLinkSuggest = Extension.create<NoteLinkSuggestOptions>({
	name: 'noteLinkSuggest',
	// Beat ListBehavior's Tab / Enter while the dropdown is open.
	priority: 1000,

	addOptions() {
		return { getNotes: () => [], fromId: () => '' };
	},

	addProseMirrorPlugins() {
		const items = ({ query }: { query: string }) =>
			rank(this.options.getNotes(), query, this.options.fromId());
		return [
			// `[text](pa` → `[text](path/to/note.md)`, the caret after it;
			// `[](pa` → `[Title](path/to/note.md)`, the title selected.
			Suggestion<NoteMeta>({
				editor: this.editor,
				pluginKey: new PluginKey('noteHrefSuggest'),
				char: '](',
				allowSpaces: false,
				allowedPrefixes: null,
				// Only a link's destination, not an image's.
				allow: ({ state, range }) => {
					const $from = state.doc.resolve(range.from);
					const before = state.doc.textBetween($from.start(), range.from);
					return /(?:^|[^!])\[[^\]]*$/.test(before);
				},
				items,
				command: ({ editor, range, props: note }) => {
					const href = relativeLink(parentOf(this.options.fromId()), note.id);
					const { doc } = editor.state;
					const closed = doc.textBetween(range.to, range.to + 1) === ')';
					const untitled = doc.textBetween(range.from - 1, range.from) === '[';
					const title = untitled ? (note.title || note.id).replace(/[[\]\n]/g, ' ').trim() : '';
					editor
						.chain()
						.focus()
						.command(({ tr }) => {
							const to = range.to + (closed ? 1 : 0);
							tr.insertText(`${title}](${href})`, range.from, to);
							const at = range.from + title.length + href.length + 3;
							tr.setSelection(
								untitled
									? TextSelection.create(tr.doc, range.from, range.from + title.length)
									: TextSelection.create(tr.doc, at)
							);
							return true;
						})
						.run();
				},
				render: suggestMenu(row)
			})
		];
	}
});
