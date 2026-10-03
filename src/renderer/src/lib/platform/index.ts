import { Capacitor } from '@capacitor/core';
import { createAndroidPlatform } from './api.android';
import { createDesktopPlatform, isDesktop } from './desktop';
import type { PlatformApi } from './types';

export type { PlatformApi } from './types';

/** Pick the host implementation once, at startup. */
function selectPlatform(): PlatformApi {
	if (isDesktop()) return createDesktopPlatform();
	if (Capacitor.getPlatform() === 'android') return createAndroidPlatform();
	throw new Error('fr5a: no platform implementation available for this host');
}

/** The host itself: note files exactly as they are on disk. */
export const hostPlatform: PlatformApi = selectPlatform();

/**
 * What the app talks to: a copy of the host's methods. Encryption, while
 * switched on, swaps in wrappers that decrypt on read and encrypt on write
 * (`vault/wrap.ts`), and puts the host's own methods back when switched off,
 * so the feature costs nothing per call when it's off.
 */
export const platform: PlatformApi = { ...hostPlatform };
