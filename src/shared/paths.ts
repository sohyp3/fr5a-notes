/**
 * Workspace paths for moving / renaming notes and folders. Shared by both
 * hosts (main/fileService.ts, the Android platform) and the renderer, so the
 * rules can't drift. Paths are workspace-relative with `/` separators.
 */

const NOTE_EXT = /\.(md|markdown|mdown|txt)$/i;

export function parentOf(p: string): string {
	const i = p.lastIndexOf('/');
	return i === -1 ? '' : p.slice(0, i);
}

export function baseOf(p: string): string {
	return p.slice(p.lastIndexOf('/') + 1);
}

export function joinPath(dir: string, name: string): string {
	return dir ? `${dir}/${name}` : name;
}

/** The note's extension ('' when it has none). */
export function noteExt(p: string): string {
	return NOTE_EXT.exec(p)?.[0] ?? '';
}

/** A note's file name without its extension (what Rename edits). */
export function noteStem(p: string): string {
	const base = baseOf(p);
	return base.slice(0, base.length - noteExt(base).length);
}

/**
 * One user-typed path segment made safe: separators and reserved characters
 * become `-`, and leading dots go (a dot-name would hide the note from the
 * index). '' when nothing usable is left.
 */
export function cleanName(name: string): string {
	return name
		.trim()
		.replace(/[/\\?%*:|"<>]/g, '-')
		.replace(/^\.+/, '')
		.trim();
}

/** A new note's filename stem, derived from its title without spaces. */
export function noteFileStem(title: string): string {
	return (
		title
			.trim()
			.replace(/[/\\?%*:|"<>]/g, '-')
			.replace(/\s+/g, '_') || 'Untitled'
	);
}

/** A typed `a/b` folder path, each segment cleaned ('' = workspace root). */
export function cleanFolder(path: string): string {
	return path.split('/').map(cleanName).filter(Boolean).join('/');
}

/** A typed saved-chats folder: `.fr5a/chats` stays as it is, anything else goes through `cleanFolder`. */
export function cleanChatsFolder(path: string): string {
	const p = path
		.split('/')
		.map((s) => s.trim())
		.filter(Boolean)
		.join('/');
	return p === APP_CHATS_DIR ? p : cleanFolder(p);
}

/** Rename target: `name` keeps the note's extension unless it brings its own. */
export function withNoteExt(name: string, id: string): string {
	return noteExt(name) ? name : `${name}${noteExt(id) || '.md'}`;
}

/** True when a path has a dot-segment (`.fr5a`, `.git`, …), which the index skips. */
export function isHiddenPath(p: string): boolean {
	return p.split('/').some((s) => s.startsWith('.'));
}

/** `id` re-rooted from `from` (a note or folder) to `to`; null when it isn't at or under `from`. */
export function remapPath(id: string, from: string, to: string): string | null {
	if (id === from) return to;
	return from && id.startsWith(`${from}/`) ? `${to}${id.slice(from.length)}` : null;
}

/** Why a folder can't move from `from` to `to` (both cleaned), or null when it can. */
export function folderMoveError(from: string, to: string): string | null {
	if (!from) return 'The workspace root can’t be moved.';
	if (!to) return 'The folder needs a name.';
	if (isHiddenPath(from) || isHiddenPath(to)) return 'Hidden folders can’t be moved.';
	if (to.startsWith(`${from}/`)) return 'A folder can’t move into itself.';
	return null;
}

/** Why folder `path` (cleaned) can't be deleted, or null when it can. */
export function folderDeleteError(path: string): string | null {
	if (!path) return 'The workspace root can’t be deleted.';
	if (isHiddenPath(path)) return 'Hidden folders can’t be deleted.';
	return null;
}

/** Why a note can't move to `to`, or null when it can. */
export function noteMoveError(id: string, to: string): string | null {
	if (!id || !to || !baseOf(to)) return 'The note needs a name.';
	// Saved AI chats (`.fr5a/chats/`) are notes too: they may move in and out.
	const hidden = (p: string) => isHiddenPath(p) && !isAppNotePath(p);
	if (hidden(id) || hidden(to)) return 'Notes can’t move into hidden folders.';
	if (!noteExt(to)) return 'Notes keep a Markdown or text extension.';
	return null;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

/** Image files the editor shows and the hosts serve / save (`.fr5a/assets/…`). */
export function isImagePath(p: string): boolean {
	return IMAGE_EXT.test(p);
}

/** Workspace path `to` as a link from folder `dir`: `../assets/a.png`. */
export function relativeLink(dir: string, to: string): string {
	const from = dir.split('/').filter(Boolean);
	const target = to.split('/');
	let i = 0;
	while (i < from.length && i < target.length - 1 && from[i] === target[i]) i++;
	return [...from.slice(i).map(() => '..'), ...target.slice(i).map(encodeLinkSegment)].join('/');
}

/** Characters that would end or break a Markdown link destination. */
export function encodeLinkSegment(s: string): string {
	return s.replace(
		/[\s()<>%]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
	);
}

// --- app files under `.fr5a/` ------------------------------------------------------

/** The workspace's hidden app folder (AI sessions, skills, images, saved chats, maps). */
export const APP_DIR = '.fr5a';
/** Pasted / dropped / inserted images. */
export const APP_ASSETS_DIR = '.fr5a/assets';
/** "Save to notes" AI chats: the one hidden folder the note index scans. */
export const APP_CHATS_DIR = '.fr5a/chats';
/** Where images went before they moved into `.fr5a/` (workspace root). */
export const LEGACY_ASSETS_DIR = 'assets';
/** The saved-chats folder older versions defaulted to. */
export const LEGACY_CHATS_DIR = 'AI chats';

/** `p` sits under `dir` with no further dot-segment (so `.fr5a/assets/.git/x` is out). */
function plainlyUnder(p: string, dir: string): boolean {
	return p.startsWith(`${dir}/`) && !isHiddenPath(p.slice(dir.length + 1));
}

/** An image path the hosts may save and serve inside `.fr5a/` (`.fr5a/assets/…`). */
export function isAppAssetPath(p: string): boolean {
	return plainlyUnder(p, APP_ASSETS_DIR) && isImagePath(p);
}

/** A path in (or the) saved-chats folder, which the note index scans despite the dot. */
export function isAppNotePath(p: string): boolean {
	return p === APP_CHATS_DIR || plainlyUnder(p, APP_CHATS_DIR);
}

/**
 * Whether the note scanners (desktop scan + watcher, the Capacitor walk) look
 * at workspace path `p`: everything outside dot-folders, plus `.fr5a/chats/`
 * (and `.fr5a` itself, to reach it). The one defined exception.
 */
export function isScannedPath(p: string): boolean {
	return !isHiddenPath(p) || isAppNotePath(p) || p === APP_DIR;
}

/** A hidden path that isn't one of the app's own: refused for writing images. */
export function isAssetPathAllowed(p: string): boolean {
	return isImagePath(p) && (!isHiddenPath(p) || isAppAssetPath(p));
}
