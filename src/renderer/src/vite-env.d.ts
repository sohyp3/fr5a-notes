/// <reference types="svelte" />
/// <reference types="vite/client" />

// The typed IPC bridge exposed by the preload script (contextBridge).
import type { Api } from '../../preload/index';

declare global {
	interface Window {
		api: Api;
	}
}

export {};
