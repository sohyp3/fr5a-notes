import { hostPlatform, platform } from '../platform';
import * as pgp from './pgp';
import { wrapNotes } from './wrap';

/** Secure-storage name of the armored private key (still passphrase-protected). */
const KEY_SECRET = 'pgp:key';
/** Secure-storage name of the passphrase, when "Remember passphrase" is on. */
const PASS_SECRET = 'pgp:passphrase';

export interface VaultHooks {
	/** Before the key goes: save pending edits, close the decrypted note. */
	beforeLock(): Promise<void>;
	/** After unlock / lock / a key change: titles, tags and diffs read differently. */
	changed(): void;
	/** Idle (or backgrounded) this long → lock. 0 = only on quit / Lock. */
	autoLockMinutes(): number;
}

/**
 * Encryption while it's switched on: the key, lock state and auto-lock, plus
 * the note-I/O wrapper installed on `platform`. The private key lives only
 * in this object (never in `$state`), and `lock()` / quitting drop it. The
 * stored copy is the armored key, still passphrase-protected, in the OS
 * keyring (desktop) or the Android Keystore — never in settings, notes or git.
 */
export class Vault {
	/** A key is set up on this device. */
	hasKey = $state(false);
	/** The private key is in memory: encrypted notes can be read. */
	unlocked = $state(false);
	/** The passphrase is kept in secure storage: unlocking needs no typing. */
	remembered = $state(false);
	info = $state<pgp.KeyInfo | null>(null);

	#hooks: VaultHooks;
	#armored: string | null = null;
	#public: pgp.PublicKey | null = null;
	#private: pgp.PrivateKey | null = null;
	#wrap: ReturnType<typeof wrapNotes>;
	#lastActive = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;

	private constructor(hooks: VaultHooks) {
		this.#hooks = hooks;
		this.#wrap = wrapNotes(hostPlatform, {
			unlocked: () => this.#private !== null,
			encrypt: (plain) => this.encrypt(plain),
			decrypt: (raw) => pgp.decryptNote(raw, this.#private!)
		});
		Object.assign(platform, this.#wrap.methods);
	}

	static async start(hooks: VaultHooks): Promise<Vault> {
		const v = new Vault(hooks);
		await v.#use(await hostPlatform.getSecret(KEY_SECRET));
		v.remembered = (await hostPlatform.getSecret(PASS_SECRET)) !== null;
		await v.unlockSaved();
		return v;
	}

