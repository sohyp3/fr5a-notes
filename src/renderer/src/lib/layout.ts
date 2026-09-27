export type Layout = 'desktop' | 'tablet' | 'phone';

/** Below this width a touch device stacks one pane at a time. */
export const PHONE_MAX = 600;
/** Below this width a touch device shows list + editor, folders in a drawer. */
export const TABLET_MAX = 1024;

/**
 * Pick the layout for a viewport. Mouse-driven windows are always 'desktop'
 * (whatever their width), so resizing a desktop window never changes layout.
 */
export function layoutFor(width: number, touch: boolean): Layout {
	if (!touch) return 'desktop';
	if (width < PHONE_MAX) return 'phone';
	if (width < TABLET_MAX) return 'tablet';
	return 'desktop';
}
