<script lang="ts">
	import { fade } from 'svelte/transition';
	import { getAppState } from '../stores/app.svelte';
	import { platform } from '../platform';
	import { compactDiff, diffLines } from '../harness/diff';
	import { docToText } from '../editor/markdown';
	import DiffView from './DiffView.svelte';
	import Icon from './Icon.svelte';
	import type { GitChange, GitStash } from '../../../../shared/types';
	import { isEncryptedNote } from '../../../../shared/encrypted';

	const app = getAppState();
	const canStash = !!platform.gitStash;
	const canRevert = !!platform.gitRevert;

	type Row = GitChange & {
		added: number;
		removed: number;
		lines: ReturnType<typeof compactDiff>;
		/** Ciphertext on a side (encrypted note, key locked): no diff to show. */
		sealed: boolean;
	};

	function rowOf(c: GitChange): Row {
		const sealed = [c.before, c.after].some((t) => t !== null && isEncryptedNote(t));
		const all = sealed ? [] : diffLines(c.before ?? '', c.after ?? '');
		return {
			...c,
			sealed,
			added: all.filter((l) => l.op === 'add').length,
			removed: all.filter((l) => l.op === 'del').length,
			lines: compactDiff(all, 3)
		};
	}

	const rows = $derived((app.changes ?? []).map(rowOf));
	const stashKey = (s: GitStash) => `${s.repo}\0${s.id}`;
	/** What was last picked: a changed note, or a stash shown instead of one. */
	let picked = $state<string | null>(null);
	let pickedStash = $state<string | null>(null);
	/** The note requested from the editor / AI, while it has changes. */
	const focused = $derived(rows.some((r) => r.path === app.changesFocus) ? app.changesFocus : null);
	// The requested note, else the pick, else the first change.
	const selected = $derived(
		focused ?? (rows.some((r) => r.path === picked) ? picked : (rows[0]?.path ?? null))
	);
	const selectedStash = $derived.by(() => {
		if (focused) return null;
		if (app.stashes.some((s) => stashKey(s) === pickedStash)) return pickedStash;
		// Nothing changed: show the newest stash.
		return !selected && app.stashes.length ? stashKey(app.stashes[0]) : null;
	});
	// On a phone the list and the diff take turns on screen: the diff once picked
	// (or opened on a requested note), the list after Back.
	let diffOpen = $state<boolean | null>(null);
	const showDiff = $derived(diffOpen ?? !!focused);

	const current = $derived(selectedStash ? null : (rows.find((r) => r.path === selected) ?? null));
	const currentStash = $derived(app.stashes.find((s) => stashKey(s) === selectedStash) ?? null);
	const stashRows = $derived(currentStash ? currentStash.files.map(rowOf) : []);

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
	const plural = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`;
	/** "plan.md" for one note, "3 notes" for more. */
	const count = (paths: string[]) =>
		paths.length === 1 ? split(paths[0]).name : plural(paths.length);

	function when(ms: number): string {
		const d = new Date(ms);
		const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
		if (d.toDateString() === new Date().toDateString()) return `today ${time}`;
		return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
	}

	function pick(path: string): void {
		picked = path;
		pickedStash = null;
		diffOpen = true;
		app.changesFocus = null;
	}

	function pickStash(s: GitStash): void {
		pickedStash = stashKey(s);
		diffOpen = true;
		app.changesFocus = null;
	}

	// --- stash / revert ----------------------------------------------------

	/** What the last stash / revert reported; successes fade after a few seconds. */
	let notice = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let noticeTimer: ReturnType<typeof setTimeout> | null = null;

	function say(err: string | null, ok: string): void {
		if (noticeTimer) clearTimeout(noticeTimer);
		notice = err ? { kind: 'error', text: err } : { kind: 'ok', text: ok };
		noticeTimer = err ? null : setTimeout(() => (notice = null), 4000);
	}

	/** Notes the stash form is about to set aside (null = form closed). */
	let stashing = $state.raw<string[] | null>(null);
	let stashMessage = $state('');

	/** Default stash message: the notes' names. */
	function names(paths: string[]): string {
		const n = paths.map((p) => split(p).name.replace(/\.(md|markdown|txt)$/i, ''));
		return n.length <= 2 ? n.join(', ') : `${n.slice(0, 2).join(', ')} +${n.length - 2} more`;
	}

	function startStash(paths: string[]): void {
		stashing = paths;
		stashMessage = '';
		notice = null;
	}

	async function stash(): Promise<void> {
		if (!stashing) return;
		const paths = stashing;
		const message = stashMessage.trim() || names(paths);
		stashing = null;
		const err = await app.stashChanges(paths, message);
		say(err, `Stashed ${count(paths)} as “${message}”.`);
		if (!err && app.stashes[0]) {
			pickedStash = stashKey(app.stashes[0]);
			diffOpen = false;
		}
	}

	async function revert(paths: string[]): Promise<void> {
		const fresh = rows.filter((r) => paths.includes(r.path) && r.status === 'added').length;
		const ok = await app.confirm({
			title: `Revert ${count(paths)}?`,
			body: `Back to the last commit — the changes since are lost.${fresh ? ` New ${fresh === 1 ? 'note moves' : 'notes move'} to the trash.` : ''}`,
			confirm: 'Revert',
			danger: true
		});
		if (!ok) return;
		say(await app.revertChanges(paths), `Reverted ${count(paths)}.`);
		diffOpen = false;
	}

	async function apply(s: GitStash, drop: boolean): Promise<void> {
		const err = await app.applyStash(s, drop);
		say(err, drop ? `Restored “${s.message}”.` : `Applied “${s.message}”; the stash is kept.`);
		if (!err && drop) diffOpen = false;
	}

	async function drop(s: GitStash): Promise<void> {
		const ok = await app.confirm({
			title: 'Drop this stash?',
			body: `“${s.message}” (${plural(s.files.length)}) is deleted for good.`,
			confirm: 'Drop',
			danger: true
		});
		if (!ok) return;
		say(await app.dropStash(s), `Dropped “${s.message}”.`);
		diffOpen = false;
	}

	/** Attachment: focus the stash message field when the form opens. */
	function focusOnMount(node: HTMLElement): void {
		node.focus();
	}
</script>

<div class={['changes', { phone: app.layout === 'phone', 'show-diff': showDiff }]}>
	<header class="head">
		<div class="titles">
			<h1>Changes</h1>
			<p class="sub">
				{#if app.changes === null}
					Not a git repository
				{:else if rows.length}
					{plural(rows.length)} changed since the last sync
				{:else}
					Everything is committed
				{/if}
				{#if app.changes !== null && app.stashes.length}
					· {app.stashes.length} {app.stashes.length === 1 ? 'stash' : 'stashes'}
				{/if}
			</p>
		</div>
		<button
			class={['icon-btn', { spin: app.changesLoading || app.gitBusy }]}
			title="Refresh"
			aria-label="Refresh changes"
			onclick={() => {
				void app.refreshChanges();
				void app.refreshStashes();
			}}
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

	{#if stashing}
		<form
			class="bar"
			onsubmit={(e) => {
				e.preventDefault();
				void stash();
			}}
		>
			<label for="stash-message">Stash {count(stashing)} as</label>
			<input
				id="stash-message"
				bind:value={stashMessage}
				placeholder={names(stashing)}
				autocomplete="off"
				{@attach focusOnMount}
				onkeydown={(e) => {
					if (e.key === 'Escape') {
						e.stopPropagation();
						stashing = null;
					}
				}}
			/>
			<div class="bar-acts">
				<button class="btn" type="button" onclick={() => (stashing = null)}>Cancel</button>
				<button class="btn primary" type="submit" disabled={app.gitBusy}>Stash</button>
			</div>
		</form>
	{:else if notice}
		<div
			class={['bar notice', { error: notice.kind === 'error' }]}
			role={notice.kind === 'error' ? 'alert' : 'status'}
			transition:fade={{ duration: 120 }}
		>
			<p>{notice.text}</p>
			<button class="icon-btn" aria-label="Dismiss" onclick={() => (notice = null)}>
				<Icon name="close" size={14} />
			</button>
		</div>
	{/if}

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
	{:else if !rows.length && !app.stashes.length}
		<div class="cbody single">
			<p class="explain muted">
				No note differs from the last commit. Edits show up here until the next push or pull.
			</p>
		</div>
	{:else}
		<div class="cbody">
			<div class="side">
				{#if rows.length}
					<div class="side-head">
						<h2>Changed</h2>
						{#if canStash}
							<button
								class="mini"
								disabled={app.gitBusy}
								onclick={() => startStash(rows.map((r) => r.path))}>Stash all</button
							>
						{/if}
						{#if canRevert}
							<button
								class="mini danger"
								disabled={app.gitBusy}
								onclick={() => revert(rows.map((r) => r.path))}>Revert all</button
							>
						{/if}
					</div>
					<ul class="files" aria-label="Changed notes">
						{#each rows as r (r.path)}
							{@const p = split(r.path)}
							<li>
								<button
									class={['file', { on: !selectedStash && r.path === selected }]}
									onclick={() => pick(r.path)}
								>
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
				{/if}
				{#if app.stashes.length}
					<div class="side-head">
						<h2>Stashes</h2>
					</div>
					<ul class="files" aria-label="Stashes">
						{#each app.stashes as s (stashKey(s))}
							<li>
								<button
									class={['file', { on: stashKey(s) === selectedStash }]}
									onclick={() => pickStash(s)}
								>
									<span class="badge stash" title="stash"><Icon name="history" size={13} /></span>
									<span class="fname">
										<span class="name">{s.message}</span>
										<span class="dir"
											>{when(s.date)} · {plural(s.files.length)}{s.repo
												? ` · ${s.repo}/`
												: ''}</span
										>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<section class="detail" aria-label="Diff">
				{#if currentStash}
					{#key selectedStash}
						<div class="detail-head" in:fade={{ duration: 120 }}>
							{#if app.layout === 'phone'}
								<button
									class="icon-btn"
									aria-label="All changes"
									onclick={() => (diffOpen = false)}
								>
									<Icon name="back" size={17} />
								</button>
							{/if}
							<div class="dtitle">
								<strong>{currentStash.message}</strong>
								<span
									>Stashed {when(currentStash.date)}{currentStash.repo
										? ` · ${currentStash.repo}/`
										: ''}</span
								>
							</div>
							<div class="acts">
								<button class="btn danger" disabled={app.gitBusy} onclick={() => drop(currentStash)}
									>Drop</button
								>
								<button
									class="btn"
									title="Apply the changes and keep the stash"
									disabled={app.gitBusy}
									onclick={() => apply(currentStash, false)}>Apply</button
								>
								<button
									class="btn primary"
									title="Apply the changes and remove the stash"
									disabled={app.gitBusy}
									onclick={() => apply(currentStash, true)}>Restore</button
								>
							</div>
						</div>
						<div class="diff-scroll" in:fade={{ duration: 120 }}>
							{#each stashRows as f (f.path)}
								{@const p = split(f.path)}
								<h3 class="fhead">
									<span class="badge {f.status}" title={f.status}>{STATUS[f.status]}</span>
									<span class="fname">
										<span class="name">{p.name}</span>
										{#if p.dir}<span class="dir">{p.dir}</span>{/if}
									</span>
									<span class="counts">
										{#if f.added}<span class="add">+{f.added}</span>{/if}
										{#if f.removed}<span class="del">−{f.removed}</span>{/if}
									</span>
								</h3>
								{#if f.sealed}
									<p class="muted">Encrypted. Unlock your notes to see what changed.</p>
								{:else}
									<DiffView lines={f.lines} />
								{/if}
							{:else}
								<p class="muted">
									No notes in this stash — it holds other files only (a <code>git stash</code> made elsewhere).
								</p>
							{/each}
						</div>
					{/key}
				{:else if current}
					{#key current.path}
						<div class="detail-head" in:fade={{ duration: 120 }}>
							{#if app.layout === 'phone'}
								<button
									class="icon-btn"
									aria-label="All changes"
									onclick={() => (diffOpen = false)}
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
							<div class="acts">
								{#if canRevert}
									<button
										class="btn danger"
										disabled={app.gitBusy}
										onclick={() => revert([current.path])}>Revert</button
									>
								{/if}
								{#if canStash}
									<button
										class="btn"
										disabled={app.gitBusy}
										onclick={() => startStash([current.path])}>Stash</button
									>
								{/if}
								{#if exists(current.path)}
									<button class="btn" onclick={() => app.openNote(current.path)}>Open note</button>
								{/if}
							</div>
						</div>
						<div class="diff-scroll" in:fade={{ duration: 120 }}>
							{#if current.sealed}
								<p class="muted">Encrypted. Unlock your notes to see what changed.</p>
							{:else}
								<DiffView lines={current.lines} />
							{/if}
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
	.phone.show-diff .side {
		display: none;
	}
	.side {
		min-height: 0;
		overflow-y: auto;
		padding: 4px 8px 12px;
		box-shadow: inset -1px 0 0 var(--bg-hover);
	}
	.phone .side {
		box-shadow: none;
	}
	.side-head {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 10px 4px 4px 10px;
	}
	.side-head h2 {
		flex: 1;
		margin: 0;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.mini {
		min-height: 26px;
		padding: 0 9px;
		border-radius: 7px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}
	:global(html[data-touch]) .mini {
		min-height: 44px;
		padding: 0 12px;
	}
	.mini:hover,
	.mini:active {
		background: var(--bg-hover);
		color: var(--text);
	}
	.mini.danger:hover,
	.mini.danger:active {
		color: var(--danger);
	}
	.mini:disabled,
	.btn:disabled {
		opacity: 0.5;
		pointer-events: none;
	}
	.files {
		margin: 0;
		padding: 0;
		list-style: none;
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
	.badge.stash {
		background: var(--bg-active);
		color: var(--text-muted);
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
	.acts {
		flex: 0 0 auto;
		display: flex;
		gap: 8px;
	}
	/* Phone: title on one line, the actions under it. */
	.phone .detail-head {
		flex-wrap: wrap;
	}
	.phone .detail-head .acts {
		flex: 1 0 100%;
		justify-content: flex-end;
	}
	.fhead {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 18px 0 8px;
	}
	.fhead:first-child {
		margin-top: 4px;
	}
	.bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 10px;
		padding: 10px 18px 10px 24px;
		background: var(--bg-list);
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	.notice {
		background: var(--accent-soft);
	}
	.notice.error {
		background: var(--danger-soft);
	}
	.phone .bar {
		padding: 10px 12px 10px 16px;
	}
	.bar label {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-strong);
	}
	.bar input {
		flex: 1 1 200px;
		min-width: 0;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 8px;
		border: 1px solid var(--bg-hover);
		background: var(--bg-editor);
		color: var(--text-main);
		font: inherit;
		font-size: 13.5px;
	}
	:global(html[data-touch]) .bar input {
		min-height: 44px;
	}
	.bar input:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}
	.bar-acts {
		display: flex;
		gap: 8px;
		margin-inline-start: auto;
	}
	.notice p {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.notice.error p {
		color: var(--danger);
	}
	.notice .icon-btn {
		width: 28px;
		height: 28px;
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
	.btn.primary {
		background: var(--accent);
		color: #fff;
	}
	.btn.primary:hover,
	.btn.primary:active {
		filter: brightness(1.08);
	}
	.btn.danger {
		color: var(--danger);
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
