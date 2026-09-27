import type { PlatformApi } from './types';

/** Electron host: the preload bridge already has exactly this shape. */
export function isDesktop(): boolean {
	return typeof window !== 'undefined' && 'api' in window && window.api != null;
}

export function createDesktopPlatform(): PlatformApi {
	return window.api;
}
