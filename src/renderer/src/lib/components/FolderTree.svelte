<script lang="ts">
	import { slide } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import type { FolderNode } from '../folders';
	import { dropFor, endDrag, startDrag } from '../dnd';
	import { haptic } from '../portal';
	import Icon from './Icon.svelte';
	import Self from './FolderTree.svelte';

	let { node, depth = 0 }: { node: FolderNode; depth?: number } = $props();

	const app = getAppState();
	// Expansion lives in the app's persisted sidebar state, so it survives
	// relaunches and "collapse all" is just a store write.
	const expanded = $derived(app.isFolderExpanded(node.path, depth));

	const hasChildren = $derived(node.children.length > 0);
	const selected = $derived(app.selectedFolder === node.path);
	const hidden = $derived(app.folderHidden(node.path));
	// Only looked up while encryption is on.
	const sealed = $derived(!!app.vault && app.folderEncrypted(node.path));

	// --- drop target (mouse drag of a note / folder) ---------------------------
	let over = $state(false);
	let expandTimer: ReturnType<typeof setTimeout> | null = null;

	function onDragOver(e: DragEvent): void {
		if (!dropFor(e, node.path)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		if (over) return;
		over = true;
		// Hovering a closed folder opens it, so a deeper target can be reached.
		if (hasChildren && !expanded)
			expandTimer = setTimeout(() => app.toggleFolderExpanded(node.path, depth), 650);
	}

	function onDragLeave(e: DragEvent): void {
		if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
		over = false;
		if (expandTimer) clearTimeout(expandTimer);
	}

	function onDrop(e: DragEvent): void {
		over = false;
		if (expandTimer) clearTimeout(expandTimer);
		const item = dropFor(e, node.path);
		endDrag();
		if (!item) return;
		e.preventDefault();
		if (item.kind === 'note') void app.moveNoteTo(item.path, node.path);
		else void app.moveFolderTo(item.path, node.path);
	}

	// --- menu: right-click, long-press (touch), or the ⋯ button ----------------
	const LONG_PRESS_MS = 500;
	let press: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
	let longPressed = false;

	function openMenu(x: number, y: number): void {
		app.folderMenu = { x, y, path: node.path };
	}

	function onPointerDown(e: PointerEvent): void {
		longPressed = false;
		if (e.pointerType === 'mouse') return;
		const { clientX: x, clientY: y } = e;
		press = {
			x,
			y,
			timer: setTimeout(() => {
				press = null;
				longPressed = true;
				haptic(8);
				openMenu(x, y);
			}, LONG_PRESS_MS)
		};
	}

	function onPointerMove(e: PointerEvent): void {
		if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
	}

	function cancelPress(): void {
		if (press) clearTimeout(press.timer);
		press = null;
	}

	function onContextMenu(e: MouseEvent): void {
		e.preventDefault();
		if (!e.clientX && !e.clientY) {
			// From the keyboard (Menu key / Shift+F10): hang it off the row.
			const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
			openMenu(r.left + 24, r.bottom + 2);
		} else if (press) {
			// The browser's own long-press beat the timer: open once, at the finger.
			const { x, y } = press;
			cancelPress();
			longPressed = true;
			openMenu(x, y);
		} else if (!longPressed) openMenu(e.clientX, e.clientY);
	}

	function onSelect(): void {
		// The release of a long-press only opens the menu.
		if (longPressed) {
			longPressed = false;
			return;
		}
		app.selectFolder(node.path);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={['folder-row', { selected, over }]}
	style:padding-left="{8 + depth * 14}px"
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
>
	<button
		class={['twist', { hidden: !hasChildren }]}
		aria-label="Expand"
		onclick={(e) => {
			e.stopPropagation();
			app.toggleFolderExpanded(node.path, depth);
		}}
	>
		<span class={['chev', { open: expanded }]}><Icon name="chevron" size={12} stroke={2.4} /></span>
	</button>

	<button
		class="label"
		draggable={!app.touch}
		onclick={onSelect}
		oncontextmenu={onContextMenu}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={cancelPress}
		onpointercancel={cancelPress}
		ondragstart={(e) => startDrag(e, { kind: 'folder', path: node.path })}
		ondragend={endDrag}
	>
		<span class="ico"><Icon name="folder" size={14} /></span>
		<span class="name">{node.name}</span>
		{#if sealed}
			<span
				class="shield"
				title="Every note here is encrypted; new notes will be too"
				aria-hidden="true"><Icon name="key" size={11} stroke={2} /></span
			>
		{/if}
		{#if hidden}
			<span
				class={['shield', { inherited: hidden.via === 'parent' }]}
				title={hidden.via === 'self'
					? 'Hidden from cloud AI — only local providers can read these notes'
					: `Hidden from cloud AI (inside “${hidden.folder || 'Everything'}”)`}
				aria-hidden="true"><Icon name="shield" size={11} stroke={2} /></span
			>
		{/if}
		<span class="count">{node.count}</span>
	</button>
	{#if !app.touch}
		<button
			class="more"
			title="Folder actions"
			aria-label="Folder actions for {node.name}"
			aria-haspopup="menu"
			onclick={(e) => {
				const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
				openMenu(r.left, r.bottom + 4);
			}}><Icon name="more" size={14} /></button
		>
	{/if}
</div>

{#if hasChildren && expanded}
	<div transition:slide={{ duration: app.touch ? 0 : 160 }}>
		{#each node.children as child (child.path)}
			<Self node={child} depth={depth + 1} />
		{/each}
	</div>
{/if}

<style>
	.folder-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 2px;
		height: 30px;
		border-radius: 8px;
		padding-right: 8px;
		margin: 1px 6px;
		color: var(--text);
		transition: background 110ms ease;
	}
	.folder-row:hover {
		background: var(--bg-hover);
	}
	.folder-row.selected {
		background: var(--accent-soft);
	}
	.folder-row.over {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.folder-row.selected .name,
	.folder-row.selected .ico {
		color: var(--accent);
		font-weight: 600;
	}
	.twist {
		width: 16px;
		height: 16px;
		display: grid;
		place-items: center;
		color: var(--text-faint);
		flex: 0 0 auto;
	}
	.twist.hidden {
		visibility: hidden;
	}
	.chev {
		display: grid;
		transition: transform 140ms var(--ease-spring);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.label {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 13.5px;
		min-width: 0;
		/* Touch: long-press opens our menu, not the browser's text selection. */
		-webkit-touch-callout: none;
		user-select: none;
	}
	.ico {
		flex: 0 0 auto;
		display: grid;
		color: var(--text-muted);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shield {
		flex: 0 0 auto;
		display: grid;
		margin-left: -2px;
		color: var(--accent);
	}
	.shield.inherited {
		color: var(--text-faint);
	}
	.count {
		margin-left: auto;
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	/* Mouse: the ⋯ button sits over the count, shown on hover / keyboard focus. */
	.more {
		position: absolute;
		right: 4px;
		top: 4px;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		color: var(--text-muted);
		opacity: 0;
	}
	.more:hover,
	.more:focus-visible {
		background: var(--bg-active);
	}
	.folder-row:hover .more,
	.more:focus-visible {
		opacity: 1;
	}
	.folder-row:hover .count {
		visibility: hidden;
	}
</style>
