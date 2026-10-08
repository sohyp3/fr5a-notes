/**
 * The canonical keyboard-shortcut list, shared by the Settings panel and the
 * global cheat-sheet overlay (Mod+/) so the two can never drift.
 * `Mod` renders as ⌘ on macOS and Ctrl elsewhere.
 */
export interface Shortcut {
	keys: string[];
	desc: string;
	/** Listed only while this setting is on. */
	feature?: 'encryption' | 'highlights' | 'tabs';
}

export const SHORTCUTS: Shortcut[] = [
	{ keys: ['Mod', '/'], desc: 'Toggle this shortcuts cheat sheet' },
	{ keys: ['Mod', 'N'], desc: 'New note' },
	{ keys: ['Mod', 'W'], desc: 'Close the current tab', feature: 'tabs' },
	{ keys: ['Ctrl', 'Tab'], desc: 'Next tab  ·  ⇧ previous', feature: 'tabs' },
	{ keys: ['Mod', '\\'], desc: 'Toggle Zen mode' },
	{ keys: ['Mod', 'J'], desc: 'Toggle the AI harness pane' },
	{ keys: ['Mod', '⇧', 'L'], desc: 'Show / hide the note list' },
	{ keys: ['Mod', '⇧', 'E'], desc: 'View / edit mode for the open note' },
	{ keys: ['Mod', ','], desc: 'Open / close Settings' },
	{ keys: ['Mod', '⇧', 'K'], desc: 'Lock encrypted notes', feature: 'encryption' },
	{ keys: ['Mod', 'B'], desc: 'Bold  **text**' },
	{ keys: ['Mod', 'I'], desc: 'Italic  *text*' },
	{ keys: ['Mod', 'E'], desc: 'Inline code  `text`' },
	{ keys: ['Mod', 'P'], desc: 'Pin / unpin the current note' },
	{ keys: ['Mod', '⇧', 'X'], desc: 'Strikethrough  ~~text~~' },
	{ keys: ['Mod', '⇧', 'H'], desc: 'Highlight the selection or line', feature: 'highlights' },
	{ keys: ['Esc'], desc: 'Close overlay · exit Settings / Changes / Zen' }
];

export const VIM_SHORTCUTS: Shortcut[] = [
	{ keys: ['i'], desc: 'Insert  ·  Esc → Normal' },
	{ keys: ['h', 'j', 'k', 'l'], desc: 'Move  ·  w / b / e by word' },
	{ keys: ['d', 'd'], desc: 'Delete line  ·  yy yank  ·  p paste' },
	{ keys: ['v'], desc: 'Visual  ·  gg / G  top / bottom' },
	{ keys: ['⇧', 'V'], desc: 'Visual Line  ·  whole-line select' }
];
