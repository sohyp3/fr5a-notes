/**
 * Svelte action: move the node to <body>, so fixed-position menus and sheets
 * escape transformed / overflow-hidden ancestors (the sliding phone panes).
 */
export function portal(node: HTMLElement): { destroy(): void } {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		}
	};
}

/** Short vibration on Android (no-op elsewhere): confirms a gesture locked in. */
export function haptic(ms = 10): void {
	try {
		navigator.vibrate?.(ms);
	} catch {
		/* not allowed: ignore */
	}
}

/** Honour the OS "reduce motion" switch in JS-driven animations. */
export function reducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
