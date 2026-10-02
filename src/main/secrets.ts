import { safeStorage } from 'electron';

/**
 * API keys for the AI harness, encrypted with the OS keyring (safeStorage) and
 * kept as base64 in electron-store. Plain text never touches disk; on a Linux
 * box with no keyring safeStorage falls back to its own weak obfuscation.
 */

interface SecretStore {
	get(key: 'secrets'): Record<string, string> | undefined;
	set(key: 'secrets', value: Record<string, string>): void;
}

const NAME_RE = /^[\w.:-]{1,128}$/;

export function createSecrets(store: SecretStore) {
	const all = () => ({ ...(store.get('secrets') ?? {}) });
	return {
		get(name: string): string | null {
			if (!NAME_RE.test(name)) return null;
			const enc = all()[name];
			if (!enc) return null;
			try {
				return safeStorage.decryptString(Buffer.from(enc, 'base64'));
			} catch {
				return null;
			}
		},
		set(name: string, value: string | null): void {
			if (!NAME_RE.test(name)) throw new Error('Invalid secret name');
			const next = all();
			if (value) next[name] = safeStorage.encryptString(value).toString('base64');
			else delete next[name];
			store.set('secrets', next);
		}
	};
}