	/** Unlock with the remembered passphrase. False when there is none or it no longer fits. */
	async unlockSaved(): Promise<boolean> {
		if (this.#private) return true;
		if (!this.remembered || !this.#armored) return false;
		const pass = await hostPlatform.getSecret(PASS_SECRET);
		return pass !== null && (await this.unlock(pass, false)) === null;
	}

	/** Keep the passphrase in secure storage (checked against the key first). */
	async remember(passphrase: string): Promise<string | null> {
		if (!this.#armored) return 'No key on this device.';
		try {
			await pgp.unlockKey(this.#armored, passphrase);
		} catch (err) {
			return pgp.pgpError(err);
		}
		await hostPlatform.setSecret(PASS_SECRET, passphrase);
		this.remembered = true;
		if (!this.#private) await this.unlock(passphrase);
		return null;
	}

	/** Delete the remembered passphrase from this device. */
	async forgetPassphrase(): Promise<void> {
		await hostPlatform.setSecret(PASS_SECRET, null);
		this.remembered = false;
	}

	/** Switch encryption off: forget the key and hand the host's methods back. */
	dispose(): void {
		this.#forget();
		const host = hostPlatform as unknown as Record<string, unknown>;
		const live = platform as unknown as Record<string, unknown>;
		for (const name of Object.keys(this.#wrap.methods)) live[name] = host[name];
	}

	async #use(armored: string | null): Promise<void> {
		this.#forget();
		this.#armored = armored;
		this.#public = null;
		this.info = null;
		if (armored) {
			const { info, publicKey } = await pgp.readKey(armored);
			this.#public = publicKey;
			this.info = info;
		}
		this.hasKey = !!armored;
	}

	/** Encrypt note text with the public key (no unlock needed). */
	async encrypt(plain: string): Promise<string> {
		if (!this.#public) throw new Error('Set up an encryption key first (Settings → Encryption).');
		return pgp.encryptNote(plain, this.#public);
	}

	/** Unlock with the passphrase. Returns why it failed, or null. */
	async unlock(passphrase: string, typed = true): Promise<string | null> {
		if (!this.#armored) return 'No key on this device.';
		try {
			this.#private = await pgp.unlockKey(this.#armored, passphrase);
		} catch (err) {
			return pgp.pgpError(err);
		}
		this.unlocked = true;
		// Typed after a stale remembered one failed: keep the one that works.
		if (typed && this.remembered) await hostPlatform.setSecret(PASS_SECRET, passphrase);
		this.#watchIdle();
		this.#hooks.changed();
		return null;
	}

	async lock(): Promise<void> {
		if (!this.#private) return;
		await this.#hooks.beforeLock();
		this.#forget();
		this.#hooks.changed();
	}

	#forget(): void {
		this.#private = null;
		this.unlocked = false;
		this.#wrap.clear();
		this.#unwatchIdle();
	}

	/** Make a new key on this device (and unlock with it). */
	async generate(name: string, passphrase: string): Promise<void> {
		await this.#store(await pgp.generateKey(name, passphrase), passphrase);
	}

	/** Use a key exported from another device or from gpg. Throws a readable error. */
	async importKey(armored: string, passphrase: string): Promise<void> {
		let key: string;
		try {
			key = await pgp.prepareKey(armored, passphrase);
		} catch (err) {
			throw new Error(pgp.pgpError(err), { cause: err });
		}
		await this.#store(key, passphrase);
	}

	async #store(armored: string, passphrase: string): Promise<void> {
		await this.lock();
		await hostPlatform.setSecret(KEY_SECRET, armored);
		await this.#use(armored);
		await this.unlock(passphrase);
	}

	/** The stored key to copy to another device (still passphrase-protected). */
	exportKey(): string | null {
		return this.#armored;
	}

	async removeKey(): Promise<void> {
		await this.lock();
		await hostPlatform.setSecret(KEY_SECRET, null);
		await this.forgetPassphrase();
		await this.#use(null);
		this.#hooks.changed();
	}

	/** Why opening an encrypted note failed, in words. */
	errorText(err: unknown): string {
		return pgp.pgpError(err);
	}

	// --- auto-lock: idle time, including time spent in the background --------

	/** Re-read the auto-lock setting (it changed). */
	rearm(): void {
		this.#unwatchIdle();
		if (this.unlocked) this.#watchIdle();
	}

	#touch = (): void => {
		this.#lastActive = Date.now();
	};

	// Timers can be frozen while the app is in the background (Android):
	// coming back checks the elapsed time straight away.
	#onVisible = (): void => {
		if (!document.hidden) this.#check();
	};

	#check = (): void => {
		const ms = this.#hooks.autoLockMinutes() * 60_000;
		if (!ms || !this.#private) return;
		const idle = Date.now() - this.#lastActive;
		if (idle >= ms) void this.lock();
		else this.#schedule(ms - idle);
	};

	#schedule(ms: number): void {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(this.#check, ms);
	}

	#watchIdle(): void {
		const minutes = this.#hooks.autoLockMinutes();
		if (!minutes) return;
		this.#lastActive = Date.now();
		window.addEventListener('pointerdown', this.#touch, { capture: true, passive: true });
		window.addEventListener('keydown', this.#touch, { capture: true, passive: true });
		document.addEventListener('visibilitychange', this.#onVisible);
		this.#schedule(minutes * 60_000);
	}

	#unwatchIdle(): void {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
		window.removeEventListener('pointerdown', this.#touch, { capture: true });
		window.removeEventListener('keydown', this.#touch, { capture: true });
		document.removeEventListener('visibilitychange', this.#onVisible);
	}
}
