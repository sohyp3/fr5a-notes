/**
 * The note toolbars (`Editor.svelte`'s header and the touch formatting
 * toolbar): which buttons sit in a bar and which wait in its menu.
 * Settings → Toolbar; kept with the settings, so per device.
 */
import type { IconName } from './icons';

/** Insert actions: their menu is Insert (+), their bar the header (mouse) or the formatting toolbar (touch). */
export const INSERT_ITEMS = ['image', 'table', 'highlight'] as const;
/** Note actions: their menu is the header's ⋯. */
export const NOTE_ITEMS = ['edit', 'ai', 'pin', 'dir', 'lock', 'changes', 'trash'] as const;
/** Formatting (touch only): their bar is the formatting toolbar, their menu its ⋯. */
export const FORMAT_ITEMS = [
	'bold',
	'heading',
	'list',
	'outdent',
	'indent',
	'tag',
	'undo'
] as const;
/** Everything that can be placed. */
export const BAR_ITEMS = ['insert', ...INSERT_ITEMS, ...NOTE_ITEMS, ...FORMAT_ITEMS] as const;

export type InsertItem = (typeof INSERT_ITEMS)[number];
export type NoteItem = (typeof NOTE_ITEMS)[number];
export type FormatItem = (typeof FORMAT_ITEMS)[number];
export type BarItem = (typeof BAR_ITEMS)[number];
export type BarSpot = 'bar' | 'menu';
/** The user's choices; an item left out follows `defaultSpot`. */
export type BarPlacement = Partial<Record<BarItem, BarSpot>>;

export const BAR_LABELS: Record<BarItem, string> = {
	insert: 'Insert',
	image: 'Image',
	table: 'Table',
	highlight: 'Highlight',
	edit: 'Edit / Done',
	ai: 'AI assistant',
	pin: 'Pin',
	dir: 'Text direction',
	lock: 'Lock',
	changes: 'Changes',
	trash: 'Move to Trash',
	bold: 'Bold',
	heading: 'Heading',
	list: 'List',
	outdent: 'Outdent',
	indent: 'Indent',
	tag: 'Tag',
	undo: 'Undo'
};

export const BAR_ICONS: Record<BarItem, IconName> = {
	insert: 'plus',
	image: 'image',
	table: 'table',
	highlight: 'highlight',
	edit: 'edit',
	ai: 'ai',
	pin: 'pin',
	dir: 'dir',
	lock: 'lock',
	changes: 'diff',
	trash: 'trash',
	bold: 'bold',
	heading: 'heading',
	list: 'bullet',
	outdent: 'outdent',
	indent: 'indent',
	tag: 'tag',
	undo: 'undo'
};

export const isInsertItem = (id: BarItem): id is InsertItem =>
	(INSERT_ITEMS as readonly BarItem[]).includes(id);

/**
 * Where a button goes until the user moves it: the bar as it always was. On
 * phones the note's direction / lock / changes / trash wait in ⋯; with a mouse
 * Highlight sits in Insert, on touch it's a button of the formatting toolbar.
 */
export function defaultSpot(id: BarItem, phone: boolean, touch: boolean): BarSpot {
	switch (id) {
		case 'image':
		case 'table':
			return 'menu';
		case 'highlight':
			return touch ? 'bar' : 'menu';
		case 'dir':
		case 'lock':
		case 'changes':
		case 'trash':
			return phone ? 'menu' : 'bar';
		default:
			return 'bar';
	}
}

export function spotOf(placement: unknown, id: BarItem, phone: boolean, touch: boolean): BarSpot {
	const chosen =
		placement && typeof placement === 'object' ? (placement as BarPlacement)[id] : undefined;
	return chosen === 'bar' || chosen === 'menu' ? chosen : defaultSpot(id, phone, touch);
}

/**
 * How many of the bar's buttons (`widths`, in bar order, `gap` apart) fit in
 * `budget` px; the rest fold into the menu. Its button (`more` px) is there
 * anyway when `menu` already has items, and takes room once anything folds.
 * An unmeasured bar (`budget` ≤ 0 before layout) keeps every button.
 */
export function fitBar(
	widths: number[],
	budget: number,
	more: number,
	gap: number,
	menu: boolean
): number {
	const span = (n: number) => widths.slice(0, n).reduce((a, w) => a + w + gap, 0);
	const room = (folds: boolean) => budget - (menu || folds ? more : 0);
	if (span(widths.length) <= room(false)) return widths.length;
	let n = widths.length - 1;
	while (n > 0 && span(n) > room(true)) n--;
	return n;
}
