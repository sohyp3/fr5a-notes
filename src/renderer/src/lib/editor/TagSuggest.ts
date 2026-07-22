import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import type { TagNode } from '../../../../shared/types';

/**
 * Tag autocomplete: typing `#` opens a floating Bear-style dropdown fed by the
 * SQLite tag index (the same listTags data the sidebar shows). Tab completes
 * the highlighted tag; arrows navigate; Escape dismisses. If nothing matches,
 * no dropdown is shown and the `#` behaves as plain text.
 *
 * The dropdown is plain DOM (not a Svelte component): it lives outside the
 * editor's ProseMirror DOM, is created/destroyed by the Suggestion lifecycle,
 * and needs no reactivity beyond the keystrokes the plugin already delivers.
 */

export interface TagSuggestOptions {
	/** Every known tag path (e.g. `work/project1`), from the index. */
	getTags: () => string[];
}

/** Flatten the nested sidebar tag tree into full paths for matching. */
export function flattenTagTree(nodes: TagNode[]): string[] {
	const out: string[] = [];
	const walk = (ns: TagNode[]): void => {
		for (const n of ns) {
			out.push(n.path);
			walk(n.children);
		}
	};
	walk(nodes);
	return out;
}

const MAX_ITEMS = 8;

export const TagSuggest = Extension.create<TagSuggestOptions>({
	name: 'tagSuggest',
	// Beat ListBehavior's Tab handler while the dropdown is open.
	priority: 1000,

	addOptions() {
		return { getTags: () => [] };
	},

	addProseMirrorPlugins() {
		return [
			Suggestion<string>({
				editor: this.editor,
				pluginKey: new PluginKey('tagSuggest'),
				char: '#',
				allowSpaces: false,

				items: ({ query }) => {
					const q = query.toLowerCase();
					const tags = this.options.getTags();
					// Prefix matches first (Bear behaviour), then substring matches.
					const prefix = tags.filter((t) => t.toLowerCase().startsWith(q));
					const inner = q
						? tags.filter((t) => !t.toLowerCase().startsWith(q) && t.toLowerCase().includes(q))
						: [];
					return [...prefix, ...inner].slice(0, MAX_ITEMS);
				},

				command: ({ editor, range, props }) => {
					editor.chain().focus().insertContentAt(range, `#${props} `).run();
				},

				render: () => {
					let el: HTMLDivElement | null = null;
					let items: string[] = [];
					let selected = 0;
					let pick: (item: string) => void = () => {};

					const destroy = (): void => {
						el?.remove();
						el = null;
					};

					const paint = (): void => {
						if (!el) return;
						el.innerHTML = '';
						items.forEach((item, i) => {
							const row = document.createElement('button');
							row.type = 'button';
							row.className = 'tag-suggest-item' + (i === selected ? ' active' : '');
							const hash = document.createElement('span');
							hash.className = 'hash';
							hash.textContent = '#';
							row.append(hash, document.createTextNode(item));
							// mousedown, not click — click fires after the editor regains
							// focus and the suggestion range may already be gone.
							row.addEventListener('mousedown', (e) => {
								e.preventDefault();
								pick(item);
							});
							el!.appendChild(row);
						});
					};

					const position = (clientRect?: (() => DOMRect | null) | null): void => {
						const rect = clientRect?.();
						if (!el || !rect) return;
						el.style.left = `${Math.min(rect.left, window.innerWidth - el.offsetWidth - 12)}px`;
						el.style.top = `${rect.bottom + 6}px`;
					};

					return {
						onStart: (props) => {
							items = props.items;
							selected = 0;
							pick = (item) => props.command(item);
							if (items.length === 0) return; // no match → no dropdown
							el = document.createElement('div');
							el.className = 'tag-suggest';
							document.body.appendChild(el);
							paint();
							position(props.clientRect);
						},

						onUpdate: (props) => {
							items = props.items;
							selected = Math.min(selected, Math.max(0, items.length - 1));
							pick = (item) => props.command(item);
							if (items.length === 0) {
								destroy();
								return;
							}
							if (!el) {
								el = document.createElement('div');
								el.className = 'tag-suggest';
								document.body.appendChild(el);
							}
							paint();
							position(props.clientRect);
						},

						onKeyDown: ({ event }) => {
							if (!el || items.length === 0) return false;
							if (event.key === 'ArrowDown') {
								selected = (selected + 1) % items.length;
								paint();
								return true;
							}
							if (event.key === 'ArrowUp') {
								selected = (selected + items.length - 1) % items.length;
								paint();
								return true;
							}
							// Tab completes the highlighted tag (Enter works too).
							if (event.key === 'Tab' || event.key === 'Enter') {
								pick(items[selected]);
								return true;
							}
							if (event.key === 'Escape') {
								destroy();
								return true;
							}
							return false;
						},

						onExit: destroy
					};
				}
			})
		];
	}
});
