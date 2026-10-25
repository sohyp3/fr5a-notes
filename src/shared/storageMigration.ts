import {
	APP_ASSETS_DIR,
	APP_CHATS_DIR,
	baseOf,
	encodeLinkSegment,
	isAppAssetPath,
	isAppNotePath,
	isHiddenPath,
	isImagePath,
	joinPath,
	LEGACY_ASSETS_DIR,
	LEGACY_CHATS_DIR,
	noteExt,
	parentOf,
	relativeLink
} from './paths';
import { isEncryptedNote } from './encrypted';

/**
 * The one-time move of app-written files into `.fr5a/` (Settings → General →
 * Storage): images from `assets/` → `.fr5a/assets/`, saved AI chats from the
 * old chats folder → `.fr5a/chats/`, and every Markdown link that pointed at a
 * moved file (or sat in a moved chat) rewritten. Pure: the hosts' executors
 * (`platform.migrateStorage`) only rename and write what the plan says.
 */

export interface StorageMove {
	from: string;
	to: string;
}

export interface StorageRewrite {
	/** The note's id before any move (rewrites run first, then the moves). */
	id: string;
	text: string;
}

export interface StoragePlan {
	moves: StorageMove[];
	rewrites: StorageRewrite[];
	/** Notes that couldn't be read (encrypted while locked): their links stay as they are. */
	skipped: string[];
}

export interface StorageResult {
	moved: number;
	rewritten: number;
	/** Notes left alone: unreadable, or encrypted while the vault is locked. */
	skipped: string[];
}

export interface StorageInput {
	/** Image files under the old `assets/` folder. */
	assets: string[];
	/** Saved chats to move (notes in the old chats folder). */
	chats: string[];
	/** Every note with its text; null when it can't be read (encrypted, locked). */
	notes: { id: string; text: string | null }[];
	/** Files already in `.fr5a/assets` / `.fr5a/chats`, so a move never lands on one. */
	taken?: string[];
}

/** `name` with ` 2`, ` 3`, … before the extension until it's free (the hosts' clash rule). */
function freePath(p: string, taken: Set<string>): string {
	if (!taken.has(p.toLowerCase())) return p;
	const dir = parentOf(p);
	const base = baseOf(p);
	const dot = base.lastIndexOf('.');
	const stem = dot > 0 ? base.slice(0, dot) : base;
	const ext = dot > 0 ? base.slice(dot) : '';
	for (let n = 2; ; n++) {
		const c = joinPath(dir, `${stem} ${n}${ext}`);
		if (!taken.has(c.toLowerCase())) return c;
	}
}

/** Where an image under `assets/` or a chat in `folder` goes. */
function targetOf(p: string, root: string, into: string): string {
	return joinPath(into, p.slice(root.length + 1));
}

/** Why a planned move isn't one the executors may run, or null. */
export function storageMoveError(m: StorageMove): string | null {
	if (!m.from || isHiddenPath(m.from)) return `Not movable: ${m.from}`;
	if (isImagePath(m.from)) return isAppAssetPath(m.to) ? null : `Not an image target: ${m.to}`;
	if (noteExt(m.from) && isAppNotePath(m.to) && noteExt(m.to)) return null;
	return `Not a storage move: ${m.from} → ${m.to}`;
}

