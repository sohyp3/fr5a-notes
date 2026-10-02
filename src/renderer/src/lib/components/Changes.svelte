<script lang="ts">
	import { fade } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import { compactDiff, diffLines } from '../harness/diff';
	import { docToText } from '../editor/markdown';
	import DiffView from './DiffView.svelte';
	import Icon from './Icon.svelte';
	import type { GitChange } from '../../../../shared/types';

	const app = getAppState();

	type Row = GitChange & { added: number; removed: number; lines: ReturnType<typeof compactDiff> };

	function rowOf(c: GitChange): Row {
		const all = diffLines(c.before ?? '', c.after ?? '');
		return {
			...c,
			added: all.filter((l) => l.op === 'add').length,
			removed: all.filter((l) => l.op === 'del').length,
			lines: compactDiff(all, 3)
		};
	}

	const rows = $derived((app.changes ?? []).map(rowOf));
	let selected = $state<string | null>(null);
	// On a phone the list and the diff take turns on screen.
	let showDiff = $state(false);

	// Pick the requested note (from the editor / AI), else the first change.
	$effect(() => {
		const focus = app.changesFocus;
		if (focus && rows.some((r) => r.path === focus)) {
			selected = focus;
			showDiff = true;
		} else if (!selected || !rows.some((r) => r.path === selected)) {
			selected = rows[0]?.path ?? null;
		}
	});

	const current = $derived(rows.find((r) => r.path === selected) ?? null);

	// Without git: what changed in the open note since it was opened.
	const sinceOpened = $derived.by(() => {
		if (app.changes !== null || !app.baseline) return null;
		const now = app.editor ? docToText(app.editor) : app.activeContent;
		if (now === app.baseline.text) return null;
		return rowOf({
			path: app.activeId ?? 'New note',
			status: app.baseline.id ? 'modified' : 'added',
			before: app.baseline.text,
			after: now
		});
	});

	function split(path: string): { dir: string; name: string } {
		const i = path.lastIndexOf('/');
		return i === -1
			? { dir: '', name: path }
			: { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
	}

	const STATUS = { added: 'A', modified: 'M', deleted: 'D' } as const;
	const exists = (p: string) => app.notes.some((n) => n.id === p);

	function pick(path: string): void {
		selected = path;
		showDiff = true;
		app.changesFocus = null;
	}
</script>

<div class="changes" class:phone={app.layout === 'phone'} class:show-diff={showDiff}>
	<header class="head">
		<div class="titles">
			<h1>Changes</h1>
			<p class="sub">
				{#if app.changes === null}
					Not a git repository
				{:else if rows.length}
					{rows.length} {rows.length === 1 ? 'note' : 'notes'} changed since the last sync
				{:else}
					Everything is committed
				{/if}
			</p>
		</div>
		<button
			class="icon-btn"
			class:spin={app.changesLoading}
			title="Refresh"
			aria-label="Refresh changes"
			onclick={() => app.refreshChanges()}
		>
			<Icon name="retry" size={16} />
		</button>
		<button
			class="icon-btn"
			aria-label="Close changes"
			title="Close"
			onclick={() => app.setView('editor')}
		>
			<Icon name="close" size={17} />
		</button>
	</header>

	{#if app.changes === null}
		<div class="cbody single">
			<div class="explain">
				<p>
					This notes folder isn't under git, so there is no "last sync" to compare with. Set up sync
					in
					<button class="link" onclick={() => app.openSettings('sync')}>Settings → Sync</button> to get
					a full history of every note.
				</p>
				{#if sinceOpened}
					<h2>{sinceOpened.path} — since you opened it</h2>
					<p class="counts">
						<span class="add">+{sinceOpened.added}</span>
						<span class="del">−{sinceOpened.removed}</span>
					</p>
					<DiffView lines={sinceOpened.lines} />
				{:else if app.baseline}
					<p class="muted">No edits to the open note since you opened it.</p>
				{/if}
			</div>
		</div>
	{:else if !rows.length}
		<div class="cbody single">
			<p class="explain muted">
				No note differs from the last commit. Edits show up here until the next push or pull.
			</p>
		</div>
	{:else}
		<div class="cbody">
			<ul class="files" aria-label="Changed notes">
				{#each rows as r (r.path)}
					{@const p = split(r.path)}
					<li>
						<button class="file" class:on={r.path === selected} onclick={() => pick(r.path)}>
							<span class="badge {r.status}" title={r.status}>{STATUS[r.status]}</span>
							<span class="fname">
								<span class="name">{p.name}</span>
								{#if p.dir}<span class="dir">{p.dir}</span>{/if}
							</span>
							<span class="counts">
								{#if r.added}<span class="add">+{r.added}</span>{/if}
								{#if r.removed}<span class="del">−{r.removed}</span>{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
			<section class="detail" aria-label="Diff">
				{#if current}
					{#key current.path}
						<div class="detail-head" in:fade={{ duration: 120 }}>
							{#if app.layout === 'phone'}
								<button
									class="icon-btn"
									aria-label="All changes"
									onclick={() => (showDiff = false)}
								>
									<Icon name="back" size={17} />
								</button>
							{/if}
							<div class="dtitle">
								<strong>{split(current.path).name}</strong>
								<span
									>{current.status}{split(current.path).dir
										? ` · ${split(current.path).dir}`
										: ''}</span
								>
							</div>
							{#if exists(current.path)}
								<button class="btn" onclick={() => app.openNote(current.path)}>Open note</button>
							{/if}
						</div>
						<div class="diff-scroll" in:fade={{ duration: 120 }}>
							<DiffView lines={current.lines} />
						</div>
					{/key}
				{/if}
			</section>
		</div>
	{/if}
</div>

<style>
	.changes {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-editor);
		border-radius: 12px;
		box-shadow: var(--shadow-pane);
		overflow: hidden;
	}
	.changes.phone {
		border-radius: 0;
		box-shadow: none;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 18px 18px 12px 24px;
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	.phone .head {
		padding: 10px 8px 10px 16px;
	}
	.titles {
		flex: 1;
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
		color: var(--text-strong);
	}
	.sub {
		margin: 2px 0 0;
		font-size: 12.5px;
		color: var(--text-muted);
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 9px;
		color: var(--text-muted);
		transition: background var(--dur-fast) ease;
	}
	:global(html[data-touch]) .icon-btn {
		width: 44px;
		height: 44px;
	}
	.icon-btn:hover,
	.icon-btn:active {
		background: var(--bg-hover);
		color: var(--text);
	}
	.icon-btn.spin :global(.icon) {
		animation: spin 800ms linear infinite;
	}
	.cbody {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(220px, 300px) 1fr;
	}
	.cbody.single {
		display: block;
		overflow-y: auto;
	}
	.phone .cbody {
		grid-template-columns: 1fr;
	}
	.phone:not(.show-diff) .detail,
	.phone.show-diff .files {
		display: none;
	}
	.files {
		margin: 0;
		padding: 8px;
		list-style: none;
		overflow-y: auto;
		box-shadow: inset -1px 0 0 var(--bg-hover);
	}
	.file {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 40px;
		padding: 6px 10px;
		border-radius: 8px;
		text-align: start;
		transition: background var(--dur-fast) ease;
	}
	:global(html[data-touch]) .file {
		min-height: 52px;
	}
	.file:hover {
		background: var(--bg-hover);
	}
	.file.on {
		background: var(--accent-soft);
	}
	.badge {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 5px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: #fff;
	}
	.badge.added {
		background: var(--ok);
	}
	.badge.modified {
		background: var(--accent);
	}
	.badge.deleted {
		background: var(--danger);
	}
	.fname {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.name {
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text-strong);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dir {
		font-size: 11px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.counts {
		flex: 0 0 auto;
		display: flex;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.add {
		color: var(--add-fg);
	}
	.del {
		color: var(--del-fg);
	}
	.detail {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.detail-head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 18px;
	}
	.phone .detail-head {
		padding: 8px 12px 8px 4px;
	}
	.dtitle {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.dtitle strong {
		font-size: 14px;
		color: var(--text-strong);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dtitle span {
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.diff-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 18px 24px;
	}
	.phone .diff-scroll {
		padding: 0 10px 24px;
	}
	.btn {
		flex: 0 0 auto;
		min-height: 32px;
		padding: 0 14px;
		border-radius: 8px;
		background: var(--bg-hover);
		font-size: 13px;
		font-weight: 600;
		transition: background var(--dur-fast) ease;
	}
	:global(html[data-touch]) .btn {
		min-height: 44px;
	}
	.btn:hover,
	.btn:active {
		background: var(--bg-active);
	}
	.explain {
		max-width: 720px;
		margin: 0 auto;
		padding: 20px 24px 40px;
		font-size: 13.5px;
		line-height: 1.6;
		color: var(--text);
	}
	.explain h2 {
		margin: 22px 0 2px;
		font-size: 14px;
		color: var(--text-strong);
	}
	.explain .counts {
		margin: 0 0 10px;
	}
	.muted {
		color: var(--text-muted);
	}
	.link {
		color: var(--accent);
		font-weight: 600;
		padding: 0;
		font-size: inherit;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
