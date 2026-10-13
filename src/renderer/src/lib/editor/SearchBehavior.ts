import { Extension } from '@tiptap/core';
import {
	Plugin,
	PluginKey,
	TextSelection,
	type EditorState,
	type Transaction
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface SearchMatch {
	from: number;
	to: number;
}

interface SearchState {
	query: string;
	matches: SearchMatch[];
	index: number;
}

type SearchMeta =
	{ kind: 'set'; query: string } | { kind: 'step'; direction: 1 | -1 } | { kind: 'clear' };

export interface SearchStatus {
	index: number;
	total: number;
}

export const searchKey = new PluginKey<SearchState>('noteSearch');

/** Case-insensitive literal matches, mapped to ProseMirror document positions. */
export function searchMatches(doc: PMNode, query: string): SearchMatch[] {
	if (!query.trim()) return [];
	const needle = query.toLowerCase();
	const found: SearchMatch[] = [];
	doc.descendants((node, pos) => {
		if (!node.isText || !node.text) return;
		const text = node.text.toLowerCase();
		let at = 0;
		while ((at = text.indexOf(needle, at)) !== -1) {
			found.push({ from: pos + at, to: pos + at + needle.length });
			at += Math.max(needle.length, 1);
		}
	});
	return found;
}

function firstFrom(matches: SearchMatch[], pos: number, direction: 1 | -1): number {
	if (!matches.length) return -1;
	if (direction === 1) {
		const i = matches.findIndex((m) => m.from >= pos);
		return i < 0 ? 0 : i;
	}
	for (let i = matches.length - 1; i >= 0; i--) if (matches[i].to <= pos) return i;
	return matches.length - 1;
}

function nextState(tr: Transaction, value: SearchState): SearchState {
	const meta = tr.getMeta(searchKey) as SearchMeta | undefined;
	if (meta?.kind === 'clear') return { query: '', matches: [], index: -1 };
	const query = meta?.kind === 'set' ? meta.query : value.query;
	const matches =
		meta?.kind === 'set' || tr.docChanged ? searchMatches(tr.doc, query) : value.matches;
	if (!matches.length) return { query, matches, index: -1 };
	if (meta?.kind === 'set') {
		return { query, matches, index: firstFrom(matches, tr.selection.head, 1) };
	}
	if (meta?.kind === 'step') {
		const current = value.index >= 0 && value.index < matches.length ? value.index : -1;
		const index =
			current < 0
				? firstFrom(matches, tr.selection.head, meta.direction)
				: (current + meta.direction + matches.length) % matches.length;
		return { query, matches, index };
	}
	const mapped = value.index >= 0 ? tr.mapping.map(value.matches[value.index]?.from ?? 0) : -1;
	return { query, matches, index: firstFrom(matches, mapped, 1) };
}

function dispatch(view: EditorView, meta: SearchMeta): SearchStatus {
	const tr = view.state.tr.setMeta(searchKey, meta);
	const next = nextState(
		tr,
		searchKey.getState(view.state) ?? { query: '', matches: [], index: -1 }
	);
	if (next.index >= 0) {
		const hit = next.matches[next.index];
		tr.setSelection(TextSelection.create(tr.doc, hit.from)).scrollIntoView();
	}
	view.dispatch(tr);
	return { index: next.index, total: next.matches.length };
}

export const setNoteSearch = (view: EditorView, query: string) =>
	dispatch(view, { kind: 'set', query });
export const stepNoteSearch = (view: EditorView, direction: 1 | -1) =>
	dispatch(view, { kind: 'step', direction });
export const clearNoteSearch = (view: EditorView) => dispatch(view, { kind: 'clear' });

export interface SearchOptions {
	onUpdate?: (status: SearchStatus) => void;
}

export const SearchBehavior = Extension.create<SearchOptions>({
	name: 'noteSearch',

	addOptions() {
		return { onUpdate: undefined };
	},

	addProseMirrorPlugins() {
		const options = this.options;
		let last = '';
		return [
			new Plugin<SearchState>({
				key: searchKey,
				state: {
					init: () => ({ query: '', matches: [], index: -1 }),
					apply: nextState
				},
				view() {
					return {
						update(view) {
							const state = searchKey.getState(view.state)!;
							const key = `${state.query}\0${state.index}\0${state.matches.length}`;
							if (key !== last) {
								last = key;
								options.onUpdate?.({ index: state.index, total: state.matches.length });
							}
						}
					};
				},
				props: {
					decorations(state: EditorState) {
						const search = searchKey.getState(state)!;
						return DecorationSet.create(
							state.doc,
							search.matches.map((m, i) =>
								Decoration.inline(m.from, m.to, {
									class: i === search.index ? 'note-search-hit active' : 'note-search-hit'
								})
							)
						);
					}
				}
			})
		];
	}
});
