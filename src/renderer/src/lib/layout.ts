export type Layout = 'desktop' | 'tablet' | 'phone';

/** Below this width a touch device stacks one pane at a time. */
export const PHONE_MAX = 600;
/** Below this width a touch device shows list + editor, folders in a drawer. */
export const TABLET_MAX = 1024;
/** Narrowest the editor should remain while panes can yield. */
export const EDITOR_MIN = 320;

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

/** Fit desktop panes without hiding a selected tag's results behind navigation.
 * Width preferences stay intact, so a wider window restores both sidebars. */
export function fitDesktopPanes(
	width: number,
	requested: { side: number; list: number; ai: number },
	minimums: { side: number; list: number; ai: number },
	prioritizeList = false
): { side: number; list: number; ai: number } {
	let { side, list, ai } = requested;
	const room = width - EDITOR_MIN - 40;
	const shrink = () => {
		let over = side + list + ai - room;
		const cut = (w: number, min: number): number => {
			const c = w ? Math.min(Math.max(0, over), Math.max(0, w - min)) : 0;
			over -= c;
			return w - c;
		};
		side = cut(side, minimums.side);
		list = cut(list, minimums.list);
		ai = cut(ai, minimums.ai);
	};
	shrink();
	if (side + list + ai > room && prioritizeList && ai) {
		ai = 0;
		shrink(); // restore navigation if it now fits alongside the tagged list
	}
	if (side + list + ai > room && (list > 0 || ai > 0)) side = 0;
	if (ai && list + ai > room) ai = Math.max(minimums.ai, room - list);
	if (list + ai > room && !prioritizeList) list = 0;
	// At extremely narrow mouse widths, the editor yields to the selected list;
	// otherwise the existing editor-first behavior is preserved.
	return { side, list, ai };
}
