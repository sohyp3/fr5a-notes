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

export const platform: PlatformApi = selectPlatform();
