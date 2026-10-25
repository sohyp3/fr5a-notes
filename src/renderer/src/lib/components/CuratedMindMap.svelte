<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type {
		CompiledMindMapNode,
		MindMapConfig,
		MindMapExpandSpec,
		MindMapNodeSpec
	} from '../../../../shared/types';
	import { baseOf, parentOf } from '../../../../shared/paths';
	import { parseMindMap, updateMindMap } from '../../../../shared/mindMap';
	import { getAppState } from '../stores/app.svelte';
	import { platform } from '../platform';
	import { MindMapContentCache } from '../mindMapContentCache';
	import { reducedMotion } from '../portal';
	import {
		buildWorkspaceLinkIndex,
		compileMindMap,
		pinDerivedNode,
		type CompiledMindMap
	} from '../mindMaps';
	import Icon from './Icon.svelte';

	let { mapId }: { mapId: string } = $props();
	const app = getAppState();
	let source = $state('');
	let config = $state.raw<MindMapConfig | null>(null);
	let compiled = $state.raw<CompiledMindMap>({ nodes: [], edges: [], overflow: new Map() });
	let diagnostics = $state<ReturnType<typeof parseMindMap>['diagnostics']>([]);
	let loading = $state(true);
	let saving = $state(false);
	let preparing = $state(false);
	const mutationBusy = $derived(loading || saving || preparing);
	let loadedRevision = $state('');
	let refreshQueued = false;
	let disposed = false;
	let loadGeneration = 0;
	let selectedId = $state('');
	let connecting = $state(false);
	const contentCache = new MindMapContentCache((id) => platform.readNote(id));
	let canvas = $state<HTMLDivElement>();
	let width = $state(0);
	let height = $state(0);
	let camera = $state({ x: 0, y: 0, k: 1 });
	let cameraAnimating = $state(false);
	let cameraAnimationTimer: ReturnType<typeof setTimeout> | undefined;
	let status = $state('');
	let statusTimer: ReturnType<typeof setTimeout> | undefined;
	function showStatus(message: string, duration?: number): void {
		clearTimeout(statusTimer);
		statusTimer = undefined;
		status = message;
		if (duration !== undefined) statusTimer = setTimeout(() => (status = ''), duration);
	}
	function stopCameraAnimation(): void {
		clearTimeout(cameraAnimationTimer);
		cameraAnimationTimer = undefined;
		cameraAnimating = false;
	}
	let error = $state('');
	let retrySave = $state.raw<MindMapConfig | null>(null);
	let editingId = $state('');
	let labelDraft = $state('');
	let labelInput = $state<HTMLInputElement>();
	let outlineOpen = $state(false);
	let sheetStartY: number | null = null;
	const selected = $derived(compiled.nodes.find((node) => node.id === selectedId));
	const canvasTabStop = $derived(
		selected?.id ??
			compiled.nodes.find((node) => node.id === config?.root)?.id ??
			compiled.nodes[0]?.id
	);
	const selectedSpec = $derived(config?.nodes.find((node) => node.id === selectedId));
	const outlineRoot = $derived(config?.nodes.find((node) => node.id === config?.root));
	const viewOnly = $derived(!!app.noteMeta(mapId)?.locked);
	const revision = () =>
		app.listedNotes.map((note) => `${note.id}:${note.mtime}:${note.locked}`).join('|') +
		`:${!!app.vault?.unlocked}`;
	const parents = $derived.by(() => {
		// Rebuilt by this derived value; no mutable collection is observed by the UI.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const out = new Map<string, string>();
		for (const node of config?.nodes ?? [])
			for (const child of node.children ?? []) out.set(child, node.id);
		return out;
	});

	async function workspaceIndex() {
		const unlocked = !!app.vault?.unlocked;
		const visible = app.listedNotes.filter((note) => !note.encrypted || unlocked);
		const snapshotRevision = revision();
		contentCache.retain(visible, unlocked);
		const rows = await Promise.all(
			visible.map(async (note) => [note.id, await contentCache.get(note).catch(() => '')] as const)
		);
		return { index: buildWorkspaceLinkIndex(visible, new Map(rows)), revision: snapshotRevision };
	}

	async function load(): Promise<void> {
		if (saving || preparing || drag) {
			refreshQueued = true;
			return;
		}
		if (disposed) return;
		const generation = ++loadGeneration;
		const firstLoad = !loadedRevision;
		loading = true;
		error = '';
		try {
			await app.flush();
			const sourceRevision = revision();
			// Apply lock-state eviction before seeding the freshly read map body.
			contentCache.retain(app.listedNotes, !!app.vault?.unlocked);
			const nextSource = await platform.readNote(mapId);
			if (disposed || generation !== loadGeneration) return;
			source = nextSource;
			const parsed = parseMindMap(source);
			diagnostics = parsed.diagnostics;
			config = parsed.config;
			const mapMeta = app.noteMeta(mapId);
			if (mapMeta && sourceRevision === revision()) contentCache.seed(mapMeta, source);
			loadedRevision = sourceRevision;
			if (!config || parsed.readOnly) {
				compiled = { nodes: [], edges: [], overflow: new Map() };
				return;
			}
			const workspace = await workspaceIndex();
			if (disposed || generation !== loadGeneration) return;
			compiled = compileMindMap(config, workspace.index, mapId);
			// Keep the source snapshot revision: later external changes still trigger a reload.
			if (!compiled.nodes.some((node) => node.id === selectedId))
				selectedId = app.layout === 'phone' ? '' : config.root;
			requestAnimationFrame(() => {
				if (disposed || !firstLoad) return;
				const root = compiled.nodes.find((node) => node.id === config?.root);
				if (app.layout === 'phone' && root)
					camera = { k: 1.1, x: width / 2 - root.x * 1.1, y: height / 2 - root.y * 1.1 };
				else fit(false);
			});
		} catch (cause) {
			if (disposed || generation !== loadGeneration) return;
			config = null;
			compiled = { nodes: [], edges: [], overflow: new Map() };
			error = cause instanceof Error ? cause.message : 'The map could not be read.';
		} finally {
			if (generation === loadGeneration) loading = false;
		}
	}

	onMount(() => {
		app.graphDismiss = () => {
			if (!selectedId) return false;
			selectedId = '';
			return true;
		};
		void load();
		return () => {
			disposed = true;
			clearTimeout(statusTimer);
			stopCameraAnimation();
			loadGeneration++;
			contentCache.retain([], false);
			app.graphDismiss = null;
		};
	});
	$effect(() => {
		const nextRevision = revision();
		contentCache.retain(app.listedNotes, !!app.vault?.unlocked);
		if (loadedRevision && nextRevision !== loadedRevision) void load();
	});

	async function save(next: MindMapConfig, message: string): Promise<void> {
		if (saving || loading || viewOnly || diagnostics.some((item) => item.severity === 'error'))
			return;
		saving = true;
		try {
			const nextSource = updateMindMap(source, next);
			await app.writeMindMap(mapId, nextSource, source);
			source = nextSource;
			config = next;
			contentCache.retain(app.listedNotes, !!app.vault?.unlocked);
			const mapMeta = app.noteMeta(mapId);
			if (mapMeta) contentCache.seed(mapMeta, nextSource);
			const workspace = await workspaceIndex();
			if (disposed) return;
			compiled = compileMindMap(next, workspace.index, mapId);
			loadedRevision = workspace.revision;
			retrySave = null;
			error = '';
			showStatus(message, 1800);
		} catch (cause) {
			retrySave = next;
			error = cause instanceof Error ? cause.message : 'The map could not be saved.';
		} finally {
			saving = false;
			// The successful write's refresh is already represented in the compiled snapshot.
			// Reload only for a later external revision, including changes during compilation.
			refreshQueued = false;
			if (!error && loadedRevision !== revision()) void load();
		}
	}

	function retry(): void {
		if (retrySave) void save(retrySave, 'Map saved');
		else void load();
	}
	function reload(): void {
		retrySave = null;
		void load();
	}

	function sheetPointerDown(event: PointerEvent): void {
		if ((event.target as HTMLElement).closest('button')) return;
		sheetStartY = event.clientY;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}
	function sheetPointerUp(event: PointerEvent): void {
		if (sheetStartY !== null && event.clientY - sheetStartY > 60) selectedId = '';
		sheetStartY = null;
	}

	// Reserve the mutation while prompts, note creation, or layout work are pending.
	// Refreshes wait for this reservation so save never drops an accepted edit.
	function mutation<Args extends unknown[]>(action: (...args: Args) => Promise<void>) {
		return async (...args: Args): Promise<void> => {
			if (mutationBusy || viewOnly || diagnostics.some((item) => item.severity === 'error')) return;
			preparing = true;
			try {
				await action(...args);
			} finally {
				preparing = false;
				if (refreshQueued && !saving && !drag) {
					refreshQueued = false;
					void load();
				}
			}
		};
	}

	const addChild = mutation(async (): Promise<void> => {
		const targetSpec = selectedSpec;
		if (!config || !targetSpec) return;
		const label = await app.prompt({
			title: 'Add child',
			label: 'Concept label',
			value: '',
			confirm: 'Add',
			check: (value) => (value.trim() ? null : 'Enter a label.')
		});
		if (!label) return;
		const base =
			label
				.toLocaleLowerCase()
				.replace(/[^\p{L}\p{N}]+/gu, '-')
				.replace(/^-|-$/g, '') || 'node';
		let id = base;
		let n = 2;
		while (config.nodes.some((node) => node.id === id)) id = `${base}-${n++}`;
		const nodes = config.nodes.map((node) =>
			node.id === targetSpec.id ? { ...node, children: [...(node.children ?? []), id] } : node
		);
		nodes.push({ id, label: label.trim() });
		await save({ ...config, nodes }, `Added ${label.trim()}`);
		selectedId = id;
		fit();
	});

	const addNoteChild = mutation(async (): Promise<void> => {
		const targetSpec = selectedSpec;
		if (!config || !targetSpec) return;
		const note = await app.prompt({
			title: 'Add note to branch',
			label: 'Workspace-relative Markdown path',
			value: '',
			confirm: 'Add',
			check: (value) => (value.trim() ? null : 'Enter a note path.')
		});
		if (!note) return;
		const base =
			note
				.replace(/\.[^.]+$/, '')
				.split('/')
				.at(-1)!
				.toLocaleLowerCase()
				.replace(/[^\p{L}\p{N}]+/gu, '-') || 'note';
		let id = base;
		let n = 2;
		while (config.nodes.some((node) => node.id === id)) id = `${base}-${n++}`;
		const nodes = config.nodes.map((node) =>
			node.id === targetSpec.id ? { ...node, children: [...(node.children ?? []), id] } : node
		);
		nodes.push({ id, note: note.trim() });
		await save({ ...config, nodes }, 'Note added to branch');
		selectedId = id;
		fit();
	});

	async function editLabel(): Promise<void> {
		if (mutationBusy || viewOnly || !config || !selectedSpec) return;
		editingId = selectedSpec.id;
		labelDraft = selectedSpec.label ?? selected?.title ?? '';
		await tick();
		labelInput?.focus();
		labelInput?.select();
	}
	const commitLabel = mutation(async (): Promise<void> => {
		const id = editingId;
		if (!id || !config) return;
		if (!labelDraft.trim()) {
			showStatus('Enter a label before saving.');
			return;
		}
		editingId = '';
		await save(
			{
				...config,
				nodes: config.nodes.map((node) =>
					node.id === id ? { ...node, label: labelDraft.trim() } : node
				)
			},
			'Label updated'
		);
	});

	const updateExpansion = mutation(async (patch: Partial<MindMapExpandSpec>): Promise<void> => {
		if (!config || !selectedSpec) return;
		await save(
			{
				...config,
				nodes: config.nodes.map((node) =>
					node.id === selectedSpec.id ? { ...node, expand: { ...node.expand, ...patch } } : node
				)
			},
			'Expansion updated'
		);
	});
	async function openOutline(): Promise<void> {
		outlineOpen = true;
		if (selected?.provenance !== 'explicit') selectedId = config?.root ?? '';
		await tick();
		document.querySelector<HTMLElement>(`[data-outline="${CSS.escape(selectedId)}"]`)?.focus();
	}
	const moveChild = mutation(async (id: string, direction: -1 | 1): Promise<void> => {
		if (!config || !selectedSpec) return;
		const children = [...(selectedSpec.children ?? [])];
		const at = children.indexOf(id),
			to = at + direction;
		if (at < 0 || to < 0 || to >= children.length) return;
		[children[at], children[to]] = [children[to], children[at]];
		await save(
			{
				...config,
				nodes: config.nodes.map((node) =>
					node.id === selectedSpec.id ? { ...node, children } : node
				)
			},
			'Child order updated'
		);
	});
	const labelEdge = mutation(async (index: number): Promise<void> => {
		if (!config) return;
		const edge = config.edges?.[index];
		if (!edge) return;
		const label = await app.prompt({
			title: 'Label connection',
			label: 'Connection label',
			value: edge.label ?? '',
			confirm: 'Save'
		});
		if (label === null) return;
		await save(
			{
				...config,
				edges: config.edges!.map((item, at) =>
					at === index ? { ...item, label: label.trim() || undefined } : item
				)
			},
			'Connection updated'
		);
	});
	const removeEdge = mutation(async (index: number): Promise<void> => {
		if (config)
			await save(
				{ ...config, edges: config.edges?.filter((_, at) => at !== index) },
				'Connection removed'
			);
	});

	async function chooseNode(node: CompiledMindMapNode): Promise<void> {
		if (
			!mutationBusy &&
			connecting &&
			config &&
			selectedId &&
			node.id !== selectedId &&
			node.provenance === 'explicit'
		) {
			const exists = (config.edges ?? []).some(
				(edge) => edge.from === selectedId && edge.to === node.id
			);
			if (!exists)
				await save(
					{ ...config, edges: [...(config.edges ?? []), { from: selectedId, to: node.id }] },
					'Connection added'
				);
			connecting = false;
			return;
		}
		selectedId = node.id;
	}

	const pin = mutation(async (): Promise<void> => {
		if (!config || !selected || selected.provenance !== 'derived') return;
		const next = pinDerivedNode(config, selected);
		await save(next, 'Pinned to map');
		selectedId = next.nodes.at(-1)!.id;
	});

	const hideDerived = mutation(async (): Promise<void> => {
		if (!config || !selected || selected.provenance !== 'derived') return;
		const key = selected.kind === 'tag' ? selected.id : `note:${selected.noteId}`;
		await save(
			{ ...config, hidden: [...new Set([...(config.hidden ?? []), key])] },
			'Hidden from this map'
		);
		selectedId = config.root;
	});

	const removeExplicit = mutation(async (): Promise<void> => {
		const targetSpec = selectedSpec;
		if (!config || !targetSpec || targetSpec.id === config.root) return;
		const ok = await app.confirm({
			title: 'Remove from map?',
			body: 'Its children will move up one level. The Markdown note itself will not be deleted.',
			confirm: 'Remove'
		});
		if (!ok) return;
		const parentId = parents.get(targetSpec.id);
		const promoted = targetSpec.children ?? [];
		const nodes = config.nodes
			.filter((node) => node.id !== targetSpec.id)
			.map((node) => ({
				...node,
				children: (node.children ?? []).flatMap((id) => (id === targetSpec.id ? promoted : [id]))
			}));
		await save(
			{
				...config,
				nodes,
				edges: (config.edges ?? []).filter(
					(edge) => edge.from !== targetSpec.id && edge.to !== targetSpec.id
				)
			},
			'Removed from map'
		);
		selectedId = parentId ?? config.root;
	});

	const reparent = mutation(async (parentId: string): Promise<void> => {
		if (!config || !selectedSpec || selectedSpec.id === config.root || parentId === selectedSpec.id)
			return;
		const nodes = config.nodes.map((node) => ({
			...node,
			children: (node.children ?? []).filter((id) => id !== selectedSpec.id)
		}));
		const parent = nodes.find((node) => node.id === parentId);
		if (!parent) return;
		parent.children = [...(parent.children ?? []), selectedSpec.id];
		await save({ ...config, nodes }, 'Branch moved');
	});
	function descendantOf(candidate: MindMapNodeSpec, ancestorId: string): boolean {
		// Local traversal bookkeeping, never rendered or shared across calls.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<string>();
		const walk = (id: string): boolean => {
			if (seen.has(id)) return false;
			seen.add(id);
			const node = config?.nodes.find((item) => item.id === id);
			return (node?.children ?? []).some((child) => child === candidate.id || walk(child));
		};
		return walk(ancestorId);
	}

	const createNote = mutation(async (): Promise<void> => {
		const targetSpec = selectedSpec;
		if (!config || !targetSpec || targetSpec.note) return;
		const meta = await platform.createNote(targetSpec.label || 'Untitled', parentOf(mapId));
		await app.refresh();
		await save(
			{
				...config,
				nodes: config.nodes.map((node) =>
					node.id === targetSpec.id ? { ...node, note: baseOf(meta.id) } : node
				)
			},
			'Note created and linked'
		);
	});

	const repair = mutation(async (): Promise<void> => {
		const targetSpec = selectedSpec;
		if (!config || !targetSpec) return;
		const note = await app.prompt({
			title: 'Repair note reference',
			label: 'Workspace-relative Markdown path',
			value: targetSpec.note ?? '',
			confirm: 'Update',
			check: (value) => (value.trim() ? null : 'Enter a note path.')
		});
		if (!note) return;
		await save(
			{
				...config,
				nodes: config.nodes.map((node) =>
					node.id === targetSpec.id ? { ...node, note: note.trim() } : node
				)
			},
			'Reference updated'
		);
	});

	const reflow = mutation(async (): Promise<void> => {
		if (
			!config ||
			!(await app.confirm({
				title: 'Reflow map?',
				body: 'This replaces every saved node position with a fresh deterministic layout.',
				confirm: 'Reflow'
			}))
		)
			return;
		const cleared = {
			...config,
			nodes: config.nodes.map((node) => {
				const cleared = { ...node };
				delete cleared.position;
				return cleared;
			})
		};
		const workspace = await workspaceIndex();
		const laid = compileMindMap(cleared, workspace.index, mapId);
		const positions = new Map(
			laid.nodes
				.filter((node) => node.provenance === 'explicit')
				.map((node) => [node.id, { x: node.x, y: node.y }])
		);
		await save(
			{
				...cleared,
				nodes: cleared.nodes.map((node) => ({ ...node, position: positions.get(node.id) }))
			},
			'Map reflowed'
		);
		fit();
	});

	function fit(animate = true): void {
		if (!width || !height || !compiled.nodes.length) return;
		const xs = compiled.nodes.map((node) => node.x);
		const ys = compiled.nodes.map((node) => node.y);
		const x0 = Math.min(...xs) - 120,
			x1 = Math.max(...xs) + 120;
		const y0 = Math.min(...ys) - 90,
			y1 = Math.max(...ys) + 90;
		const k = Math.min(1.25, Math.max(0.25, Math.min(width / (x1 - x0), height / (y1 - y0))));
		const next = { k, x: width / 2 - ((x0 + x1) / 2) * k, y: height / 2 - ((y0 + y1) / 2) * k };
		camera = next;
		stopCameraAnimation();
		cameraAnimating = animate && !reducedMotion();
		if (cameraAnimating) cameraAnimationTimer = setTimeout(stopCameraAnimation, 220);
	}

	let drag: {
		type: 'pan' | 'node' | 'branch';
		id?: string;
		px: number;
		py: number;
		x: number;
		y: number;
	} | null = null;
	// Gesture bookkeeping is read only by pointer handlers, never by the template.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pointers = new Map<number, { x: number; y: number }>();
	let pinch: { distance: number; k: number; wx: number; wy: number } | null = null;
	function pointerDown(event: PointerEvent): void {
		if ((event.target as HTMLElement).closest('.tools, input')) return;
		stopCameraAnimation();
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (pointers.size === 2) {
			if (drag?.type === 'node') {
				const node = compiled.nodes.find((item) => item.id === drag?.id);
				if (node) {
					node.x = drag.x;
					node.y = drag.y;
					compiled = { ...compiled, nodes: [...compiled.nodes] };
				}
			}
			const [a, b] = [...pointers.values()];
			const box = canvas!.getBoundingClientRect();
			const px = (a.x + b.x) / 2 - box.left,
				py = (a.y + b.y) / 2 - box.top;
			pinch = {
				distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
				k: camera.k,
				wx: (px - camera.x) / camera.k,
				wy: (py - camera.y) / camera.k
			};
			drag = null;
			canvas?.setPointerCapture(event.pointerId);
			return;
		}
		const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-branch]');
		if (handle && !mutationBusy && !viewOnly) {
			selectedId = handle.dataset.branch!;
			drag = { type: 'branch', id: selectedId, px: event.clientX, py: event.clientY, x: 0, y: 0 };
			showStatus('Drop onto a node to change this branch’s parent.');
			canvas?.setPointerCapture(event.pointerId);
			return;
		}
		const target = (event.target as HTMLElement).closest<HTMLElement>('[data-node]');
		if (target) {
			const node = compiled.nodes.find((item) => item.id === target.dataset.node);
			if (!node || mutationBusy || node.provenance !== 'explicit' || diagnostics.length || viewOnly)
				return;
			drag = {
				type: 'node',
				id: node.id,
				px: event.clientX,
				py: event.clientY,
				x: node.x,
				y: node.y
			};
		} else drag = { type: 'pan', px: event.clientX, py: event.clientY, x: camera.x, y: camera.y };
		(target ?? canvas)?.setPointerCapture(event.pointerId);
	}
	function pointerMove(event: PointerEvent): void {
		if (pointers.has(event.pointerId))
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (pinch && pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			const box = canvas!.getBoundingClientRect();
			const k = Math.min(
				3,
				Math.max(0.18, (pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance)
			);
			camera = {
				k,
				x: (a.x + b.x) / 2 - box.left - pinch.wx * k,
				y: (a.y + b.y) / 2 - box.top - pinch.wy * k
			};
			return;
		}
		if (!drag) return;
		if (drag.type === 'branch') return;
		const dx = event.clientX - drag.px,
			dy = event.clientY - drag.py;
		if (drag.type === 'pan') camera = { ...camera, x: drag.x + dx, y: drag.y + dy };
		else {
			const node = compiled.nodes.find((item) => item.id === drag!.id);
			if (node) {
				node.x = drag.x + dx / camera.k;
				node.y = drag.y + dy / camera.k;
				compiled = { ...compiled, nodes: [...compiled.nodes] };
			}
		}
	}
	async function pointerUp(event: PointerEvent): Promise<void> {
		pointers.delete(event.pointerId);
		if (pinch) {
			if (pointers.size < 2) pinch = null;
			drag = null;
			return;
		}
		const ended = drag;
		drag = null;
		if (ended && ended.type !== 'pan' && mutationBusy) {
			if (ended.type === 'node') {
				const node = compiled.nodes.find((item) => item.id === ended.id);
				if (node) {
					node.x = ended.x;
					node.y = ended.y;
					compiled = { ...compiled, nodes: [...compiled.nodes] };
				}
			}
			return;
		}
		if (ended?.type === 'branch') {
			const targetId = document
				.elementFromPoint(event.clientX, event.clientY)
				?.closest<HTMLElement>('[data-node]')?.dataset.node;
			const target = config?.nodes.find((node) => node.id === targetId);
			if (
				event.type !== 'pointercancel' &&
				target &&
				target.id !== ended.id &&
				!descendantOf(target, ended.id!)
			)
				await reparent(target.id);
			else {
				showStatus('Branch unchanged. Drop onto a different explicit node.');
				if (refreshQueued) {
					refreshQueued = false;
					void load();
				}
			}
			return;
		}
		if (!ended || ended.type !== 'node' || !config) {
			if (refreshQueued) {
				refreshQueued = false;
				void load();
			}
			return;
		}
		const node = compiled.nodes.find((item) => item.id === ended.id);
		if (event.type === 'pointercancel' && node) {
			node.x = ended.x;
			node.y = ended.y;
			compiled = { ...compiled, nodes: [...compiled.nodes] };
			if (refreshQueued) {
				refreshQueued = false;
				void load();
			}
			return;
		}
		if (!node || Math.hypot(event.clientX - ended.px, event.clientY - ended.py) < 3) {
			if (refreshQueued) {
				refreshQueued = false;
				void load();
			}
			return;
		}
		await save(
			{
				...config,
				nodes: config.nodes.map((item) =>
					item.id === node.id
						? { ...item, position: { x: Math.round(node.x), y: Math.round(node.y) } }
						: item
				)
			},
			'Position saved'
		);
	}
	function wheelZoom(element: HTMLElement): () => void {
		const wheel = (event: WheelEvent) => {
			stopCameraAnimation();
			event.preventDefault();
			const box = element.getBoundingClientRect();
			const px = event.clientX - box.left,
				py = event.clientY - box.top;
			const k = Math.min(3, Math.max(0.18, camera.k * Math.exp(-event.deltaY * 0.002)));
			const wx = (px - camera.x) / camera.k,
				wy = (py - camera.y) / camera.k;
			camera = { k, x: px - wx * k, y: py - wy * k };
		};
		element.addEventListener('wheel', wheel, { passive: false });
		return () => element.removeEventListener('wheel', wheel);
	}
	function edgePath(from: CompiledMindMapNode, to: CompiledMindMapNode): string {
		const bend = Math.max(45, Math.abs(to.x - from.x) * 0.45);
		return `M ${from.x} ${from.y} C ${from.x + Math.sign(to.x - from.x || 1) * bend} ${from.y}, ${to.x - Math.sign(to.x - from.x || 1) * bend} ${to.y}, ${to.x} ${to.y}`;
	}
	function keyNode(event: KeyboardEvent, node: CompiledMindMapNode): void {
		event.stopPropagation();
		if (event.key.toLocaleLowerCase() === 'o' && node.noteId) {
			event.preventDefault();
			app.openNote(node.noteId);
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			void chooseNode(node);
			return;
		}
		if (!config) return;
		const spec = config.nodes.find((item) => item.id === node.id);
		let target: string | undefined;
		if (event.key === 'ArrowLeft') target = parents.get(node.id);
		if (event.key === 'ArrowRight') target = spec?.children?.[0];
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			const siblings =
				config.nodes.find((item) => item.id === parents.get(node.id))?.children ?? [];
			const at = siblings.indexOf(node.id);
			target = siblings[at + (event.key === 'ArrowDown' ? 1 : -1)];
		}
		if (target) {
			event.preventDefault();
			selectedId = target;
			document.querySelector<HTMLElement>(`[data-outline="${CSS.escape(target)}"]`)?.focus();
		}
	}
	function keyCanvasNode(event: KeyboardEvent, node: CompiledMindMapNode): void {
		const directions: Record<string, readonly [number, number]> = {
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0],
			ArrowUp: [0, -1],
			ArrowDown: [0, 1]
		};
		const direction = directions[event.key];
		if (!direction && event.key !== 'Home' && event.key !== 'End') return;
		event.preventDefault();
		event.stopPropagation();
		let target: CompiledMindMapNode | undefined;
		if (event.key === 'Home') target = compiled.nodes.find((item) => item.id === config?.root);
		else if (event.key === 'End') target = compiled.nodes.at(-1);
		else {
			let nearest = Infinity;
			for (const candidate of compiled.nodes) {
				if (candidate.id === node.id) continue;
				const dx = candidate.x - node.x;
				const dy = candidate.y - node.y;
				const forward = dx * direction[0] + dy * direction[1];
				if (forward <= 0) continue;
				// Prefer nearby nodes aligned with the pressed arrow, including automatic nodes.
				const perpendicular = Math.abs(dx * direction[1] - dy * direction[0]);
				const distance = Math.hypot(dx, dy) + perpendicular * 2;
				if (distance < nearest) {
					nearest = distance;
					target = candidate;
				}
			}
		}
		if (!target) return;
		selectedId = target.id;
		canvas
			?.querySelector<HTMLElement>(`[data-node="${CSS.escape(target.id)}"]`)
			?.focus({ preventScroll: true });
	}
