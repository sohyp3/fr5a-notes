<script lang="ts">
	import '@xyflow/svelte/dist/base.css';
	import {
		Background,
		BackgroundVariant,
		ConnectionMode,
		NodeToolbar,
		Panel,
		Position,
		SvelteFlow,
		useSvelteFlow,
		type Connection,
		type Edge,
		type Node
	} from '@xyflow/svelte';
	import { onDestroy } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { TagNode as TagTreeNode } from '../../../../../shared/types';
	import { parentOf } from '../../../../../shared/paths';
	import { resolveNoteHref } from '../../linkedNotes';
	import {
		cleanTag,
		emptyCanvas,
		excludeDeleted,
		fromFlow,
		kindOf,
		newForTag,
		newId,
		NOTE_H,
		NOTE_W,
		parseCanvas,
		populateTag,
		PRESETS,
		rewritePaths,
		serializeCanvas,
		toFlowEdge,
		toFlowNode,
		untaggedTag,
		type CanvasDoc,
		type CanvasEdge,
		type CanvasNode,
		type FlowEdge,
		type FlowNode,
		type ParsedCanvas
	} from '../../maps/canvas';
	import { setMapApi } from '../../maps/context';
	import { readMap, saved, trackSave, writeMap } from '../../maps/files';
	import { easeInOut, ms } from '../../motion';
	import { haptic } from '../../portal';
	import { getAppState } from '../../stores/app.svelte';
	import ActionMenu, { type MenuItem } from '../ActionMenu.svelte';
	import Icon from '../Icon.svelte';
	import ConceptNode from './ConceptNode.svelte';
	import MapEdge from './MapEdge.svelte';
	import MapPicker, { type PickItem } from './MapPicker.svelte';
	import NoteNode from './NoteNode.svelte';
	import OtherNode from './OtherNode.svelte';
	import TagNode from './TagNode.svelte';

	let { name }: { name: string } = $props();

	type MapNode = Node<{ raw: CanvasNode }>;
	type MapEdgeT = Edge<{ raw: CanvasEdge }>;

	const app = getAppState();
	const flow = useSvelteFlow<MapNode, MapEdgeT>();
	const nodeTypes = { concept: ConceptNode, note: NoteNode, tag: TagNode, other: OtherNode };
	const edgeTypes = { map: MapEdge };
	const COLOR_NAMES: Record<string, string> = {
		'1': 'Red',
		'2': 'Orange',
		'3': 'Yellow',
		'4': 'Green',
		'5': 'Blue',
		'6': 'Purple'
	};
	const SNAP_KEY = 'fr5a-map-snap';

	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let failure = $state('');
	// Svelte Flow owns these while you drag (positions change every frame); the
	// canvas is read back from them only on a commit, never per frame.
	let nodes = $state.raw<MapNode[]>([]);
	let edges = $state.raw<MapEdgeT[]>([]);
	/** The canvas as last committed: what tag nodes and badges derive from. */
	let doc = $state.raw<CanvasDoc>(emptyCanvas());
	let skipped: ParsedCanvas['skipped'] = { nodes: [], edges: [] };
	/** The file's text as last read or written (a different one on disk = changed elsewhere). */
	let diskText: string | null = null;
	let editingId = $state<string | null>(null);
	let undoStack = $state.raw<string[]>([]);
	let redoStack = $state.raw<string[]>([]);
	let selection = $state.raw<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] });
	let snap = $state(readSnap());
	let menu = $state<{ items: MenuItem[]; at: { x: number; y: number }; title: string } | null>(
		null
	);
	let picker = $state<{
		title: string;
		placeholder: string;
		items: PickItem[];
		free?: (text: string) => PickItem | null;
		onpick(item: PickItem): void;
	} | null>(null);
	let host = $state<HTMLElement | null>(null);
	let added = 0;
	/** The canvas before a delete, for the tag nodes' exclude lists. */
	let beforeDelete: CanvasDoc | null = null;
	let cancelPress: (() => void) | null = null;

	const single = $derived(
		selection.nodes.length === 1 && selection.edges.length === 0 ? selection.nodes[0] : null
	);
	const singleEdge = $derived(
		selection.edges.length === 1 && selection.nodes.length === 0 ? selection.edges[0] : null
	);
	const singleKind = $derived.by(() => {
		const raw = single ? doc.nodes.find((n) => n.id === single) : undefined;
		return raw ? kindOf(raw) : null;
	});

	function readSnap(): boolean {
		try {
			return localStorage.getItem(SNAP_KEY) === '1';
		} catch {
			return false;
		}
	}
	function toggleSnap(): void {
		snap = !snap;
		try {
			localStorage.setItem(SNAP_KEY, snap ? '1' : '0');
		} catch {
			/* private window: per session only */
		}
	}

	// --- load / save -------------------------------------------------------------

	function applyText(text: string): boolean {
		try {
			const parsed = parseCanvas(text);
			skipped = parsed.skipped;
			doc = parsed.doc;
			nodes = parsed.doc.nodes.map(toFlowNode) as unknown as MapNode[];
			edges = parsed.doc.edges.map(edgeOf);
			diskText = text;
			undoStack = [];
			redoStack = [];
			return true;
		} catch (err) {
			failure = err instanceof Error ? err.message : String(err);
			status = 'error';
			return false;
		}
	}

	async function load(): Promise<void> {
		// Reopened right after closing: let that last save land first.
		await saved(name);
		const text = await readMap(name).catch(() => null);
		if (text === null) {
			app.notify('error', `There’s no map called “${name}” any more`);
			app.openMindMap(null);
			return;
		}
		if (applyText(text)) status = 'ready';
	}
	void load();

	const current = (): CanvasDoc =>
		fromFlow(doc, nodes as unknown as FlowNode[], edges as unknown as FlowEdge[]);

	let timer: ReturnType<typeof setTimeout> | undefined;
	let dirty = false;
	let chain: Promise<void> = Promise.resolve();

	function scheduleSave(): void {
		dirty = true;
		clearTimeout(timer);
		timer = setTimeout(() => void flush(), 500);
	}

	/** Write the whole canvas now (debounced edits, closing, switching maps). */
	function flush(): Promise<void> {
		clearTimeout(timer);
		timer = undefined;
		if (!dirty || status !== 'ready') return chain;
		dirty = false;
		const text = serializeCanvas(current(), skipped);
		chain = chain
			.then(() => write(text))
			.catch((err) =>
				app.notify('error', `Couldn’t save the map: ${err instanceof Error ? err.message : err}`)
			);
		trackSave(name, chain);
		return chain;
	}

	async function write(text: string): Promise<void> {
		if (text === diskText) return;
		const now = await readMap(name);
		if (now !== null && diskText !== null && now !== diskText && now !== text) {
			const reload = await app.confirm({
				title: 'This map changed on disk',
				body: `“${name}” was changed somewhere else (a sync?) since it opened here. Reload that version, or keep yours and save it over it.`,
				confirm: 'Reload',
				cancel: 'Keep mine'
			});
			if (reload) {
				applyText(now);
				return;
			}
		}
		await writeMap(name, text);
		diskText = text;
	}

	onDestroy(() => void flush());
	// Closing the window / quitting mid-debounce: the store's leave hook writes it too.
	onDestroy(app.beforeLeave(flush));

	// --- changes -----------------------------------------------------------------

	const edgeOf = (raw: CanvasEdge): MapEdgeT => {
		const e = toFlowEdge(raw) as unknown as MapEdgeT;
		// JSON Canvas: an edge ends in an arrow unless it says `none`.
		if (raw.toEnd !== 'none') e.markerEnd = { type: 'arrowclosed' as never };
		if (raw.fromEnd === 'arrow') e.markerStart = { type: 'arrowclosed' as never };
		return e;
	};

	/** Everything but position / size, to tell an edited node from a moved one. */
	const shape = (raw: CanvasNode) => JSON.stringify({ ...raw, x: 0, y: 0, width: 0, height: 0 });

	/** Show `next`, keeping nodes that didn't change as they are (selection, measured size). */
	function show(next: CanvasDoc, select?: string[]): void {
		const old = new Map(nodes.map((n) => [n.id, n]));
		nodes = next.nodes.map((raw) => {
			const o = old.get(raw.id);
			const selected = select ? select.includes(raw.id) : !!o?.selected;
			if (
				o &&
				o.position.x === raw.x &&
				o.position.y === raw.y &&
				!!o.selected === selected &&
				shape(o.data.raw) === shape(raw)
			)
				return o;
			const n = toFlowNode(raw) as unknown as MapNode;
			if (o?.measured) n.measured = o.measured;
			n.selected = selected;
			return n;
		});
		const oldE = new Map(edges.map((e) => [e.id, e]));
		edges = next.edges.map((raw) => {
			const o = oldE.get(raw.id);
			if (o && JSON.stringify(o.data?.raw) === JSON.stringify(raw)) return o;
			const e = edgeOf(raw);
			if (o?.selected && !select) e.selected = true;
			return e;
		});
		doc = next;
		if (select) selection = { nodes: select, edges: [] };
	}

	function checkpoint(): void {
		undoStack = [...undoStack.slice(-99), serializeCanvas(current())];
		redoStack = [];
	}

	/** A change made here (not by dragging): one undo step, then a save. */
	function change(fn: (d: CanvasDoc) => CanvasDoc, select?: string[]): void {
		checkpoint();
		show(fn(current()), select);
		scheduleSave();
	}

	/** A change Svelte Flow made (drag, connect, delete) is in `nodes` / `edges` already. */
	function commit(): void {
		doc = current();
		scheduleSave();
	}

	function undo(): void {
		const prev = undoStack.at(-1);
		if (prev === undefined) return;
		redoStack = [...redoStack, serializeCanvas(current())];
		undoStack = undoStack.slice(0, -1);
		editingId = null;
		show(parseCanvas(prev).doc, []);
		scheduleSave();
	}

	function redo(): void {
		const next = redoStack.at(-1);
		if (next === undefined) return;
		undoStack = [...undoStack, serializeCanvas(current())];
		redoStack = redoStack.slice(0, -1);
		editingId = null;
		show(parseCanvas(next).doc, []);
		scheduleSave();
	}

	// --- adding --------------------------------------------------------------------

	/** Free spot near the middle of the view (a little apart for each add). */
	function centre(w: number, h: number): { x: number; y: number } {
		const r = host?.getBoundingClientRect();
		const p = r
			? flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
			: { x: 0, y: 0 };
		const k = added++ % 6;
		return { x: Math.round(p.x - w / 2 + k * 26), y: Math.round(p.y - h / 2 + k * 26) };
	}

	function concept(at: { x: number; y: number }, text = ''): CanvasNode {
		return { id: newId(), type: 'text', text, x: at.x, y: at.y, width: 180, height: 44 };
	}

	const link = (from: string, to: string): CanvasEdge => ({
		id: newId(),
		fromNode: from,
		toNode: to,
		toEnd: 'none'
	});

	function addConcept(): void {
		const node = concept(centre(180, 44));
		change((d) => ({ ...d, nodes: [...d.nodes, node] }), [node.id]);
		editingId = node.id;
	}

	function addNoteAt(id: string): void {
		const p = centre(NOTE_W, NOTE_H);
		const node: CanvasNode = {
			id: newId(),
			type: 'file',
			file: id,
			x: p.x,
			y: p.y,
			width: NOTE_W,
			height: NOTE_H
		};
		change((d) => ({ ...d, nodes: [...d.nodes, node] }), [node.id]);
	}

	const noteItems = (): PickItem[] =>
		app.listedNotes.map((n) => ({ id: n.id, label: n.title, hint: parentOf(n.id) || 'Notes' }));

	function pickNote(): void {
		picker = {
			title: 'Add a note',
			placeholder: 'Find a note',
			items: noteItems(),
			onpick: (item) => {
				picker = null;
				addNoteAt(item.id);
			}
		};
	}

	function flattenTags(tree: TagTreeNode[], out: PickItem[] = []): PickItem[] {
		for (const t of tree) {
			out.push({
				id: t.path,
				label: `#${t.path}`,
				hint: `${t.count} ${t.count === 1 ? 'note' : 'notes'}`
			});
			flattenTags(t.children, out);
		}
		return out;
	}

	function pickTag(): void {
		picker = {
			title: 'Add a tag',
			placeholder: 'Find or type a tag',
			items: flattenTags(app.tags),
			free: (text) => {
				const tag = cleanTag(text);
				return tag && /^\p{L}[\p{L}\p{M}\p{N}_/-]*$/u.test(tag)
					? { id: tag, label: `#${tag}`, hint: 'Tag' }
					: null;
			},
			onpick: (item) => {
				picker = null;
				addTag(item.id);
			}
		};
	}

	/** A tag node and, at once, its notes around it (one undo step). */
	function addTag(tag: string): void {
		const at = centre(160, 44);
		const node: CanvasNode = {
			id: newId(),
			type: 'text',
			text: `#${tag}`,
			x: at.x,
			y: at.y,
			width: 160,
			height: 44,
			fr5a: { tag, exclude: [] }
		};
		change(
			(d) => populateTag({ ...d, nodes: [...d.nodes, node] }, node.id, app.listedNotes),
			[node.id]
		);
	}

	function addChild(parentId: string): void {
		const d = current();
		const p = d.nodes.find((n) => n.id === parentId);
		if (!p) return;
		const kids = d.edges.filter((e) => e.fromNode === parentId).length;
		const node = concept({ x: p.x + p.width + 80, y: p.y + kids * 60 });
		change(
			(c) => ({ ...c, nodes: [...c.nodes, node], edges: [...c.edges, link(parentId, node.id)] }),
			[node.id]
		);
		editingId = node.id;
	}

	function addSibling(id: string): void {
		const d = current();
		const s = d.nodes.find((n) => n.id === id);
		if (!s) return;
		const parent = d.edges.find((e) => e.toNode === id)?.fromNode;
		const node = concept({ x: s.x, y: s.y + s.height + 20 });
		change(
			(c) => ({
				...c,
				nodes: [...c.nodes, node],
				edges: parent ? [...c.edges, link(parent, node.id)] : c.edges
			}),
			[node.id]
		);
		editingId = node.id;
	}

	// --- node / edge actions --------------------------------------------------------

	const rawOf = (id: string): CanvasNode | undefined => doc.nodes.find((n) => n.id === id);

	// Note nodes look their note up on every index refresh: by id, not a scan per node.
	const notesById = $derived(new Map(app.notes.map((n) => [n.id, n])));

	function noteFor(file: string | undefined) {
		if (!file) return undefined;
		const exact = notesById.get(file);
		if (exact) return exact;
		// Moved outside the app (a pull): the note with that file name.
		const href = `/${file.split('/').map(encodeURIComponent).join('/')}`;
		return resolveNoteHref(app.listedNotes, href, '') ?? undefined;
	}

	function openNote(nodeId: string): void {
		const note = noteFor(rawOf(nodeId)?.file);
		if (!note) return;
		void flush();
		void app.openNote(note.id);
	}

	function relink(nodeId: string): void {
		picker = {
			title: 'Relink to a note',
			placeholder: 'Find a note',
			items: noteItems(),
			onpick: (item) => {
				picker = null;
				change((d) => ({
					...d,
					nodes: d.nodes.map((n) => (n.id === nodeId ? { ...n, file: item.id } : n))
				}));
			}
		};
	}

	function setColor(ids: string[], color: string | null): void {
		change((d) => ({
			...d,
			nodes: d.nodes.map((n) => {
				if (!ids.includes(n.id)) return n;
				const next = { ...n };
				if (color) next.color = color;
				else delete next.color;
				return next;
			})
		}));
	}

	function remove(ids: string[], edgeIds: string[] = []): void {
		void flow.deleteElements({
			nodes: ids.map((id) => ({ id })),
			edges: edgeIds.map((id) => ({ id }))
		});
	}

	function edit(id: string): void {
		const raw = rawOf(id);
		if (raw && kindOf(raw) === 'concept') editingId = id;
	}

	function commitText(id: string, text: string): void {
		if (editingId !== id) return;
		editingId = null;
		if (rawOf(id)?.text === text) return;
		change((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, text } : n)) }));
	}

	async function editLabel(edgeId: string): Promise<void> {
		const e = doc.edges.find((x) => x.id === edgeId);
		if (!e) return;
		const value = await app.prompt({
			title: 'Connection label',
			label: 'Label (empty: none)',
			value: e.label ?? '',
			confirm: 'Save'
		});
		if (value === null) return;
		change((d) => ({
			...d,
			edges: d.edges.map((x) => {
				if (x.id !== edgeId) return x;
				const next = { ...x };
				if (value.trim()) next.label = value.trim();
				else delete next.label;
				return next;
			})
		}));
	}

	function colorMenu(ids: string[], at: { x: number; y: number }): void {
		menu = {
			title: 'Color',
			at,
			items: [
				{ label: 'No color', icon: 'off', action: () => setColor(ids, null) },
				...PRESETS.map((c): MenuItem => ({
					label: COLOR_NAMES[c],
					icon: 'on',
					action: () => setColor(ids, c)
				}))
			]
		};
	}

	function nodeMenu(id: string, at: { x: number; y: number }): void {
		const raw = rawOf(id);
		if (!raw) return;
		const kind = kindOf(raw);
		const items: MenuItem[] = [];
		if (kind === 'concept')
			items.push({ label: 'Edit text', icon: 'edit', hint: 'F2', action: () => edit(id) });
		if (kind === 'note') {
			const note = noteFor(raw.file);
			if (note) items.push({ label: 'Open note', icon: 'note', action: () => openNote(id) });
			items.push({ label: 'Relink…', icon: 'link', action: () => relink(id) });
		}
		if (kind === 'tag') {
			const fresh = newFor(id).length;
			if (fresh)
				items.push({
					label: `Add ${fresh} new ${fresh === 1 ? 'note' : 'notes'}`,
					icon: 'plus',
					action: () => populate(id)
				});
		}
		if (kind !== 'other')
			items.push(
				{ label: 'Add idea after', icon: 'plus', hint: 'Tab', action: () => addChild(id) },
				{ label: 'Add idea beside', icon: 'plus', hint: 'Enter', action: () => addSibling(id) }
			);
		items.push(
			{ label: 'Color…', icon: 'palette', action: () => colorMenu([id], at) },
			{ label: 'Delete', icon: 'trash', danger: true, divider: true, action: () => remove([id]) }
		);
		const title =
			kind === 'note'
				? (noteFor(raw.file)?.title ?? 'Note')
				: kind === 'tag'
					? `#${raw.fr5a?.tag}`
					: raw.text || 'Idea';
		menu = { items, at, title };
	}

	function edgeMenu(id: string, at: { x: number; y: number }): void {
		menu = {
			title: 'Connection',
			at,
			items: [
				{ label: 'Label…', icon: 'rename', action: () => void editLabel(id) },
				{ label: 'Delete', icon: 'trash', danger: true, action: () => remove([], [id]) }
			]
		};
	}

	/** Attachment: a long press (touch) opens the node's menu, as a right-click does. */
	function press(id: string): Attachment<HTMLElement> {
		return (el) => {
			let t: ReturnType<typeof setTimeout> | undefined;
			let start: { x: number; y: number } | null = null;
			const stop = () => {
				clearTimeout(t);
				t = undefined;
				start = null;
			};
			const down = (e: PointerEvent) => {
				if (e.pointerType === 'mouse' || !e.isPrimary) return;
				start = { x: e.clientX, y: e.clientY };
				cancelPress = stop;
				t = setTimeout(() => {
					const at = start;
					stop();
					if (!at || menu) return;
					haptic();
					nodeMenu(id, at);
				}, 450);
			};
			const move = (e: PointerEvent) => {
				if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) stop();
			};
			el.addEventListener('pointerdown', down);
			el.addEventListener('pointermove', move);
			el.addEventListener('pointerup', stop);
			el.addEventListener('pointercancel', stop);
			return () => {
				stop();
				el.removeEventListener('pointerdown', down);
				el.removeEventListener('pointermove', move);
				el.removeEventListener('pointerup', stop);
				el.removeEventListener('pointercancel', stop);
			};
		};
	}

	function newFor(tagId: string): string[] {
		return newForTag(doc, tagId, app.listedNotes);
	}

	function populate(tagId: string): void {
		change((d) => populateTag(d, tagId, app.listedNotes));
	}

	function untagged(nodeId: string): CanvasNode | null {
		const raw = rawOf(nodeId);
		if (!raw) return null;
		return untaggedTag(doc, raw, (id) => {
			const m = notesById.get(id);
			// A locked encrypted note shows no tags: that's not "untagged".
			return !m || (m.encrypted && !app.vault?.unlocked) ? undefined : m.tags;
		});
	}

	setMapApi({
		get editingId() {
			return editingId;
		},
		get doc() {
			return doc;
		},
		get touch() {
			return app.touch;
		},
		get theme() {
			return app.theme;
		},
		edit,
		commitText,
		cancelEdit: () => (editingId = null),
		noteFor,
		openNote,
		relink,
		newFor,
		populate,
		untagged,
		remove: (ids) => remove(ids),
		press,
		editLabel: (id) => void editLabel(id)
	});

	// --- Svelte Flow events ------------------------------------------------------------

	function connectEdge(c: Connection): MapEdgeT | false {
		if (c.source === c.target) return false;
		checkpoint();
		return edgeOf(link(c.source, c.target));
	}

	function deselect(): boolean {
		if (!selection.nodes.length && !selection.edges.length) return false;
		nodes = nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
		edges = edges.map((e) => (e.selected ? { ...e, selected: false } : e));
		selection = { nodes: [], edges: [] };
		return true;
	}

	/** Back / Escape: close what's open over the map first. */
	function dismiss(): boolean {
		if (picker) {
			picker = null;
			return true;
		}
		if (menu) {
			menu = null;
			return true;
		}
		if (editingId) {
			editingId = null;
			return true;
		}
		return deselect();
	}
	$effect(() => {
		app.graphDismiss = dismiss;
		return () => {
			if (app.graphDismiss === dismiss) app.graphDismiss = null;
		};
	});

	// An in-app move / rename re-points this map's notes (other maps are patched on disk).
	$effect(() =>
		app.onMoved((from, to) => {
			if (status !== 'ready') return;
			const next = rewritePaths(current(), from, to);
			if (next) {
				show(next);
				scheduleSave();
			}
		})
	);

	function keys(e: KeyboardEvent): void {
		if (status !== 'ready' || app.promptRequest || app.confirmRequest || picker || menu) return;
		const t = e.target as HTMLElement | null;
		// Only keys meant for the map: focus on it, or on nothing (not the AI pane beside it).
		if (t && t !== document.body && !host?.contains(t)) return;
		if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
		const mod = e.metaKey || e.ctrlKey;
		const stop = () => {
			e.preventDefault();
			e.stopPropagation();
		};
		if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
			stop();
			if (e.shiftKey) redo();
			else undo();
			return;
		}
		if (mod && (e.key === 'y' || e.key === 'Y')) {
			stop();
			redo();
			return;
		}
		if (mod || e.altKey) return;
		if (e.key === 'Escape') {
			if (dismiss()) stop();
			return;
		}
		if (!single || t?.closest?.('button')) return;
		if (e.key === 'Tab') {
			stop();
			addChild(single);
		} else if (e.key === 'Enter') {
			stop();
			addSibling(single);
		} else if (e.key === 'F2') {
			stop();
			edit(single);
		}
	}

	// --- tidy / fit ----------------------------------------------------------------------

	let tidying = $state(false);

	async function tidy(): Promise<void> {
		if (tidying) return;
		const only = selection.nodes.length > 1 ? new Set(selection.nodes) : null;
		const items = nodes
			.filter((n) => !only || only.has(n.id))
			.map((n) => ({
				id: n.id,
				x: n.position.x,
				y: n.position.y,
				width: n.measured?.width ?? n.data.raw.width,
				height: n.measured?.height ?? n.data.raw.height
			}));
		if (items.length < 2) return;
		tidying = true;
		try {
			const { tidyLayout } = await import('../../maps/tidy');
			const target = await tidyLayout(
				items,
				edges.map((e) => ({ source: e.source, target: e.target }))
			);
			checkpoint();
			await moveTo(target);
			commit();
			if (!only) void flow.fitView({ ...fitOptions(0.2, 1), duration: ms.pane });
		} finally {
			tidying = false;
		}
	}

	/** Glide nodes to `target` over `--dur-pane` (at once with motion off). */
	function moveTo(target: Map<string, { x: number; y: number }>): Promise<void> {
		const from = new Map(nodes.map((n) => [n.id, n.position]));
		const place = (k: number) => {
			nodes = nodes.map((n) => {
				const to = target.get(n.id);
				const f = from.get(n.id);
				if (!to || !f) return n;
				return { ...n, position: { x: f.x + (to.x - f.x) * k, y: f.y + (to.y - f.y) * k } };
			});
		};
		const dur = ms.pane;
		if (!dur) {
			place(1);
			return Promise.resolve();
		}
		return new Promise((done) => {
			const t0 = performance.now();
			const step = (now: number) => {
				const k = Math.min(1, (now - t0) / dur);
				place(easeInOut(k));
				if (k < 1) requestAnimationFrame(step);
				else done();
			};
			requestAnimationFrame(step);
		});
	}

	/**
	 * Fit, but never so far out that a phone's nodes turn into unreadable specks:
	 * there the fit stops at 65% (a wide map then overflows, centred on its content).
	 */
	const fitOptions = (padding: number, maxZoom: number) => ({
		padding,
		maxZoom,
		minZoom: app.layout === 'phone' ? 0.65 : undefined
	});
	const fit = () => void flow.fitView({ ...fitOptions(0.2, 1.2), duration: ms.pane });

	function moreMenu(at: { x: number; y: number }): void {
		menu = {
			title: name,
			at,
			items: [
				{ label: 'Tidy', icon: 'tidy', action: () => void tidy() },
				{ label: snap ? 'Snap to grid: on' : 'Snap to grid: off', icon: 'snap', action: toggleSnap }
			]
		};
	}

	function addMenu(at: { x: number; y: number }): void {
		menu = {
			title: 'Add',
			at,
			items: [
				{ label: 'Idea', icon: 'concept', action: addConcept },
				{ label: 'Note…', icon: 'note', action: pickNote },
				{ label: 'Tag…', icon: 'tag', action: pickTag }
			]
		};
	}

	const below = (e: MouseEvent) => {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return { x: r.left, y: app.touch ? r.top : r.bottom + 6 };
	};
