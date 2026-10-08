<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { tick } from 'svelte';
	import { getAppState } from '../stores/app.svelte';
	import { buildFolderTree, type FolderNode } from '../folders';
	import { reducedMotion } from '../portal';
	import { baseOf, cleanFolder, parentOf } from '../../../../shared/paths';
	import Icon from './Icon.svelte';

	const app = getAppState();
	const req = $derived(app.moveRequest);
	const dur = reducedMotion() ? 0 : 1;
	const phone = $derived(app.layout === 'phone');

	interface Row {
		path: string;
		label: string;
		depth: number;
		/** A folder that doesn't exist yet (typed in the filter). */
		create?: boolean;
	}

	/** The filter typed: empty again for every request. */
	let query = $derived.by(() => {
		void req;
		return '';
	});
	let listEl = $state<HTMLDivElement | null>(null);
	let scrimPressed = false;

	const subject = $derived.by(() => {
		if (!req) return '';
		if (req.kind === 'folder') return baseOf(req.path);
		return app.notes.find((n) => n.id === req.path)?.title ?? baseOf(req.path);
	});
	/** Where the item is now: not a destination. */
	const current = $derived(req ? parentOf(req.path) : '');

	function flatten(nodes: FolderNode[], depth: number, out: Row[]): Row[] {
		for (const n of nodes) {
			// A folder can't go into itself or anything below it.
			if (req?.kind === 'folder' && (n.path === req.path || n.path.startsWith(`${req.path}/`)))
				continue;
			out.push({ path: n.path, label: n.name, depth });
			flatten(n.children, depth + 1, out);
		}
		return out;
	}

	const rows = $derived.by((): Row[] => {
		const all = flatten(buildFolderTree(app.notes, app.folders), 1, [
			{ path: '', label: 'Notes', depth: 0 }
		]);
		const q = query.trim().toLowerCase();
		if (!q) return all;
		// Filtering: full paths, flat; offer to create what was typed.
		const hits = all
			.filter((r) => r.path && r.path.toLowerCase().includes(q))
			.map((r) => ({ ...r, label: r.path, depth: 0 }));
		const typed = cleanFolder(query);
		const exists = typed && app.folderExists(typed);
		const blocked =
			req?.kind === 'folder' && (typed === req.path || typed.startsWith(`${req.path}/`));
		if (typed && !exists && !blocked)
			hits.push({ path: typed, label: `New folder “${typed}”`, depth: 0, create: true });
		return hits;
	});

	/** Keyboard cursor: back on the first destination whenever the rows change. */
	const firstDestination = (all: Row[]) => all.findIndex((r) => r.path !== current || r.create);
	let cursor = $derived(Math.max(0, firstDestination(rows)));

	function onKey(e: KeyboardEvent): void {
		if (!req || e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		close();
	}

	/**
	 * Attachment: focus the filter for each request. Touch: don't pop the
	 * keyboard just to show the list.
	 */
	function focusFilter(input: HTMLInputElement): void {
		if (req && !app.touch) input.focus();
	}

	function close(): void {
		app.moveRequest = null;
	}

	function choose(row: Row): void {
		const r = req;
		if (!r || (row.path === current && !row.create)) return;
		close();
		if (r.kind === 'note') void app.moveNoteTo(r.path, row.path);
		else void app.moveFolderTo(r.path, row.path);
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const n = rows.length;
			if (!n) return;
			cursor = (cursor + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
			void tick().then(() =>
				listEl?.querySelector('[data-cursor]')?.scrollIntoView({ block: 'nearest' })
			);
		} else if (e.key === 'Enter' && rows[cursor]) {
			e.preventDefault();
			choose(rows[cursor]);
		}
	}
</script>

<!-- Escape cancels. -->
<svelte:window onkeydowncapture={onKey} />

{#if req}
	<div class={['root', { sheet: phone }]}>
		<button
			class="scrim"
			aria-label="Cancel"
			tabindex="-1"
			onpointerdown={() => (scrimPressed = true)}
			onclick={() => {
				if (scrimPressed) close();
				scrimPressed = false;
			}}
			transition:fade={{ duration: 160 * dur }}
		></button>
		<div
			class="dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="move-title"
			in:fly={phone ? { y: 60, duration: 240 * dur, opacity: 0 } : { y: 0, duration: 0 }}
			out:fade={{ duration: 120 * dur }}
		>
			<div class="inner" in:scale={{ start: 0.96, duration: phone ? 0 : 180 * dur }}>
				<h2 id="move-title">Move “{subject}”</h2>
				<input
					{@attach focusFilter}
					bind:value={query}
					onkeydown={onKeydown}
					placeholder="Find or create a folder"
					aria-label="Find or create a folder"
					aria-controls="move-list"
					spellcheck="false"
					autocomplete="off"
					autocapitalize="off"
				/>
				<div class="list" id="move-list" role="listbox" aria-label="Folders" bind:this={listEl}>
					{#each rows as row, i (row.path + (row.create ? '+' : ''))}
						{@const here = row.path === current && !row.create}
						{@const hidden = row.create ? null : app.folderHidden(row.path)}
						<button
							class={['row', { cursor: i === cursor }]}
							data-cursor={i === cursor ? '' : undefined}
							role="option"
							aria-selected={i === cursor}
							disabled={here}
							style:padding-inline-start="{10 + row.depth * 16}px"
							onclick={() => choose(row)}
						>
							<Icon name={row.create ? 'plus' : row.path ? 'folder' : 'note'} size={15} />
							<span class="name">{row.label}</span>
							{#if hidden}<span class="shield" title="Hidden from cloud AI"
									><Icon name="shield" size={11} stroke={2} /></span
								>{/if}
							{#if here}<span class="hint">current</span>{/if}
						</button>
					{:else}
						<p class="empty">No folders match.</p>
					{/each}
				</div>
				<div class="actions">
					<button class="btn" onclick={close}>Cancel</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.root {
		position: fixed;
		inset: 0;
		z-index: 140;
		display: grid;
		place-items: center;
		padding: 16px;
	}
	.root.sheet {
		place-items: end stretch;
		padding: 0;
	}
	.scrim {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.34);
		cursor: default;
	}
	.dialog {
		position: relative;
		width: min(420px, 100%);
		border-radius: 14px;
		background: var(--bg-editor);
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
	}
	.inner {
		display: flex;
		flex-direction: column;
		max-height: min(560px, calc(100vh - 32px));
		padding: 18px 16px 14px;
	}
	.sheet .dialog {
		width: 100%;
		border-radius: 18px 18px 0 0;
	}
	.sheet .inner {
		max-height: 80vh;
		padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
	}
	h2 {
		flex: 0 0 auto;
		margin: 0 4px 12px;
		font-size: 16px;
		font-weight: 700;
		color: var(--text-strong);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	input {
		flex: 0 0 auto;
		height: 36px;
		padding: 0 11px;
		border-radius: 9px;
		border: 1px solid var(--bg-active);
		background: var(--bg-list);
		color: var(--text);
		font: inherit;
		font-size: 14px;
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}
	.sheet input {
		height: 44px;
		font-size: 16px;
	}
	.list {
		flex: 1 1 auto;
		min-height: 120px;
		overflow-y: auto;
		margin-top: 8px;
		padding: 2px 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 34px;
		padding-inline-end: 10px;
		border-radius: 8px;
		font-size: 13.5px;
		color: var(--text);
		text-align: start;
	}
	.row :global(.icon) {
		color: var(--text-muted);
	}
	:global(html[data-touch]) .row {
		min-height: 44px;
		font-size: 15px;
	}
	.row:hover:not(:disabled),
	.row.cursor:not(:disabled) {
		background: var(--bg-hover);
	}
	.row.cursor:not(:disabled) {
		box-shadow: inset 0 0 0 1px var(--bg-active);
	}
	.row:disabled {
		cursor: default;
		color: var(--text-muted);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shield {
		display: grid;
		color: var(--accent);
	}
	.hint {
		font-size: 11px;
		color: var(--text-faint);
	}
	.empty {
		margin: 12px 10px;
		font-size: 13px;
		color: var(--text-muted);
	}
	.actions {
		flex: 0 0 auto;
		display: flex;
		justify-content: flex-end;
		margin-top: 10px;
	}
	.btn {
		min-height: 36px;
		padding: 0 16px;
		border-radius: 9px;
		background: var(--bg-hover);
		color: var(--text);
		font-size: 13.5px;
		font-weight: 600;
	}
	.sheet .btn {
		width: 100%;
		min-height: 50px;
		font-size: 16px;
	}
	.btn:hover {
		background: var(--bg-active);
	}
</style>