/** Why a planned rewrite isn't allowed (only notes outside dot-folders, and saved chats), or null. */
export function storageRewriteError(r: StorageRewrite): string | null {
	return noteExt(r.id) && (!isHiddenPath(r.id) || isAppNotePath(r.id))
		? null
		: `Not a note: ${r.id}`;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** `[text](dest` / `![alt](dest` — the destination, bare or in `<…>`. */
const LINK_RE = /(!?\[[^\]\n]*\]\()(\s*)(<[^>\n]+>|[^\s)]+)/g;
const FENCE_RE = /^\s*(```|~~~)/;

/** Workspace path a link destination names from folder `dir`; null for URLs and climbs out. */
function resolve(dest: string, dir: string): { path: string; abs: boolean; tail: string } | null {
	if (SCHEME.test(dest) || dest.startsWith('#')) return null;
	const cut = dest.search(/[?#]/);
	const tail = cut === -1 ? '' : dest.slice(cut);
	let p = cut === -1 ? dest : dest.slice(0, cut);
	if (!p) return null;
	try {
		p = decodeURI(p);
	} catch {
		/* a stray % — as written */
	}
	const abs = p.startsWith('/');
	const parts = abs ? [] : dir.split('/').filter(Boolean);
	for (const seg of p.split('/')) {
		if (!seg || seg === '.') continue;
		if (seg !== '..') parts.push(seg);
		else if (!parts.pop()) return null;
	}
	return parts.length ? { path: parts.join('/'), abs, tail } : null;
}

/**
 * Note text with its links re-pointed: a link to a moved file names the new
 * place, and a note that moves itself keeps its relative links working.
 * Root-absolute links (`/assets/a.png`) stay absolute. Fenced code is left
 * alone. Null when nothing changed.
 */
export function rewriteLinks(
	text: string,
	fromDir: string,
	toDir: string,
	moved: ReadonlyMap<string, string>
): string | null {
	let fence = false;
	let changed = false;
	const lines = text.split('\n').map((line) => {
		if (FENCE_RE.test(line)) {
			fence = !fence;
			return line;
		}
		if (fence || !line.includes('](')) return line;
		return line.replace(LINK_RE, (all, open: string, space: string, raw: string) => {
			const angle = raw.startsWith('<');
			const dest = angle ? raw.slice(1, -1) : raw;
			const r = resolve(dest, fromDir);
			if (!r) return all;
			const to = moved.get(r.path);
			if (!to && (r.abs || fromDir === toDir)) return all;
			const target = to ?? r.path;
			const link = r.abs
				? `/${target.split('/').map(encodeLinkSegment).join('/')}`
				: relativeLink(toDir, target);
			const next = `${link}${r.tail}`;
			if (next === dest) return all;
			changed = true;
			return `${open}${space}${angle ? `<${next}>` : next}`;
		});
	});
	return changed ? lines.join('\n') : null;
}

/**
 * The plan for `input`: images under `assets/` (`assetsDir`) and the given
 * chats (from `chatsDir`) move into `.fr5a/`, keeping their sub-paths, and
 * every readable note that links to a moved file (or is a moved chat with
 * relative links) is rewritten.
 */
export function planStorageMigration(
	input: StorageInput,
	assetsDir = LEGACY_ASSETS_DIR,
	chatsDir = LEGACY_CHATS_DIR
): StoragePlan {
	const taken = new Set((input.taken ?? []).map((p) => p.toLowerCase()));
	const moves: StorageMove[] = [];
	const moved = new Map<string, string>();
	const add = (from: string, to: string) => {
		const dest = freePath(to, taken);
		taken.add(dest.toLowerCase());
		moves.push({ from, to: dest });
		moved.set(from, dest);
	};
	const notes = input.notes.filter((n) => !isHiddenPath(n.id) || isAppNotePath(n.id));
	// Ciphertext can't be rewritten either (encrypted, read without the vault).
	const unreadable = (text: string | null): text is null => text === null || isEncryptedNote(text);
	const skipped = notes.filter((n) => unreadable(n.text)).map((n) => n.id);
	// A note that can't be read may link to any image: they all stay until it can.
	if (!skipped.length)
		for (const p of input.assets)
			if (p.startsWith(`${assetsDir}/`) && isImagePath(p) && !isHiddenPath(p))
				add(p, targetOf(p, assetsDir, APP_ASSETS_DIR));
	for (const p of input.chats)
		if (p.startsWith(`${chatsDir}/`) && noteExt(p) && !isHiddenPath(p))
			add(p, targetOf(p, chatsDir, APP_CHATS_DIR));

	const rewrites: StorageRewrite[] = [];
	for (const n of notes) {
		if (unreadable(n.text)) continue;
		const to = moved.get(n.id) ?? n.id;
		const text = rewriteLinks(n.text, parentOf(n.id), parentOf(to), moved);
		if (text !== null) rewrites.push({ id: n.id, text });
	}
	return { moves, rewrites, skipped };
}

/** A saved AI chat's byline (`sessionToNote`): `*AI chat · 2026-05-01 · …*`. */
const CHAT_BYLINE = /^\*AI chat(?: · [^\n]*)?\*\s*$/m;

/** True when a note's text is a chat written by "Save to notes". */
export function isSavedChat(text: string): boolean {
	return CHAT_BYLINE.test(text.split('\n').slice(0, 8).join('\n'));
}
