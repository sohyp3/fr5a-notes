/**
 * Tag parsing + nesting.
 *
 * A tag is `#` followed by a run of word characters, dashes and slashes.
 * Slashes denote nesting, so `#work/project1/todo` is three levels deep.
 * We deliberately require the `#` to be preceded by start-of-string or
 * whitespace so that `https://foo#bar` and CSS `#fff` don't match.
 */

// A tag segment starts with a Unicode letter (so Arabic `#عمل` works too) and
// may contain letters, marks, digits, `_` and `-`. Slashes separate nesting.
const TAG_RE = /(?:^|\s)#(\p{L}[\p{L}\p{M}\p{N}_-]*(?:\/[\p{L}\p{M}\p{N}_-]+)*)/gu;

export function parseTags(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(TAG_RE)) {
		// Trim a trailing slash just in case (`#work/`).
		found.add(match[1].replace(/\/+$/, ''));
	}
	return [...found];
}

export interface TagNode {
	/** Leaf label, e.g. `project1`. */
	name: string;
	/** Full path from the root, e.g. `work/project1`. */
	path: string;
	/** Notes tagged with exactly this path or any of its descendants. */
	count: number;
	children: TagNode[];
}

/**
 * Build a nested tag tree from a flat list of `(tag, noteId)` pairs.
 * A note counts once toward every prefix of every tag it carries, so a note
 * tagged `#work/project1` contributes to both `work` and `work/project1`.
 */
export function buildTagTree(pairs: { tag: string; noteId: string }[]): TagNode[] {
	const roots: TagNode[] = [];
	const index = new Map<string, TagNode>();
	// Track distinct notes per node so a note tagged twice under the same
	// prefix isn't double counted.
	const seen = new Map<string, Set<string>>();

	const ensure = (path: string): TagNode => {
		let node = index.get(path);
		if (node) return node;

		const slash = path.lastIndexOf('/');
		const name = slash === -1 ? path : path.slice(slash + 1);
		node = { name, path, count: 0, children: [] };
		index.set(path, node);
		seen.set(path, new Set());

		if (slash === -1) {
			roots.push(node);
		} else {
			ensure(path.slice(0, slash)).children.push(node);
		}
		return node;
	};

	for (const { tag, noteId } of pairs) {
		const segments = tag.split('/');
		let prefix = '';
		for (const segment of segments) {
			prefix = prefix ? `${prefix}/${segment}` : segment;
			ensure(prefix);
			const notes = seen.get(prefix)!;
			if (!notes.has(noteId)) {
				notes.add(noteId);
				index.get(prefix)!.count++;
			}
		}
	}

	const sortRec = (nodes: TagNode[]) => {
		nodes.sort((a, b) => a.name.localeCompare(b.name));
		for (const n of nodes) sortRec(n.children);
	};
	sortRec(roots);
	return roots;
}
