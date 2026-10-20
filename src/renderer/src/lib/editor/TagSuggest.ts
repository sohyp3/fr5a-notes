import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import type { TagNode } from '../../../../shared/types';
import { span, suggestMenu } from './suggestMenu';

/**
 * Tag autocomplete: typing `#` opens a floating Bear-style dropdown fed by the
 * SQLite tag index (the same listTags data the sidebar shows). Tab completes
 * the highlighted tag; arrows navigate; Escape dismisses. If nothing matches,
 * no dropdown is shown and the `#` behaves as plain text.
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

				render: suggestMenu<string>((item) => [span('hash', '#'), document.createTextNode(item)])
			})
		];
	}
});
