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

/** A typed `a/b` folder path, each segment cleaned ('' = workspace root). */
export function cleanFolder(path: string): string {
	return path.split('/').map(cleanName).filter(Boolean).join('/');
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

/** Why a note can't move to `to`, or null when it can. */
export function noteMoveError(id: string, to: string): string | null {
	if (!id || !to || !baseOf(to)) return 'The note needs a name.';
	if (isHiddenPath(id) || isHiddenPath(to)) return 'Notes can’t move into hidden folders.';
	if (!noteExt(to)) return 'Notes keep a Markdown or text extension.';
	return null;
}
