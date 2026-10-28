import { expect, it } from 'vitest';
import { isTrackedMap } from './paths';
import { isTrackedChange, isTrackedNote } from './types';
it('only includes canvas files in the exact app maps directory, with visible repo prefixes', () => {
	for (const path of ['.fr5a/maps/Trading.canvas', 'private/repo/.fr5a/maps/投資.canvas']) {
		expect(isTrackedMap(path)).toBe(true);
		expect(isTrackedChange(path)).toBe(true);
		expect(isTrackedNote(path)).toBe(false);
	}
	for (const path of [
		'.fr5a/sessions/x.canvas',
		'.fr5a/maps/sub/x.canvas',
		'.fr5a/maps/.x.canvas',
		'../.fr5a/maps/x.canvas',
		'/.fr5a/maps/x.canvas',
		'a//.fr5a/maps/x.canvas',
		'a\n/.fr5a/maps/x.canvas',
		'.secret/.fr5a/maps/x.canvas',
		'.fr5a/maps/x.md',
		'x.canvas',
		'.fr5a/maps\\x.canvas'
	])
		expect(isTrackedMap(path), path).toBe(false);
});
