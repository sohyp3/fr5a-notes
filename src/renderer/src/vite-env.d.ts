/// <reference types="svelte" />
/// <reference types="vite/client" />

// The typed IPC bridge exposed by the preload script (contextBridge).
import type { Api } from '../../preload/index';

declare global {
	interface Window {
		api: Api;
	}
	/** package.json version, set at build time (build-info.ts). */
	const __APP_VERSION__: string;
	/** Short commit the build came from (`+` = uncommitted changes); '' outside git. */
	const __APP_COMMIT__: string;
}

export {};
