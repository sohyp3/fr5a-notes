import type { Attachment } from 'svelte/attachments';

/**
 * Attachment: move the node to <body>, so fixed-position menus and sheets
 * escape transformed / overflow-hidden ancestors (the sliding phone panes).
 */
export const portal: Attachment<HTMLElement> = (node) => {
	document.body.appendChild(node);
	return () => node.remove();
};

/** Short vibration on Android (no-op elsewhere): confirms a gesture locked in. */
export function haptic(ms = 10): void {
	try {
		navigator.vibrate?.(ms);
	} catch {
		/* not allowed: ignore */
	}
}

/**
 * Animations are off: Settings → Appearance → Animations (`html[data-motion=off]`)
 * or the OS "reduce motion" switch. Read at call time, so the setting applies at once.
 */
export function reducedMotion(): boolean {
	if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'off')
		return true;
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
