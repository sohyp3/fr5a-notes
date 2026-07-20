/**
 * The canonical keyboard-shortcut list, shared by the Settings panel and the
 * global cheat-sheet overlay (Mod+/) so the two can never drift.
 * `Mod` renders as ⌘ on macOS and Ctrl elsewhere.
 */
export interface Shortcut {
	keys: string[];
	desc: string;
}

export const SHORTCUTS: Shortcut[] = [
	{ keys: ['Mod', '/'], desc: 'Toggle this shortcuts cheat sheet' },
	{ keys: ['Mod', 'N'], desc: 'New note' },
	{ keys: ['Mod', '\\'], desc: 'Toggle Zen mode' },
	{ keys: ['Mod', ','], desc: 'Open / close Settings' },
	{ keys: ['Mod', 'B'], desc: 'Bold  **text**' },
	{ keys: ['Mod', 'I'], desc: 'Italic  *text*' },
	{ keys: ['Mod', 'E'], desc: 'Inline code  `text`' },
	{ keys: ['Mod', 'P'], desc: 'Pin / unpin the current note' },
	{ keys: ['Mod', '⇧', 'X'], desc: 'Strikethrough  ~~text~~' },
	{ keys: ['Esc'], desc: 'Close overlay · exit Settings / Zen' }
];

export const VIM_SHORTCUTS: Shortcut[] = [
	{ keys: ['i'], desc: 'Insert  ·  Esc → Normal' },
	{ keys: ['h', 'j', 'k', 'l'], desc: 'Move  ·  w / b / e by word' },
	{ keys: ['d', 'd'], desc: 'Delete line  ·  yy yank  ·  p paste' },
	{ keys: ['v'], desc: 'Visual  ·  gg / G  top / bottom' }
];
