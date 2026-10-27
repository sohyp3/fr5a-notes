import { describe, expect, it, vi } from 'vitest';

vi.mock('../platform', () => ({
	platform: { setState: vi.fn() },
	hostPlatform: {},
	isMobile: false
}));

import { getAppState } from './app.svelte';

// Vitest does not run the Svelte rune compiler on .svelte.ts files.
const state = Object.assign(<T>(value: T) => value, {
	raw: <T>(value: T) => value,
	snapshot: <T>(value: T) => value
});
vi.stubGlobal('$state', state);
vi.stubGlobal(
	'$derived',
	Object.assign(<T>(value: T) => value, { by: <T>(value: () => T) => value() })
);
vi.stubGlobal('document', {
	documentElement: { setAttribute: vi.fn(), removeAttribute: vi.fn() }
});

describe('tag navigation', () => {
	it.each(['desktop', 'tablet', 'phone'] as const)(
		'reveals the filtered list on %s, including tags with no results',
		(layout) => {
			const app = getAppState();
			app.setLayout(layout, layout !== 'desktop');
			app.notes = [];
			app.listOpen = false;
			app.zen = true;
			app.drawerOpen = true;
			app.selectTag('missing/tag');
			expect(app.selectedTag).toBe('missing/tag');
			expect(app.filtered).toEqual([]);
			expect(app.view).toBe('editor');
			expect(app.pane).toBe('list');
			expect(app.listOpen).toBe(true);
			expect(app.zen).toBe(false);
			expect(app.drawerOpen).toBe(false);
			if (layout === 'phone') {
				expect(app.back()).toBe(true);
				expect(app.pane).toBe('nav');
				expect(app.selectedTag).toBe('missing/tag');
			} else if (layout === 'desktop') {
				// The title-bar list control can make room for navigation without
				// clearing the tag; returning to the list keeps the same scope.
				app.toggleList();
				expect(app.listOpen).toBe(false);
				expect(app.selectedTag).toBe('missing/tag');
				app.toggleList();
				expect(app.listOpen).toBe(true);
			}
		}
	);
});
