import { platform } from './platform';
import type { AppState } from './stores/app.svelte';
import { getAiSettings } from './harness/config.svelte';
import {
	APP_ASSETS_DIR,
	APP_CHATS_DIR,
	isAppNotePath,
	isHiddenPath,
	LEGACY_ASSETS_DIR,
	LEGACY_CHATS_DIR
} from '../../../shared/paths';
import { planStorageMigration, type StorageResult } from '../../../shared/storageMigration';

/**
 * Settings → General → Storage: the opt-in move of images (`assets/`) and
 * saved AI chats (the old chats folder) into `.fr5a/`. `scanStorage` counts
 * what would move (cheap: one folder listing plus the note index); the run
 * reads the notes, plans (`shared/storageMigration.ts`) and hands the plan to
 * the host, which keeps every mtime.
 */

export interface StorageScan {
	assets: string[];
	chats: string[];
	/** The folder the chats come from. */
	chatsDir: string;
	/** Encrypted notes that can't be read now (locked): their links can't be updated. */
	locked: number;
}

/** A chat written by "Save to notes": its preview starts with the byline (`*AI chat · …*`). */
const CHAT_SNIPPET = /^[*_]*AI chat(?: · |[*_]*(?:\s|$))/;

/** The saved-chats folder to empty: the setting when it's an ordinary folder, else the old default. */
function oldChatsDir(setting: string): string {
	const dir = setting.trim();
	return dir && !isHiddenPath(dir) ? dir : LEGACY_CHATS_DIR;
}

export async function scanStorage(app: AppState): Promise<StorageScan | null> {
	if (!platform.listImages || !platform.migrateStorage || !app.workspace) return null;
	const ai = getAiSettings();
	await ai.load();
	const chatsDir = oldChatsDir(ai.config.chatsFolder ?? '');
	const assets = await platform.listImages(LEGACY_ASSETS_DIR).catch(() => [] as string[]);
	const chats = app.notes
		.filter((n) => n.id.startsWith(`${chatsDir}/`) && CHAT_SNIPPET.test(n.snippet))
		.map((n) => n.id);
	const locked = app.vault?.unlocked ? 0 : app.notes.filter((n) => n.encrypted).length;
	return { assets, chats, chatsDir, locked };
}

/** Move what `scan` found; the chats setting follows the chats into `.fr5a/chats`. */
export async function runStorageMigration(
	app: AppState,
	scan: StorageScan
): Promise<StorageResult> {
	await app.flush();
	const notes = await Promise.all(
		app.notes.map(async (n) => ({
			id: n.id,
			text: await platform.readNote(n.id).catch(() => null)
		}))
	);
	const taken = [
		...(await platform.listImages!(APP_ASSETS_DIR).catch(() => [] as string[])),
		...app.notes.filter((n) => isAppNotePath(n.id)).map((n) => n.id)
	];
	const plan = planStorageMigration(
		{ assets: scan.assets, chats: scan.chats, notes, taken },
		LEGACY_ASSETS_DIR,
		scan.chatsDir
	);
	const res = await app.migrateStorage(plan);

	const chatMoves = new Map(
		plan.moves.filter((m) => isAppNotePath(m.to)).map((m) => [m.from, m.to] as const)
	);
	if (chatMoves.size) {
		const ai = getAiSettings();
		if (oldChatsDir(ai.config.chatsFolder ?? '') === scan.chatsDir)
			ai.update({ chatsFolder: APP_CHATS_DIR });
		const { hashText } = await import('./harness/session');
		// A chat whose links were rewritten keeps counting as unedited (`savedHash`).
		const before = new Map(notes.map((n) => [n.id, n.text]));
		const rehash = new Map<string, readonly [string, string]>();
		for (const r of plan.rewrites) {
			const to = chatMoves.get(r.id);
			const old = before.get(r.id);
			if (to && old != null) rehash.set(to, [hashText(old), hashText(r.text)]);
		}
		if (app.harnessLoaded) {
			const { getHarness } = await import('./harness/harness.svelte');
			for (const t of getHarness().tabs) {
				const h = t.session.saved && rehash.get(t.session.saved);
				if (h && t.session.savedHash === h[0]) {
					t.session.savedHash = h[1];
					t.scheduleSave();
				}
			}
		}
		await remapSessions(chatMoves, rehash).catch((err) => console.warn('[storage] sessions', err));
	}
	return res;
}

/** Working AI sessions that name a moved chat as their saved note follow it. */
async function remapSessions(
	moved: ReadonlyMap<string, string>,
	rehash: ReadonlyMap<string, readonly [string, string]>
): Promise<void> {
	const { DEVICE_DIR, SESSIONS_DIR, withSavedMoved } = await import('./harness/session');
	for (const dir of [`${SESSIONS_DIR}/${DEVICE_DIR}`, SESSIONS_DIR]) {
		const files = (await platform.listMeta(dir).catch(() => [] as string[])).filter((f) =>
			f.endsWith('.md')
		);
		for (const f of files) {
			const text = await platform.readMeta(`${dir}/${f}`);
			const next = text === null ? null : withSavedMoved(text, moved, rehash);
			if (next !== null) await platform.writeMeta(`${dir}/${f}`, next);
		}
	}
}
