import type { PrivateKey, PublicKey } from 'openpgp';
import { splitEncrypted, splitHeader } from '../../../../shared/encrypted';

/**
 * OpenPGP for encrypted notes. The library (~250 KB) is a lazy chunk that loads
 * only once encryption is switched on. Keys are curve25519 (fast on phones,
 * readable by `gpg`), and note bodies go in as raw UTF-8 bytes so they come
 * back byte for byte.
 */

type Lib = typeof import('openpgp');
let lib: Promise<Lib> | null = null;
const load = (): Promise<Lib> => (lib ??= import('openpgp/lightweight') as Promise<Lib>);

export type { PrivateKey, PublicKey };

export interface KeyInfo {
	fingerprint: string;
	/** First user id, e.g. "fr5a <me@example.com>" ('' when none). */
	userId: string;
}

/** A readable reason for a failed key / message operation. */
export function pgpError(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	if (/Incorrect key passphrase/i.test(msg)) return 'Wrong passphrase.';
	if (/not of type private key/i.test(msg)) return 'That is a public key. Paste the private key.';
	if (/Misformed armored text|Unknown ASCII armor/i.test(msg))
		return 'That doesn’t look like an armored PGP key.';
	if (/No decryption key packets|Session key decryption failed/i.test(msg))
		return 'This note was encrypted with a different key.';
	if (/argon2/i.test(msg))
		return 'Keys protected with Argon2 aren’t supported. Re-export it with the default protection.';
	return msg;
}

export async function generateKey(name: string, passphrase: string): Promise<string> {
	const pgp = await load();
	const { privateKey } = await pgp.generateKey({
		type: 'ecc',
		curve: 'curve25519Legacy',
		userIDs: [{ name: name.trim() || 'fr5a' }],
		passphrase,
		format: 'armored'
	});
	return privateKey;
}

/**
 * Check a pasted private key and make sure it is passphrase-protected (an
 * unprotected one is protected with `passphrase`). Returns the armored key
 * to store; throws when it can't encrypt or the passphrase is wrong.
 */
export async function prepareKey(armored: string, passphrase: string): Promise<string> {
	const pgp = await load();
	const key = await pgp.readPrivateKey({ armoredKey: armored.trim() });
	await key.getEncryptionKey(); // throws when the key has no encryption subkey
	if (key.isDecrypted()) return (await pgp.encryptKey({ privateKey: key, passphrase })).armor();
	await pgp.decryptKey({ privateKey: key, passphrase });
	return key.armor();
}

/** Public half + identity of a stored key (no passphrase needed). */
export async function readKey(armored: string): Promise<{ info: KeyInfo; publicKey: PublicKey }> {
	const pgp = await load();
	const key = await pgp.readPrivateKey({ armoredKey: armored });
	return {
		info: { fingerprint: key.getFingerprint(), userId: key.getUserIDs()[0] ?? '' },
		publicKey: key.toPublic()
	};
}

/** The usable private key; throws on a wrong passphrase. */
export async function unlockKey(armored: string, passphrase: string): Promise<PrivateKey> {
	const pgp = await load();
	const key = await pgp.readPrivateKey({ armoredKey: armored });
	return pgp.decryptKey({ privateKey: key, passphrase });
}

/** Note text → the file: metadata lines stay in the clear, the rest becomes armor. */
export async function encryptNote(plain: string, publicKey: PublicKey): Promise<string> {
	const pgp = await load();
	const { head, body } = splitHeader(plain);
	const armor = await pgp.encrypt({
		message: await pgp.createMessage({ binary: new TextEncoder().encode(body) }),
		encryptionKeys: publicKey
	});
	return head + armor;
}

/** An encrypted file → the note text. Plain files come back unchanged. */
export async function decryptNote(raw: string, privateKey: PrivateKey): Promise<string> {
	const parts = splitEncrypted(raw);
	if (!parts) return raw;
	const pgp = await load();
	const { data } = await pgp.decrypt({
		message: await pgp.readMessage({ armoredMessage: parts.armor }),
		decryptionKeys: privateKey,
		format: 'binary'
	});
	return parts.head + new TextDecoder().decode(data);
}
