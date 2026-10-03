/**
 * Stroke icons (24×24 viewBox, drawn with `currentColor`) shared by menus and
 * toolbars, so a menu item can name its icon instead of inlining an SVG.
 */
export const ICONS = {
	pin: 'M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z M12 15v5',
	lock: 'M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z M8 11V8a4 4 0 0 1 8 0v3',
	unlock:
		'M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z M8 11V8a4 4 0 0 1 7-2.6',
	trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
	restore: 'M4 12a8 8 0 1 1 2.3 5.6M4 12V7m0 5h5',
	diff: 'M8 4v10M3 9h10M13 19h8M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 4v8',
	dir: 'M9 5h10M9 5v14M14 5v14M9 5a4 4 0 0 0 0 8',
	more: 'M5 12h.01M12 12h.01M19 12h.01',
	pull: 'M12 4v12m0 0-5-5m5 5 5-5M5 20h14',
	push: 'M12 16V4m0 0L7 9m5-5 5 5M5 20h14',
	moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
	sun: 'M12 16.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4ZM12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M5.2 18.8l1.7-1.7M17.1 6.9l1.7-1.7',
	edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
	eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z',
	check: 'M5 12.5l4.5 4.5L19 7.5',
	close: 'M6 6l12 12M18 6L6 18',
	copy: 'M9 9h10v11H9zM5 15V4h10',
	retry: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4',
	settings:
		'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15l1.2 2-2 3.4-2.3-.6a7 7 0 0 1-1.8 1L14 23h-4l-.5-2.2a7 7 0 0 1-1.8-1l-2.3.6-2-3.4 1.2-2a7 7 0 0 1 0-2l-1.2-2 2-3.4 2.3.6a7 7 0 0 1 1.8-1L10 1h4l.5 2.2a7 7 0 0 1 1.8 1l2.3-.6 2 3.4-1.2 2a7 7 0 0 1 0 2Z',
	note: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
	insert: 'M12 5v14M5 12h14',
	append: 'M5 6h14M5 11h14M12 15v6M9 18h6',
	list: 'M4 6h16M4 12h16M4 18h10',
	sidebar:
		'M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5zM9 4v16',
	history: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2',
	plus: 'M12 5v14M5 12h14',
	send: 'M5 12h13M13 6l6 6-6 6',
	stop: 'M7 7h10v10H7z',
	web: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z',
	chevron: 'M9 6l6 6-6 6',
	down: 'M12 5v14m0 0-6-6m6 6 6-6',
	back: 'M15 5l-7 7 7 7',
	shield: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z',
	folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
	move: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 13h6m-2-2 2 2-2 2',
	rename: 'M4 8h8M4 12h6M4 16h8M17 5v14M15 5h4M15 19h4',
	fork: 'M6 7v10M8 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM8 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM20 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM18 9v1a5 5 0 0 1-5 5H6',
	save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
	table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14'
} as const;

export type IconName = keyof typeof ICONS;