</script>

<svelte:window onkeydowncapture={keys} />
<svelte:document
	onvisibilitychange={() => {
		if (document.visibilityState === 'hidden') void flush();
	}}
/>

<section class={['map', { touch: app.touch }]} aria-label={`Mind map ${name}`} bind:this={host}>
	{#if status === 'loading'}
		<p class="state">Opening…</p>
	{:else if status === 'error'}
		<div class="state" role="alert">
			<p>{failure}</p>
			<button class="btn" onclick={() => app.openMindMap(null)}>Back to maps</button>
		</div>
	{:else}
		<SvelteFlow
			bind:nodes
			bind:edges
			{nodeTypes}
			{edgeTypes}
			colorMode={app.theme}
			connectionMode={ConnectionMode.Loose}
			fitView={nodes.length > 0}
			fitViewOptions={fitOptions(0.25, 1)}
			minZoom={0.1}
			maxZoom={2.5}
			snapGrid={snap ? [10, 10] : undefined}
			deleteKey={['Delete', 'Backspace']}
			panOnDrag={[0, 1]}
			nodeDragThreshold={app.touch ? 6 : 1}
			connectionRadius={app.touch ? 40 : 24}
			zoomOnDoubleClick={false}
			defaultMarkerColor={null}
			attributionPosition={app.touch ? 'top-right' : 'bottom-right'}
			isValidConnection={(c) => c.source !== c.target}
			onbeforeconnect={connectEdge}
			onconnect={commit}
			onnodedragstart={() => {
				cancelPress?.();
				checkpoint();
			}}
			onnodedragstop={commit}
			onselectiondragstart={checkpoint}
			onselectiondragstop={commit}
			onbeforedelete={async () => {
				if (editingId) return false;
				beforeDelete = current();
				checkpoint();
				return true;
			}}
			ondelete={({ nodes: gone }) => {
				const after = current();
				const next = excludeDeleted(
					beforeDelete ?? after,
					after,
					gone.map((n) => n.id)
				);
				beforeDelete = null;
				if (next !== after) show(next);
				else doc = after;
				scheduleSave();
			}}
			onselectionchange={({ nodes: n, edges: e }) =>
				(selection = { nodes: n.map((x) => x.id), edges: e.map((x) => x.id) })}
			onnodecontextmenu={({ event, node }) => {
				event.preventDefault();
				if (!menu) nodeMenu(node.id, { x: event.clientX, y: event.clientY });
			}}
			onedgecontextmenu={({ event, edge }) => {
				event.preventDefault();
				edgeMenu(edge.id, { x: event.clientX, y: event.clientY });
			}}
			onpanecontextmenu={({ event }) => {
				event.preventDefault();
				addMenu({ x: event.clientX, y: event.clientY });
			}}
		>
			<Background variant={BackgroundVariant.Dots} gap={snap ? 10 : 24} size={1.2} />

			<Panel position={app.touch ? 'bottom-center' : 'top-left'} class="map-toolbar">
				<div class="bar" role="toolbar" aria-label="Map">
					<!-- Phones go back with the title bar's Back: one back button per screen. -->
					{#if app.layout !== 'phone'}
						<button
							class="ib"
							title="All maps"
							aria-label="All maps"
							onclick={() => app.openMindMap(null)}><Icon name="back" size={18} /></button
						>
					{/if}
					{#if app.touch}
						<button class="ib" title="Add" aria-label="Add" onclick={(e) => addMenu(below(e))}
							><Icon name="plus" size={18} /></button
						>
					{:else}
						<span class="name" title={name}>{name}</span>
						<span class="sep"></span>
						<button class="ib" title="Add an idea" aria-label="Add an idea" onclick={addConcept}
							><Icon name="concept" size={17} /></button
						>
						<button class="ib" title="Add a note" aria-label="Add a note" onclick={pickNote}
							><Icon name="note" size={17} /></button
						>
						<button class="ib" title="Add a tag" aria-label="Add a tag" onclick={pickTag}
							><Icon name="tag" size={17} /></button
						>
						<span class="sep"></span>
					{/if}
					<button
						class="ib"
						title="Undo (Mod+Z)"
						aria-label="Undo"
						disabled={!undoStack.length}
						onclick={undo}><Icon name="undo" size={17} /></button
					>
					<button
						class="ib"
						title="Redo (Mod+Shift+Z)"
						aria-label="Redo"
						disabled={!redoStack.length}
						onclick={redo}><Icon name="redo" size={17} /></button
					>
					{#if app.touch}
						<button class="ib" title="Fit" aria-label="Fit the map" onclick={fit}
							><Icon name="fit" size={17} /></button
						>
						<button class="ib" title="More" aria-label="More" onclick={(e) => moreMenu(below(e))}
							><Icon name="more" size={18} /></button
						>
					{:else}
						<span class="sep"></span>
						<button
							class={['ib', { on: snap }]}
							title="Snap to grid"
							aria-label="Snap to grid"
							aria-pressed={snap}
							onclick={toggleSnap}><Icon name="snap" size={17} /></button
						>
						<button
							class="ib"
							title={selection.nodes.length > 1 ? 'Tidy the selection' : 'Tidy the map'}
							aria-label="Tidy"
							disabled={tidying}
							onclick={() => void tidy()}><Icon name="tidy" size={17} /></button
						>
						<button class="ib" title="Fit" aria-label="Fit the map" onclick={fit}
							><Icon name="fit" size={17} /></button
						>
						<span class="sep"></span>
						<button
							class="ib"
							title="Close"
							aria-label="Close mind map"
							onclick={() => app.setView('editor')}><Icon name="close" size={18} /></button
						>
					{/if}
				</div>
			</Panel>

			{#if (single && app.touch) || singleEdge}
				<Panel position="top-center" class="map-selbar">
					<div class="bar" role="toolbar" aria-label="Selection">
						{#if singleEdge}
							<button class="tb" onclick={() => void editLabel(singleEdge)}>Label…</button>
							<button
								class="ib"
								aria-label="Delete connection"
								onclick={() => remove([], [singleEdge])}><Icon name="trash" size={17} /></button
							>
						{:else if single}
							{@render actions(single)}
						{/if}
					</div>
				</Panel>
			{/if}

			{#if single && !app.touch && !editingId}
				<NodeToolbar nodeId={single} position={Position.Top} offset={10}>
					<div class="bar float" role="toolbar" aria-label="Selection">
						{@render actions(single)}
					</div>
				</NodeToolbar>
			{/if}
		</SvelteFlow>
		{#if nodes.length === 0}
			<div class="empty">
				<p>
					Add an idea, a note or a tag. Drag from the dots on a node’s sides to connect it to
					another.
				</p>
				<button class="btn primary" onclick={addConcept}>Start with an idea</button>
			</div>
		{/if}
	{/if}
</section>

{#snippet actions(id: string)}
	{#if singleKind === 'concept'}
		<button class="ib" title="Edit (F2)" aria-label="Edit text" onclick={() => edit(id)}
			><Icon name="edit" size={16} /></button
		>
	{:else if singleKind === 'note'}
		<button class="ib" title="Open note" aria-label="Open note" onclick={() => openNote(id)}
			><Icon name="note" size={16} /></button
		>
	{/if}
	{#if singleKind !== 'other'}
		<button
			class="ib"
			title="Add idea after (Tab)"
			aria-label="Add idea after"
			onclick={() => addChild(id)}><Icon name="plus" size={16} /></button
		>
	{/if}
	<button class="ib" title="Color" aria-label="Color" onclick={(e) => colorMenu([id], below(e))}
		><Icon name="palette" size={16} /></button
	>
	{#if app.touch}
		<button
			class="ib"
			title="More"
			aria-label="More actions"
			onclick={(e) => nodeMenu(id, below(e))}><Icon name="more" size={17} /></button
		>
	{/if}
	<button class="ib" title="Delete" aria-label="Delete" onclick={() => remove([id])}
		><Icon name="trash" size={16} /></button
	>
{/snippet}

{#if menu}
	<ActionMenu
		items={menu.items}
		at={menu.at}
		sheet={app.touch}
		title={menu.title}
		label="Map actions"
		onclose={() => (menu = null)}
	/>
{/if}
{#if picker}
	<MapPicker
		title={picker.title}
		placeholder={picker.placeholder}
		items={picker.items}
		free={picker.free}
		onpick={(item) => picker?.onpick(item)}
		onclose={() => (picker = null)}
	/>
{/if}

<style>
	.map {
		position: relative;
		flex: 1;
		min-width: 0;
		height: 100%;
		overflow: hidden;
		border-radius: 12px;
		background: var(--bg-editor);
		box-shadow: var(--shadow-pane);
	}
	/* Phones fill the screen edge to edge; tablets keep the pane card, like the graph. */
	:global(.layout-phone) .map {
		border-radius: 0;
		box-shadow: none;
	}
	/* Svelte Flow themed from the app's tokens (base.css only; no style.css). */
	.map :global(.svelte-flow) {
		--xy-background-color: var(--bg-editor);
		--xy-background-pattern-dots-color: var(--rule);
		--xy-edge-stroke: var(--text-faint);
		--xy-edge-stroke-width: 1.6;
		--xy-edge-stroke-selected: var(--accent);
		--xy-connectionline-stroke: var(--accent);
		--xy-connectionline-stroke-width: 2;
		--xy-selection-background-color: var(--accent-soft);
		--xy-selection-border: 1px solid var(--accent);
		--xy-attribution-background-color: transparent;
		font-family: var(--font-ui);
		color: var(--text);
	}
	.map :global(.svelte-flow__attribution) {
		opacity: 0.55;
		font-size: 9px;
	}
	.map :global(.svelte-flow__attribution a) {
		color: var(--text-faint);
	}
	.map :global(.svelte-flow__edge.selected .svelte-flow__edge-path),
	.map :global(.svelte-flow__edge:focus-visible .svelte-flow__edge-path) {
		stroke: var(--accent);
		stroke-width: 2.2;
	}
	.map :global(.svelte-flow__edge-label.map-edge-label) {
		padding: 2px 8px;
		border-radius: 7px;
		background: var(--bg-editor);
		border: 1px solid var(--rule);
		color: var(--text-muted);
		font-size: 12px;
		white-space: nowrap;
	}
	.map :global(.svelte-flow__node:focus-visible) {
		outline: none;
	}
	.map :global(.svelte-flow__node:focus-visible .map-node) {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
	}

	/* --- nodes --- */
	.map :global(.map-node) {
		position: relative;
		box-sizing: border-box;
		border: 1.5px solid var(--rule);
		border-radius: 10px;
		background: var(--bg-secondary);
		color: var(--text);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
		transition:
			border-color var(--dur-fast) ease,
			box-shadow var(--dur-fast) ease;
	}
	.map :global(.map-node.selected) {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.map :global(.map-node.concept) {
		min-width: 64px;
		max-width: 280px;
		padding: 10px 14px;
		font-size: 14px;
		line-height: 1.4;
	}
	.map :global(.map-node .text) {
		display: block;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.map :global(.map-node .text.empty) {
		color: var(--text-faint);
		font-style: italic;
	}
	.map :global(.map-node textarea) {
		display: block;
		width: 240px;
		max-width: 100%;
		min-height: 22px;
		padding: 0;
		border: 0;
		outline: none;
		resize: none;
		background: transparent;
		color: inherit;
		font: inherit;
		line-height: inherit;
	}
	.map :global(.map-node.note) {
		width: 240px;
		padding: 9px 12px 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.map :global(.map-node.note.missing) {
		border-style: dashed;
		background: transparent;
		color: var(--text-muted);
	}
	.map :global(.map-node .head) {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		color: var(--text-muted);
	}
	.map :global(.map-node .title) {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-strong);
		font-size: 14px;
		font-weight: 600;
	}
	.map :global(.map-node.missing .title) {
		color: var(--text-muted);
	}
	.map :global(.map-node .state) {
		display: inline-flex;
		color: var(--text-faint);
	}
	.map :global(.map-node .meta) {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		font-size: 11.5px;
	}
	.map :global(.map-node .chip) {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 1px 7px;
		border-radius: 6px;
		background: var(--bg-hover);
		color: var(--text-muted);
	}
	.map :global(.map-node .badge) {
		flex: none;
		padding: 1px 6px;
		border-radius: 6px;
		background: var(--danger-soft);
		color: var(--danger);
		font-weight: 600;
	}
	.map :global(.map-node .badge.muted) {
		background: var(--bg-hover);
		color: var(--text-faint);
	}
	.map :global(.map-node .mini) {
		flex: none;
		min-height: 24px;
		padding: 0 8px;
		border-radius: 7px;
		background: var(--accent-soft);
		color: var(--accent-ink);
		font-size: 11.5px;
		font-weight: 600;
		transition: transform var(--dur-fast) ease;
	}
	.map.touch :global(.map-node .mini) {
		min-height: 32px;
		font-size: 13px;
	}
	.map :global(.map-node .mini:active) {
		transform: scale(var(--press));
	}
	.map :global(.map-node.tag) {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-radius: 999px;
		background: var(--accent-soft);
		border-color: transparent;
		color: var(--accent-ink);
		font-weight: 650;
		font-size: 14px;
		white-space: nowrap;
	}
	.map :global(.map-node.tag.selected) {
		border-color: var(--accent);
	}
	.map :global(.map-node.other) {
		padding: 10px 14px;
		max-width: 300px;
		font-size: 13px;
		color: var(--text-muted);
	}
	.map :global(.map-node.other.group) {
		width: 100%;
		height: 100%;
		background: transparent;
		border-style: dashed;
	}

	/* --- handles: dots on each side, a 44px target on touch --- */
	.map :global(.svelte-flow__handle.map-handle) {
		width: 10px;
		height: 10px;
		min-width: 0;
		min-height: 0;
		border: 2px solid var(--bg-editor);
		border-radius: 50%;
		background: var(--accent);
		opacity: 0;
		transition: opacity var(--dur-fast) ease;
	}
	.map :global(.svelte-flow__handle.map-handle::before) {
		content: '';
		position: absolute;
		inset: -9px;
		border-radius: 50%;
	}
	.map.touch :global(.svelte-flow__handle.map-handle) {
		width: 14px;
		height: 14px;
	}
	.map.touch :global(.svelte-flow__handle.map-handle::before) {
		inset: -15px;
	}
	/* Touch: the dots sit just outside the node, so their 44px targets never
	   cover a small node's body (a drag there moves the node). */
	.map.touch :global(.svelte-flow__handle-top.map-handle) {
		top: -16px;
	}
	.map.touch :global(.svelte-flow__handle-bottom.map-handle) {
		top: auto;
		bottom: -16px;
		transform: translate(-50%, 50%);
	}
	.map.touch :global(.svelte-flow__handle-left.map-handle) {
		left: -16px;
	}
	.map.touch :global(.svelte-flow__handle-right.map-handle) {
		left: auto;
		right: -16px;
		transform: translate(50%, -50%);
	}
	.map :global(.svelte-flow__node:hover .map-handle),
	.map :global(.svelte-flow__node.selected .map-handle),
	.map :global(.svelte-flow.connecting .map-handle) {
		opacity: 1;
	}
	/* Touch: handles only on the selected node, so a drag near an edge moves the node. */
	.map.touch :global(.svelte-flow__node:not(.selected) .map-handle) {
		opacity: 0;
		pointer-events: none;
	}
	.map.touch :global(.svelte-flow.connecting .svelte-flow__node .map-handle) {
		opacity: 1;
		pointer-events: all;
	}

	/* --- bars --- */
	.bar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		border: 1px solid var(--rule);
		border-radius: 12px;
		background: var(--bg-elevated);
		box-shadow: 0 6px 22px rgba(0, 0, 0, 0.12);
	}
	.bar.float {
		padding: 3px;
		border-radius: 11px;
	}
	.name {
		max-width: 180px;
		padding: 0 8px 0 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-strong);
		font-size: 13.5px;
		font-weight: 650;
	}
	.sep {
		width: 1px;
		height: 20px;
		margin: 0 4px;
		background: var(--rule);
		opacity: 0.6;
	}
	.ib,
	.tb {
		min-width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border-radius: 9px;
		color: var(--text-muted);
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	.tb {
		padding: 0 12px;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text);
	}
	.map.touch .ib,
	.map.touch .tb {
		min-width: 50px;
		height: 50px;
	}
	.ib:hover:not(:disabled),
	.tb:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.ib:active:not(:disabled) {
		transform: scale(var(--press-icon));
	}
	.tb:active {
		transform: scale(var(--press));
	}
	.ib:focus-visible,
	.tb:focus-visible {
		outline: 2px solid var(--focus-ring);
		outline-offset: -2px;
	}
	.ib:disabled {
		opacity: 0.38;
	}
	.ib.on {
		background: var(--accent-soft);
		color: var(--accent-ink);
	}
	.map :global(.map-toolbar) {
		margin: 12px;
	}
	.map.touch :global(.map-toolbar) {
		margin: 0 12px max(12px, env(safe-area-inset-bottom));
	}
	.map :global(.map-selbar) {
		margin: 12px;
	}

	/* --- states --- */
	.state,
	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 24px;
		text-align: center;
		color: var(--text-muted);
		pointer-events: none;
	}
	.state > *,
	.empty > * {
		pointer-events: auto;
	}
	.empty p {
		max-width: 34ch;
		margin: 0;
		line-height: 1.55;
	}
	.btn {
		min-height: 36px;
		padding: 0 16px;
		border-radius: 9px;
		background: var(--bg-hover);
		color: var(--text);
		font-size: 13.5px;
		font-weight: 600;
		transition:
			background var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	.map.touch .btn {
		min-height: 50px;
		font-size: 16px;
	}
	.btn.primary {
		background: var(--accent);
		color: var(--on-accent);
	}
	.btn:active {
		transform: scale(var(--press));
	}
</style>