</script>

{#snippet outlineNode(spec: MindMapNodeSpec, level: number)}
	{@const node = compiled.nodes.find((item) => item.id === spec.id)}
	{#if node}
		<div
			role="treeitem"
			tabindex={node.id === selectedId || (!selectedId && node.id === config?.root) ? 0 : -1}
			aria-level={level}
			aria-selected={node.id === selectedId}
			aria-expanded={spec.children?.length ? true : undefined}
			aria-label={`${node.title}${node.noteId ? ', press O to open note' : ''}`}
			data-outline={node.id}
			onclick={(event) => {
				event.stopPropagation();
				selectedId = node.id;
			}}
			onkeydown={(event) => keyNode(event, node)}
		>
			<span>{node.title}</span>
			{#if spec.children?.length}
				<div role="group">
					{#each spec.children as childId (childId)}
						{@const child = config?.nodes.find((item) => item.id === childId)}
						{#if child}{@render outlineNode(child, level + 1)}{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

<section
	class:phone={app.layout === 'phone'}
	class:tablet={app.layout === 'tablet'}
	class="mindmap"
	aria-label="Mind map"
>
	<header>
		<button
			class="icon"
			title="Choose a map"
			aria-label="Choose a map"
			onclick={() => app.openMindMap(null)}><Icon name="back" size={18} /></button
		>
		<div>
			<h1>{app.noteMeta(mapId)?.title ?? 'Mind map'}</h1>
			<p>
				{loading
					? 'Reading map…'
					: `${compiled.nodes.length} nodes${viewOnly ? ' · view only' : ''}`}
			</p>
		</div>
		<span class="spacer"></span>
		{#if !viewOnly}<button
				disabled={mutationBusy || !config || diagnostics.some((item) => item.severity === 'error')}
				onclick={reflow}>Reflow</button
			>{/if}
		<button onclick={() => app.openNote(mapId, true)}>Edit source</button>
		<button class="icon" aria-label="Close mind map" onclick={() => app.setView('editor')}
			><Icon name="close" size={18} /></button
		>
	</header>
	{#if error}
		<div class="invalid" role="alert">
			<Icon name="info" size={22} />
			<div>
				<h2>{retrySave ? 'Couldn’t save this map' : 'Couldn’t load this map'}</h2>
				<p>{error}</p>
			</div>
			<div class="recovery">
				<button onclick={retry}>Retry</button>
				{#if retrySave}<button class="secondary" onclick={reload}>Reload map</button>{/if}
				<button class="secondary" onclick={() => app.openNote(mapId, true)}>Edit source</button>
			</div>
		</div>
	{:else if loading && !config}
		<p class="loading" role="status">Reading map…</p>
	{:else if diagnostics.length || !config}
		<div class="invalid" role="alert">
			<Icon name="info" size={22} />
			<div>
				<h2>
					{diagnostics.some((item) => item.code === 'unsupported-version')
						? 'This map needs an upgrade'
						: 'The map source needs attention'}
				</h2>
				{#each diagnostics as item, at (at)}<p>
						{item.line
							? `Line ${item.line}${item.column ? `:${item.column}` : ''} — `
							: ''}{item.message}
					</p>{/each}
				{#if diagnostics.length === 0}<p>
						This note does not contain a valid version-1 mind map.
					</p>{/if}
			</div>
			<button onclick={() => app.openNote(mapId, true)}>Edit source</button>
		</div>
	{:else}
		<div class="workspace">
			<div
				class="canvas"
				role="application"
				aria-label="Mind map canvas. Use arrow keys to move between nodes, Home for the root, and End for the last node."
				bind:this={canvas}
				bind:clientWidth={width}
				bind:clientHeight={height}
				onpointerdown={pointerDown}
				onpointermove={pointerMove}
				onpointerup={pointerUp}
				onpointercancel={pointerUp}
				{@attach wheelZoom}
			>
				<div
					class="world"
					class:camera-animating={cameraAnimating}
					style={`transform: translate(${camera.x}px, ${camera.y}px) scale(${camera.k})`}
				>
					<svg viewBox="-5000 -5000 10000 10000" aria-hidden="true">
						{#each compiled.edges as edge (`${edge.from}-${edge.to}-${edge.kind}`)}
							{@const from = compiled.nodes.find((node) => node.id === edge.from)}
							{@const to = compiled.nodes.find((node) => node.id === edge.to)}
							{#if from && to}
								<path d={edgePath(from, to)} class={edge.kind} />
								{#if edge.label}<text
										x={(from.x + to.x) / 2}
										y={(from.y + to.y) / 2 - 10}
										text-anchor="middle">{edge.label}</text
									>{/if}
							{/if}
						{/each}
					</svg>
					{#each compiled.nodes as node (node.id)}
						{#if editingId === node.id}
							<input
								class="inline-label"
								aria-label="Node label"
								disabled={mutationBusy}
								bind:this={labelInput}
								bind:value={labelDraft}
								style={`left:${node.x}px;top:${node.y}px`}
								onblur={commitLabel}
								onkeydown={(event) => {
									event.stopPropagation();
									if (event.key === 'Enter') {
										event.preventDefault();
										void commitLabel();
									}
									if (event.key === 'Escape') {
										editingId = '';
									}
								}}
							/>
						{:else}
							<button
								class={[
									'node',
									node.kind,
									node.provenance,
									{ selected: node.id === selectedId, connecting }
								]}
								data-node={node.id}
								tabindex={node.id === canvasTabStop ? 0 : -1}
								style={`left:${node.x}px;top:${node.y}px`}
								aria-pressed={node.id === selectedId}
								aria-label={`${node.title}, ${node.kind}${node.provenance === 'derived' ? ', automatic' : ''}`}
								onclick={(event) => {
									event.stopPropagation();
									void chooseNode(node);
								}}
								onkeydown={(event) => {
									keyCanvasNode(event, node);
									if (
										event.key === 'Enter' &&
										node.id === selectedId &&
										node.provenance === 'explicit' &&
										!viewOnly
									) {
										event.preventDefault();
										void editLabel();
									}
								}}
								ondblclick={() => !viewOnly && node.provenance === 'explicit' && editLabel()}
							>
								<span>{node.title}</span>{#if node.provenance === 'derived'}<small>automatic</small
									>{/if}
							</button>
						{/if}
						{#if app.layout === 'desktop' && node.provenance === 'explicit' && node.id !== config.root && !viewOnly}
							<button
								class="branch-handle"
								tabindex={-1}
								disabled={mutationBusy}
								data-branch={node.id}
								style={`left:${node.x + 105}px;top:${node.y}px`}
								aria-label={`Reparent ${node.title}`}
								title="Drag onto a node to reparent"><Icon name="graph" size={13} /></button
							>
						{/if}
					{/each}
				</div>
				<div class="tools">
					<button
						aria-label="Zoom out"
						onclick={() => (camera = { ...camera, k: Math.max(0.18, camera.k / 1.25) })}
						><Icon name="minus" size={15} /></button
					><span>{Math.round(camera.k * 100)}%</span><button
						aria-label="Zoom in"
						onclick={() => (camera = { ...camera, k: Math.min(3, camera.k * 1.25) })}
						><Icon name="plus" size={15} /></button
					><button onclick={() => fit()}>Fit</button>
					<button onclick={openOutline}>Outline</button>
					{#if app.layout === 'phone'}<button onclick={() => app.openNote(mapId, true)}
							>Edit source</button
						>{/if}
				</div>
				{#if connecting}<p class="connect-hint">Choose an explicit node to connect</p>{/if}
			</div>

			<aside class:open={!!selected} aria-label="Map inspector">
				{#if selected}
					<div
						class="inspector-head"
						role="group"
						aria-label="Inspector controls"
						onpointerdown={sheetPointerDown}
						onpointerup={sheetPointerUp}
						onpointercancel={() => (sheetStartY = null)}
					>
						<div>
							<strong>{selected.title}</strong><span>{selected.kind} · {selected.provenance}</span>
						</div>
						<button class="icon" aria-label="Close inspector" onclick={() => (selectedId = '')}
							><Icon name="close" size={16} /></button
						>
					</div>
					<fieldset class="inspector-body" disabled={mutationBusy}>
						{#if selected.noteId}<button
								class="primary"
								onclick={() => app.openNote(selected.noteId!)}>Open note</button
							>{/if}
						{#if selected.kind === 'missing' && !viewOnly}<button onclick={repair}
								>Repair reference</button
							>{/if}
						{#if viewOnly}
							<p class="overflow">
								This note is locked. Unlock it in the note editor to change the map.
							</p>
						{:else if selected.provenance === 'derived'}
							<button class="primary" onclick={pin}>Pin to map</button><button onclick={hideDerived}
								>Hide from this map</button
							>
						{:else}
							<label>Label<button class="field" onclick={editLabel}>{selected.title}</button></label
							>
							{#if selectedSpec?.note}<label
									>Linked note<button class="field" onclick={repair} dir="auto"
										>{selectedSpec.note}</button
									></label
								>{/if}
							{#if selectedSpec && !selectedSpec.note}<button onclick={createNote}
									>Create note</button
								>{/if}
							<button onclick={addChild}>Add child</button>
							<button onclick={addNoteChild}>Add note reference</button>
							<button class:active={connecting} onclick={() => (connecting = !connecting)}
								>Connect</button
							>
							{#if selectedSpec?.children?.length}
								<div class="relationships">
									<h3>Children</h3>
									{#each selectedSpec.children as childId, at (childId)}
										{@const child = compiled.nodes.find((node) => node.id === childId)}
										<div class="relationship-row">
											<button onclick={() => (selectedId = childId)} dir="auto"
												>{child?.title ?? childId}</button
											><button
												aria-label={`Move ${child?.title ?? childId} up`}
												disabled={at === 0}
												onclick={() => moveChild(childId, -1)}
												><Icon name="back" size={14} /></button
											><button
												aria-label={`Move ${child?.title ?? childId} down`}
												disabled={at === selectedSpec.children.length - 1}
												onclick={() => moveChild(childId, 1)}><Icon name="next" size={14} /></button
											>
										</div>
									{/each}
								</div>
							{/if}
							{#if config.edges?.some((edge) => edge.from === selectedId || edge.to === selectedId)}
								<div class="relationships">
									<h3>Cross-links</h3>
									{#each config.edges ?? [] as edge, at (at)}
										{#if edge.from === selectedId || edge.to === selectedId}
											{@const otherId = edge.from === selectedId ? edge.to : edge.from}
											<div class="relationship-row">
												<button onclick={() => labelEdge(at)} dir="auto"
													>{compiled.nodes.find((node) => node.id === otherId)?.title ??
														otherId}{edge.label ? ` · ${edge.label}` : ''}</button
												><button aria-label="Remove connection" onclick={() => removeEdge(at)}
													><Icon name="close" size={14} /></button
												>
											</div>
										{/if}
									{/each}
								</div>
							{/if}
							{#if selected.id !== config.root}<label
									>Parent<select
										value={parents.get(selected.id) ?? ''}
										onchange={(event) => reparent(event.currentTarget.value)}
										>{#if !parents.has(selected.id)}<option value="" disabled
												>No hierarchical parent</option
											>{/if}{#each config.nodes.filter((node) => node.id !== selected.id && !descendantOf(node, selected.id)) as node (node.id)}<option
												value={node.id}>{node.label || node.note || node.id}</option
											>{/each}</select
									></label
								>{/if}
							<label
								>Automatic links<select
									value={selectedSpec?.expand?.links ?? 'none'}
									onchange={(event) =>
										selectedSpec &&
										save(
											{
												...config!,
												nodes: config!.nodes.map((node) =>
													node.id === selected.id
														? {
																...node,
																expand: {
																	...node.expand,
																	links: event.currentTarget.value as
																		'none' | 'outgoing' | 'incoming' | 'both'
																}
															}
														: node
												)
											},
											'Expansion updated'
										)}
									><option value="none">None</option><option value="outgoing">Outgoing</option
									><option value="incoming">Backlinks</option><option value="both">Both</option
									></select
								></label
							>
							<label
								>Tag paths<input
									value={(selectedSpec?.expand?.tags ?? []).join(', ')}
									placeholder="work/project, ideas/*"
									onchange={(event) =>
										selectedSpec &&
										save(
											{
												...config!,
												nodes: config!.nodes.map((node) =>
													node.id === selected.id
														? {
																...node,
																expand: {
																	...node.expand,
																	tags: event.currentTarget.value
																		.split(',')
																		.map((tag) => tag.trim())
																		.filter(Boolean)
																}
															}
														: node
												)
											},
											'Tag expansion updated'
										)}
								/></label
							>
							<div class="expansion-bounds">
								<label
									>Depth<select
										value={String(selectedSpec?.expand?.depth ?? 1)}
										onchange={(event) =>
											updateExpansion({ depth: Number(event.currentTarget.value) })}
										><option value="1">1 level</option><option value="2">2 levels</option></select
									></label
								><label
									>Item limit<input
										aria-label="Item limit"
										type="number"
										min="0"
										max="100"
										value={selectedSpec?.expand?.limit ?? 24}
										onchange={(event) => {
											const limit = Number(event.currentTarget.value);
											if (Number.isInteger(limit) && limit >= 0 && limit <= 100)
												void updateExpansion({ limit });
											else showStatus('Use an item limit between 0 and 100.');
										}}
									/></label
								>
							</div>
							<p class="overflow">
								{compiled.nodes.filter(
									(node) => node.provenance === 'derived' && node.originId === selected.id
								).length} automatic items
							</p>
							{#if compiled.overflow.get(selected.id)}<p class="overflow">
									{compiled.overflow.get(selected.id)} automatic items omitted by this node’s limit.
								</p>{/if}
							{#if selected.id !== config.root}<button class="danger" onclick={removeExplicit}
									>Remove from map</button
								>{/if}
							{#if app.layout === 'phone'}<button disabled={mutationBusy} onclick={reflow}
									>Reflow map</button
								>{/if}
						{/if}
					</fieldset>
				{/if}
			</aside>
		</div>
		<details class="outline" bind:open={outlineOpen}>
			<summary>Outline view</summary>
			<div role="tree">
				{#if outlineRoot}{@render outlineNode(outlineRoot, 1)}{/if}
				{#each config.nodes.filter((node) => node.id !== config?.root && !parents.has(node.id)) as detached (detached.id)}{@render outlineNode(
						detached,
						1
					)}{/each}
			</div>
		</details>
		<p class="sr-status" aria-live="polite">{status}</p>
	{/if}
</section>

<style>
	.mindmap {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: 12px;
		background: var(--bg-editor);
		box-shadow: var(--shadow-pane);
	}
	button {
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
	}
	header {
		min-height: 68px;
		padding: 10px 14px 10px 18px;
		display: flex;
		align-items: center;
		gap: 8px;
		border-bottom: 1px solid var(--rule);
	}
	header div {
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-size: 17px;
	}
	header p {
		margin: 2px 0 0;
		color: var(--text-muted);
		font-size: 12px;
	}
	.spacer {
		flex: 1;
	}
	button,
	select,
	input {
		font: inherit;
	}
	header button,
	.tools button,
	.inspector-body button {
		min-height: 38px;
		padding: 0 11px;
		border: 1px solid var(--rule);
		border-radius: 9px;
		background: var(--bg-editor);
		color: var(--text);
	}
	button.icon {
		width: 40px;
		padding: 0;
		display: grid;
		place-items: center;
		border: 0;
		background: transparent;
		color: var(--text-muted);
	}
	.workspace {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 310px;
	}
	.canvas {
		position: relative;
		min-width: 0;
		/* Panning owns the camera; focus must never scroll this internal surface. */
		overflow: clip;
		touch-action: none;
		background: var(--bg-editor);
		cursor: grab;
	}
	.canvas:active {
		cursor: grabbing;
	}
	.world {
		position: absolute;
		inset: 0;
		transform-origin: 0 0;
		will-change: transform;
	}
	.world.camera-animating {
		transition: transform var(--dur-pane) var(--ease-out);
	}
	.world text {
		fill: var(--text-muted);
		stroke: var(--bg-editor);
		stroke-width: 5px;
		paint-order: stroke;
		font-size: 12px;
	}
	.inline-label {
		position: absolute;
		transform: translate(-50%, -50%);
		z-index: 3;
		width: 190px;
		min-height: 44px;
		padding: 8px;
		border: 2px solid var(--accent);
		border-radius: 10px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	.branch-handle {
		position: absolute;
		transform: translate(-50%, -50%);
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border: 1px solid var(--rule);
		border-radius: 50%;
		background: var(--bg-editor);
		color: var(--text-muted);
		cursor: grab;
	}
	.world svg {
		position: absolute;
		left: -5000px;
		top: -5000px;
		width: 10000px;
		height: 10000px;
		overflow: visible;
		pointer-events: none;
	}
	path {
		fill: none;
		stroke: var(--rule);
		stroke-width: 1.4;
		vector-effect: non-scaling-stroke;
	}
	path.branch {
		stroke: color-mix(in srgb, var(--text) 35%, transparent);
		stroke-width: 2;
	}
	path.cross {
		stroke: color-mix(in srgb, var(--accent) 42%, transparent);
		stroke-dasharray: 5 4;
	}
	path.markdown-link,
	path.backlink,
	path.tag {
		stroke: color-mix(in srgb, var(--text-muted) 25%, transparent);
	}
	.node {
		position: absolute;
		transform: translate(-50%, -50%);
		min-width: 92px;
		max-width: 180px;
		min-height: 42px;
		padding: 9px 13px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--rule);
		border-radius: 13px;
		background: var(--bg-editor);
		color: var(--text);
		box-shadow: none;
		cursor: pointer;
		user-select: none;
	}
	.node span {
		overflow-wrap: anywhere;
		unicode-bidi: plaintext;
	}
	.node small {
		margin-top: 2px;
		color: var(--text-muted);
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.node.root {
		min-width: 120px;
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 700;
		box-shadow: 0 7px 18px color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.node.note {
		border-radius: 10px;
	}
	.node.note::before {
		content: '';
		width: 6px;
		height: 6px;
		margin-bottom: 5px;
		border-radius: 50%;
		background: var(--accent);
	}
	.node.tag {
		min-width: auto;
		min-height: 30px;
		padding: 5px 10px;
		border-radius: 999px;
		color: var(--accent);
		box-shadow: none;
	}
	.node.missing {
		border-style: dashed;
		border-color: var(--danger);
		color: var(--danger);
		box-shadow: none;
	}
	.node.derived {
		opacity: 0.78;
		box-shadow: none;
	}
	.node.selected {
		outline: 3px solid color-mix(in srgb, var(--accent) 24%, transparent);
		outline-offset: 3px;
	}
	.node.connecting:not(.derived) {
		cursor: crosshair;
	}
	.tools {
		position: absolute;
		left: 16px;
		bottom: 16px;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		border: 1px solid var(--rule);
		border-radius: 11px;
		background: var(--bg-editor);
		box-shadow: var(--shadow-pane);
	}
	.tools button {
		border: 0;
		min-width: 36px;
		padding: 0 8px;
	}
	.tools span {
		min-width: 44px;
		text-align: center;
		color: var(--text-muted);
		font-size: 11px;
	}
	.connect-hint {
		position: absolute;
		top: 14px;
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		padding: 8px 12px;
		border-radius: 9px;
		background: var(--text);
		color: var(--bg-editor);
		font-size: 12px;
	}
	aside {
		min-width: 0;
		border-left: 1px solid var(--rule);
		background: var(--bg-list);
		overflow: auto;
		overscroll-behavior: contain;
	}
	.inspector-head {
		padding: 18px;
		display: flex;
		gap: 10px;
		border-bottom: 1px solid var(--rule);
	}
	.inspector-head > div {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.inspector-head strong {
		overflow-wrap: anywhere;
	}
	.inspector-head span {
		color: var(--text-muted);
		font-size: 12px;
		text-transform: capitalize;
	}
	.inspector-body {
		margin: 0;
		border: 0;
		min-width: 0;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.relationships h3 {
		margin: 8px 0;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 500;
	}
	.relationship-row {
		display: flex;
		gap: 4px;
		margin-block: 4px;
	}
	.relationship-row button:first-child {
		min-width: 0;
		flex: 1;
		text-align: start;
		overflow-wrap: anywhere;
	}
	.expansion-bounds {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.expansion-bounds input {
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
	}
	.loading {
		margin: auto;
		color: var(--text-muted);
	}
	.inspector-body label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		color: var(--text-muted);
		font-size: 12px;
	}
	.inspector-body input,
	.inspector-body select,
	.field {
		min-height: 40px;
		padding: 0 10px;
		border: 1px solid var(--rule);
		border-radius: 9px;
		background: var(--bg-editor);
		color: var(--text);
		text-align: start;
	}
	.inspector-body button.primary {
		border-color: transparent;
		background: var(--accent);
		color: var(--on-accent);
	}
	.inspector-body button.active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.inspector-body button.danger {
		color: var(--danger);
	}
	.overflow {
		margin: 2px 0;
		color: var(--text-muted);
		font-size: 12px;
		line-height: 1.45;
	}
	.invalid {
		margin: auto;
		max-width: 620px;
		padding: 28px;
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: start;
		gap: 16px;
	}
	.invalid h2 {
		margin: 0 0 8px;
		font-size: 19px;
	}
	.invalid p {
		margin: 5px 0;
		color: var(--text-muted);
		line-height: 1.5;
	}
	.invalid button {
		min-height: 42px;
		padding: 0 14px;
		border: 0;
		border-radius: 9px;
		background: var(--accent);
		color: var(--on-accent);
	}
	.invalid .recovery {
		display: flex;
		gap: 8px;
	}
	.invalid button.secondary {
		border: 1px solid var(--rule);
		background: var(--bg-editor);
		color: var(--text);
	}
	.outline {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
	.outline[open],
	.outline:focus-within {
		position: fixed;
		z-index: 20;
		left: 20px;
		bottom: 20px;
		width: 260px;
		max-height: min(70vh, 600px);
		height: auto;
		overflow: auto;
		padding: 12px;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--bg-editor);
	}
	.outline [role='tree'],
	.outline [role='group'] {
		display: flex;
		flex-direction: column;
	}
	.outline summary {
		min-height: 44px;
		line-height: 44px;
		cursor: pointer;
	}
	.outline [role='group'] {
		padding-inline-start: 14px;
	}
	.outline [role='treeitem'] {
		min-height: 40px;
		padding: 8px;
		text-align: start;
		color: var(--text);
		cursor: default;
	}
	.outline [role='treeitem']:focus {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.sr-status {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.tablet .workspace,
	.phone .workspace {
		grid-template-columns: 1fr;
		position: relative;
	}
	.tablet aside,
	.phone aside {
		position: absolute;
		z-index: 5;
		inset: auto 0 0;
		max-height: 55%;
		padding-bottom: env(safe-area-inset-bottom, 0px);
		border: 0;
		border-top: 1px solid var(--rule);
		border-radius: 16px 16px 0 0;
		box-shadow: 0 -12px 30px color-mix(in srgb, black 10%, transparent);
		transform: translateY(100%);
		transition: transform var(--dur-sheet) var(--ease-out);
	}
	.tablet aside::before,
	.phone aside::before {
		content: '';
		display: block;
		width: 36px;
		height: 4px;
		margin: 7px auto 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-muted) 42%, transparent);
	}
	.tablet .inspector-head,
	.phone .inspector-head {
		touch-action: pan-x;
	}
	.tablet aside.open,
	.phone aside.open {
		transform: translateY(0);
	}
	.phone aside {
		height: calc(100% - 12px);
		max-height: calc(100% - 12px);
	}
	.phone {
		border-radius: 0;
		box-shadow: none;
	}
	.phone header {
		display: none;
	}
	.phone .tools {
		max-width: calc(100% - 32px);
		flex-wrap: wrap;
	}
	:global([data-touch]) .tools button {
		min-width: 48px;
	}
	:global([data-touch]) button,
	:global([data-touch]) select,
	:global([data-touch]) input {
		min-height: 48px;
	}
	:global([data-touch]) select,
	:global([data-touch]) input {
		font-size: 16px;
	}
	@media (prefers-reduced-motion: reduce) {
		.world.camera-animating {
			transition: none;
		}
		.tablet aside,
		.phone aside {
			transition: none;
		}
	}
</style>
