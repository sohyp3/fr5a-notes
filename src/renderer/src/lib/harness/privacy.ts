import type { AiConfig, ProviderProfile } from './types';

/**
 * Notes hidden from cloud AI never leave the device for a non-local provider.
 * A note is hidden if it sits in a configured folder (or below one) or
 * carries `<!-- ai: local -->`. Local providers (hardware you control) may
 * read everything.
 */

const AI_LOCAL_RE = /^\s*<!--\s*ai:\s*local\s*-->\s*$/im;

const dirOf = (id: string) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '');
const clean = (f: string) => f.replace(/^\/+|\/+$/g, '');

/**
 * How folder `dir` is hidden from cloud AI: listed itself ('self'), inside a
 * listed folder ('parent', with that folder), or not at all (null).
 */
export function folderPrivacy(
	dir: string,
	folders: string[]
): { via: 'self' | 'parent'; folder: string } | null {
	const list = folders.map(clean);
	if (list.includes(dir)) return { via: 'self', folder: dir };
	const parent = list.find((f) => f === '' || dir.startsWith(`${f}/`));
	return parent === undefined ? null : { via: 'parent', folder: parent };
}

/** Hidden from cloud AI, judged from the index (`aiLocal` = the note's own marker). */
export function isHidden(note: { id: string; aiLocal?: boolean }, folders: string[]): boolean {
	return !!note.aiLocal || folderPrivacy(dirOf(note.id), folders) !== null;
}

export function isLocalOnly(id: string, content: string | null, config: AiConfig): boolean {
	if (content && AI_LOCAL_RE.test(content)) return true;
	return folderPrivacy(dirOf(id), config.localOnlyFolders) !== null;
}

/** Null when allowed, else a human-readable reason. */
export function blockedReason(
	id: string,
	content: string | null,
	profile: ProviderProfile,
	config: AiConfig
): string | null {
	if (profile.local || !isLocalOnly(id, content, config)) return null;
	return `"${id}" is hidden from cloud AI and ${profile.name} is not a local provider.`;
}
