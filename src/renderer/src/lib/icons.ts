/**
 * Every icon in the app is a Lucide icon (https://lucide.dev), named here so a
 * menu item or toolbar can say `icon: 'trash'` and `Icon.svelte` draws it.
 * One import per icon keeps the bundle to the icons actually used.
 */
import type { Component } from 'svelte';
import ArrowDown from '@lucide/svelte/icons/arrow-down';
import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
import Bold from '@lucide/svelte/icons/bold';
import Check from '@lucide/svelte/icons/check';
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import ChevronsDownUp from '@lucide/svelte/icons/chevrons-down-up';
import Circle from '@lucide/svelte/icons/circle';
import CircleDot from '@lucide/svelte/icons/circle-dot';
import Copy from '@lucide/svelte/icons/copy';
import Diff from '@lucide/svelte/icons/diff';
import Ellipsis from '@lucide/svelte/icons/ellipsis';
import Eraser from '@lucide/svelte/icons/eraser';
import Eye from '@lucide/svelte/icons/eye';
import FileText from '@lucide/svelte/icons/file-text';
import Folder from '@lucide/svelte/icons/folder';
import FolderInput from '@lucide/svelte/icons/folder-input';
import FolderPlus from '@lucide/svelte/icons/folder-plus';
import GitFork from '@lucide/svelte/icons/git-fork';
import Globe from '@lucide/svelte/icons/globe';
import Hash from '@lucide/svelte/icons/hash';
import Heading from '@lucide/svelte/icons/heading';
import Highlighter from '@lucide/svelte/icons/highlighter';
import History from '@lucide/svelte/icons/history';
import ImagePlus from '@lucide/svelte/icons/image-plus';
import Info from '@lucide/svelte/icons/info';
import Keyboard from '@lucide/svelte/icons/keyboard';
import KeyRound from '@lucide/svelte/icons/key-round';
import LayoutList from '@lucide/svelte/icons/layout-list';
import List from '@lucide/svelte/icons/list';
import ListIndentDecrease from '@lucide/svelte/icons/list-indent-decrease';
import ListIndentIncrease from '@lucide/svelte/icons/list-indent-increase';
import ListPlus from '@lucide/svelte/icons/list-plus';
import Lock from '@lucide/svelte/icons/lock';
import LockOpen from '@lucide/svelte/icons/lock-open';
import Maximize from '@lucide/svelte/icons/maximize';
import Menu from '@lucide/svelte/icons/menu';
import Minimize from '@lucide/svelte/icons/minimize';
import Moon from '@lucide/svelte/icons/moon';
import NotebookText from '@lucide/svelte/icons/notebook-text';
import PanelLeft from '@lucide/svelte/icons/panel-left';
import Pencil from '@lucide/svelte/icons/pencil';
import Pilcrow from '@lucide/svelte/icons/pilcrow';
import Pin from '@lucide/svelte/icons/pin';
import Plus from '@lucide/svelte/icons/plus';
import ReceiptText from '@lucide/svelte/icons/receipt-text';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
import RotateCw from '@lucide/svelte/icons/rotate-cw';
import Save from '@lucide/svelte/icons/save';
import Search from '@lucide/svelte/icons/search';
import Settings from '@lucide/svelte/icons/settings';
import Shield from '@lucide/svelte/icons/shield';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Square from '@lucide/svelte/icons/square';
import SquarePen from '@lucide/svelte/icons/square-pen';
import Sun from '@lucide/svelte/icons/sun';
import Table from '@lucide/svelte/icons/table';
import TextCursor from '@lucide/svelte/icons/text-cursor';
import TextCursorInput from '@lucide/svelte/icons/text-cursor-input';
import Trash2 from '@lucide/svelte/icons/trash-2';
import Undo2 from '@lucide/svelte/icons/undo-2';
import X from '@lucide/svelte/icons/x';

export const ICONS = {
	// note / folder actions
	pin: Pin,
	lock: Lock,
	unlock: LockOpen,
	trash: Trash2,
	restore: RotateCcw,
	diff: Diff,
	dir: Pilcrow,
	more: Ellipsis,
	rename: TextCursorInput,
	move: FolderInput,
	note: FileText,
	notes: NotebookText,
	newNote: SquarePen,
	folder: Folder,
	newFolder: FolderPlus,
	collapse: ChevronsDownUp,
	search: Search,
	// sync / app chrome
	pull: ArrowDownToLine,
	push: ArrowUpFromLine,
	sync: RefreshCw,
	moon: Moon,
	sun: Sun,
	sidebar: PanelLeft,
	noteList: LayoutList,
	menu: Menu,
	zenOn: Maximize,
	zenOff: Minimize,
	settings: Settings,
	keyboard: Keyboard,
	info: Info,
	// editing
	edit: Pencil,
	eye: Eye,
	check: Check,
	close: X,
	copy: Copy,
	retry: RotateCw,
	insert: TextCursor,
	append: ListPlus,
	table: Table,
	image: ImagePlus,
	highlight: Highlighter,
	eraser: Eraser,
	bold: Bold,
	heading: Heading,
	bullet: List,
	outdent: ListIndentDecrease,
	indent: ListIndentIncrease,
	tag: Hash,
	undo: Undo2,
	// AI
	ai: Sparkles,
	history: History,
	plus: Plus,
	send: ArrowRight,
	stop: Square,
	web: Globe,
	fork: GitFork,
	save: Save,
	usage: ReceiptText,
	on: CircleDot,
	off: Circle,
	// arrows
	chevron: ChevronRight,
	back: ChevronLeft,
	down: ArrowDown,
	// privacy / encryption
	shield: Shield,
	key: KeyRound
} as const satisfies Record<string, Component>;

export type IconName = keyof typeof ICONS;
