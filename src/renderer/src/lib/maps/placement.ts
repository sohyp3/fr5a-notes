/** Canvas coordinates use a visible 20 px grid when the magnet is enabled. */
export const GRID = 20;
export const snapPoint = (point: { x: number; y: number }) => ({
	x: Math.round(point.x / GRID) * GRID,
	y: Math.round(point.y / GRID) * GRID
});

type Rect = { x: number; y: number; width: number; height: number };
/** Find room near an intended position, accounting for the whole card and a gutter. */
export function freePosition(
	at: Rect,
	occupied: readonly Rect[],
	snap = false
): { x: number; y: number } {
	const origin = snap ? snapPoint(at) : { x: Math.round(at.x), y: Math.round(at.y) };
	const stepX = Math.ceil((at.width + 40) / GRID) * GRID;
	const stepY = Math.ceil((at.height + 40) / GRID) * GRID;
	const clear = (p: { x: number; y: number }) =>
		occupied.every(
			(r) =>
				p.x + at.width + 24 <= r.x ||
				r.x + r.width + 24 <= p.x ||
				p.y + at.height + 24 <= r.y ||
				r.y + r.height + 24 <= p.y
		);
	if (clear(origin)) return origin;
	// Expanding square rings keep placement local without an arbitrary attempt limit.
	for (let radius = 1; ; radius++) {
		const ring: { x: number; y: number }[] = [];
		for (let y = -radius; y <= radius; y++) {
			for (let x = -radius; x <= radius; x++) {
				if (Math.abs(x) === radius || Math.abs(y) === radius) ring.push({ x, y });
			}
		}
		// Prefer vertical space so additions remain reachable in narrow viewports.
		ring.sort((a, b) => Math.abs(a.x) - Math.abs(b.x) || b.y - a.y || a.x - b.x);
		for (const offset of ring) {
			const p = { x: origin.x + offset.x * stepX, y: origin.y + offset.y * stepY };
			if (clear(p)) return p;
		}
	}
}
