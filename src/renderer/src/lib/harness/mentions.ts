import type { NoteMeta } from '../../../../shared/types';
import { remapPath } from '../../../../shared/paths';

/**
 * Context mentions in the harness input:
 *   @drafts/post.md   a note (id or exact title; quote ids with spaces: @"My note.md")
 *   @Work/            every note in a folder (recursive)
 *   @#research        every note tagged #research (or #research/…)
 * A mention is stored by its canonical key (`a.md`, `@Work/`, `#research`) in
 * the tab and in the session frontmatter.
 */

export type MentionKind = 'note' | 'dir' | 'tag';

export interface Mention {
	kind: MentionKind;
	value: string;
}

const TOKEN_RE = /@"([^"]+)"|@(\S+)/g;

export function classify(raw: string): Mention | null {
	const t = raw;
	if (!t) return null;
	if (t.startsWith('#')) return t.length > 1 ? { kind: 'tag', value: t.slice(1) } : null;
	if (t.endsWith('/')) return { kind: 'dir', value: t.replace(/^\/+|\/+$/g, '') };
	return { kind: 'note', value: t };
}

export function parseMentions(text: string): Mention[] {
	const out: Mention[] = [];
	for (const m of text.matchAll(TOKEN_RE)) {
		const mention = classify(m[1] ?? m[2].replace(/[,;:!?)]+$/, ''));
		if (mention) out.push(mention);
	}
	return out;
}

export function mentionKey(m: Mention): string {
	return m.kind === 'dir' ? `@${m.value}/` : m.kind === 'tag' ? `#${m.value}` : m.value;
}

export function fromKey(key: string): Mention {
	if (key.startsWith('#')) return { kind: 'tag', value: key.slice(1) };
	if (key.startsWith('@') && key.endsWith('/')) return { kind: 'dir', value: key.slice(1, -1) };
	return { kind: 'note', value: key };
}

/** A stored mention key after a note / folder moved from `from` to `to` (tags never move). */
export function remapKey(key: string, from: string, to: string): string {
	const m = fromKey(key);
	if (m.kind === 'tag') return key;
	const next = remapPath(m.value, from, to);
	return next === null ? key : mentionKey({ ...m, value: next });
}

/** How a mention is typed back into the input (quoted when it has spaces). */
export function mentionText(m: Mention): string {
	const body = m.kind === 'dir' ? `${m.value}/` : m.kind === 'tag' ? `#${m.value}` : m.value;
	return /\s/.test(body) ? `@"${body}"` : `@${body}`;
}

/** Note ids a mention stands for (a note mention may match by id or title). */
export function resolveMention(m: Mention, notes: NoteMeta[]): string[] {
	if (m.kind === 'note') {
		const hit = notes.find((n) => n.id === m.value) ?? notes.find((n) => n.title === m.value);
		return hit ? [hit.id] : [];
	}
	if (m.kind === 'dir') {
		const prefix = m.value ? `${m.value}/` : '';
		return notes.filter((n) => n.id.startsWith(prefix)).map((n) => n.id);
	}
	const t = m.value.toLowerCase();
	return notes
		.filter((n) =>
			n.tags.some((tag) => tag.toLowerCase() === t || tag.toLowerCase().startsWith(`${t}/`))
		)
		.map((n) => n.id);
}

export interface Expanded {
	/** Note ids to attach with full content, open note first, deduped. */
	ids: string[];
	/** Per folder/tag mention: every matching id (for an index the model can read_note from). */
	groups: { key: string; ids: string[] }[];
	/** Matches left out by the cap. */
	omitted: number;
	/** Mentions that matched nothing. */
	missing: string[];
}

/** Expand mention keys into note ids, capping how many notes get inlined. */
export function expandMentions(
	keys: string[],
	notes: NoteMeta[],
	first: string[] = [],
	cap = 25
): Expanded {
	const ids: string[] = [];
	const groups: Expanded['groups'] = [];
	const missing: string[] = [];
	let omitted = 0;
	const add = (id: string) => {
		if (ids.includes(id)) return;
		if (ids.length >= cap) omitted++;
		else ids.push(id);
	};
	first.forEach(add);
	for (const key of keys) {
		const m = fromKey(key);
		const hit = resolveMention(m, notes);
		if (!hit.length) missing.push(key);
		if (m.kind !== 'note') groups.push({ key, ids: hit });
		hit.forEach(add);
	}
	return { ids, groups, omitted, missing };
}
