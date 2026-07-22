/**
 * Accent color palette. Each accent carries a light- and dark-mode hex so the
 * color stays legible on the warm off-white and deep charcoal backgrounds.
 * `--accent-soft` is derived from `--accent` at paint time (see app.css), so
 * only `--accent` is set at runtime — the store picks light/dark by theme.
 */
export interface Accent {
	id: string;
	label: string;
	light: string;
	dark: string;
}

export const ACCENTS: Accent[] = [
	{ id: 'yellow', label: 'Yellow', light: '#c99700', dark: '#f0b429' },
	{ id: 'red', label: 'Red', light: '#ee5d50', dark: '#ff6a5c' },
	{ id: 'orange', label: 'Orange', light: '#e8720c', dark: '#ff8c42' },
	{ id: 'green', label: 'Green', light: '#2aa66a', dark: '#3ecf8e' },
	{ id: 'blue', label: 'Blue', light: '#2f7de1', dark: '#5b9dff' },
	{ id: 'purple', label: 'Purple', light: '#7b5cd6', dark: '#a68bff' },
	{ id: 'pink', label: 'Pink', light: '#e0559a', dark: '#ff77b7' },
	{ id: 'graphite', label: 'Graphite', light: '#6b6862', dark: '#a09c94' }
];

export const DEFAULT_ACCENT = 'yellow';

export function accentById(id: string): Accent {
	return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

/** Untinted surface colors per theme — must mirror the bases in app.css. */
const SURFACES = {
	light: { primary: '#eceae6', secondary: '#ffffff', text: '#33312d' },
	dark: { primary: '#171719', secondary: '#242427', text: '#d7d4cf' }
} as const;

/**
 * Full theming: picking an accent restyles the whole window, not just the
 * controls. Sets --accent plus accent-tinted --bg-primary (window backdrop),
 * --bg-secondary (panes) and --text-main as inline root variables, which
 * app.css feeds into every surface. Re-run on every theme flip (the tint bases
 * and accent hex differ per theme).
 */
export function applyPalette(accent: Accent, theme: 'light' | 'dark'): void {
	const hex = theme === 'dark' ? accent.dark : accent.light;
	const base = SURFACES[theme];
	const root = document.documentElement.style;
	root.setProperty('--accent', hex);
	root.setProperty('--bg-primary', `color-mix(in srgb, ${hex} 6%, ${base.primary})`);
	root.setProperty('--bg-secondary', `color-mix(in srgb, ${hex} 3%, ${base.secondary})`);
	root.setProperty('--text-main', `color-mix(in srgb, ${hex} 8%, ${base.text})`);
}
