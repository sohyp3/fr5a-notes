import type { PlatformApi } from '../platform/types';
import type { ConflictFile, GitChange, NoteMeta, ResolveChoice } from '../../../../shared/types';
import { isEncryptedNote, splitHeader } from '../../../../shared/encrypted';
import { noteSnippet } from '../../../../shared/snippet';
import { buildTagTree, parseTags } from '../../../../main/tags';

/** Reading an encrypted note while the key is locked. */
export class VaultLockedError extends Error {
	constructor() {
		super('Encrypted notes are locked. Unlock them to read this note.');
		this.name = 'VaultLockedError';
	}
}

/** The vault as the wrapper sees it. */
export interface NoteCrypt {
	/** The private key is in memory. */
	unlocked(): boolean;
	/** Plaintext → file text (public key only: works while locked). */
	encrypt(plain: string): Promise<string>;
	/** Encrypted file → plaintext (needs the unlocked key). */
	decrypt(raw: string): Promise<string>;
}

/** Note-list fields of a decrypted note (same rules as the indexers). */
function summarize(plain: string, fallback: string): Pick<NoteMeta, 'title' | 'snippet' | 'tags'> {
	const body = splitHeader(plain).body;
	const first = body.split('\n').find((l) => l.trim());
	return {
		title: first?.trim().replace(/^#{1,6}\s*/, '') || fallback,
		snippet: noteSnippet(body),
		tags: parseTags(body)
	};
}

/**
 * Note I/O for encrypted notes: decrypt on read, encrypt on write, and show
 * the real titles / tags / diffs while unlocked. Everything else (sync,
 * stash, move, trash, the indexes) only ever moves ciphertext. Plain notes
 * pass through byte for byte. `clear` drops what was decrypted (on lock).
 */
export function wrapNotes(host: PlatformApi, crypt: NoteCrypt) {
	const titles = new Map<string, { mtime: number } & ReturnType<typeof summarize>>();
	let conflicted = new Set<string>();

	/** Decrypted text when possible, else the text as it was. */
	const open = async (text: string | null): Promise<string | null> =>
		text !== null && crypt.unlocked() && isEncryptedNote(text)
			? crypt.decrypt(text).catch(() => text)
			: text;

	async function overlay(notes: NoteMeta[]): Promise<NoteMeta[]> {
		if (!crypt.unlocked()) return notes;
		return Promise.all(
			notes.map(async (n) => {
				if (!n.encrypted) return n;
				let t = titles.get(n.id);
				if (!t || t.mtime !== n.mtime) {
					try {
						const plain = await crypt.decrypt(await host.readNote(n.id));
						t = { mtime: n.mtime, ...summarize(plain, n.title) };
						titles.set(n.id, t);
					} catch {
						return n; // another key, or gone meanwhile
					}
				}
				return { ...n, title: t.title, snippet: t.snippet, tags: t.tags };
			})
		);
	}

	const changes = async (list: GitChange[]): Promise<GitChange[]> =>
		Promise.all(
			list.map(async (c) => ({ ...c, before: await open(c.before), after: await open(c.after) }))
		);

	const wrapped: Partial<PlatformApi> = {
		async readNote(id) {
			const raw = await host.readNote(id);
			if (!raw || !isEncryptedNote(raw)) return raw;
			if (!crypt.unlocked()) throw new VaultLockedError();
			return crypt.decrypt(raw);
		},

		async writeNote(id, content) {
			// Already a file's text (a metadata-only edit made while locked).
			if (isEncryptedNote(content)) return host.writeNote(id, content);
			const raw = await host.readNote(id).catch(() => null);
			if (raw && isEncryptedNote(raw)) {
				// Ciphertext differs every time: skip a no-op write, or git sees a change.
				if (crypt.unlocked() && (await crypt.decrypt(raw).catch(() => null)) === content) return;
				content = await crypt.encrypt(content);
			}
			return host.writeNote(id, content);
		},

		async listNotes() {
			return overlay(await host.listNotes());
		},

		async listTags() {
			if (!crypt.unlocked()) return host.listTags();
			const notes = await overlay(await host.listNotes());
			if (!notes.some((n) => n.encrypted && n.tags.length)) return host.listTags();
			return buildTagTree(notes.flatMap((n) => n.tags.map((tag) => ({ tag, noteId: n.id }))));
		},

		async syncConflicts() {
			const files = await host.syncConflicts();
			conflicted = new Set(
				files
					.filter((f) => [f.mine, f.theirs].some((t) => t !== null && isEncryptedNote(t)))
					.map((f) => f.path)
			);
			return Promise.all(
				files.map(async (f): Promise<ConflictFile> => ({
					...f,
					mine: await open(f.mine),
					theirs: await open(f.theirs)
				}))
			);
		},

		async syncResolve(choices) {
			const out = await Promise.all(
				choices.map(async (c): Promise<ResolveChoice> =>
					'content' in c && conflicted.has(c.path) && !isEncryptedNote(c.content)
						? { path: c.path, content: await crypt.encrypt(c.content) }
						: c
				)
			);
			return host.syncResolve(out);
		}
	};
	if (host.gitChanges) {
		const inner = host.gitChanges;
		wrapped.gitChanges = async () => {
			const list = await inner();
			return list && crypt.unlocked() ? changes(list) : list;
		};
	}
	if (host.gitStashes) {
		const inner = host.gitStashes;
		wrapped.gitStashes = async () => {
			const list = await inner();
			if (!crypt.unlocked()) return list;
			return Promise.all(list.map(async (s) => ({ ...s, files: await changes(s.files) })));
		};
	}

	return {
		methods: wrapped,
		/** Forget every decrypted title / tag (lock). */
		clear(): void {
			titles.clear();
		}
	};
}
