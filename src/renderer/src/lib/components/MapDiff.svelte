<script lang="ts">
	import { diffMap } from '../maps/diff';
	import { compactDiff, diffLines } from '../harness/diff';
	import DiffView from './DiffView.svelte';
	let { before, after }: { before: string | null; after: string | null } = $props();
	const diff = $derived(diffMap(before, after));
	const raw = $derived(compactDiff(diffLines(before ?? '', after ?? ''), 3));
</script>

<div class="map-diff">
	{#if diff.error}
		<p class="explanation">{diff.error} Review the source changes below.</p>
		<DiffView lines={raw} />
	{:else}
		<p class="summary">
			{diff.nodes.length}
			{diff.nodes.length === 1 ? 'node' : 'nodes'} changed · {diff.edges.length}
			{diff.edges.length === 1 ? 'connection' : 'connections'} changed
		</p>
		{#each [{ title: 'Nodes', items: diff.nodes }, { title: 'Connections', items: diff.edges }] as group (group.title)}
			{#if group.items.length}
				<section aria-label={group.title}>
					<h2>{group.title}</h2>
					{#each group.items as edit (edit.id)}
						<details class="edit" open={edit.kind === 'changed'}>
							<summary
								><span class="kind {edit.kind}">{edit.kind}</span><strong>{edit.label}</strong
								></summary
							>
							<dl>
								{#each edit.fields as field, index (index)}
									<div class="field">
										<dt>{field.name}</dt>
										<dd>
											{#if edit.kind !== 'added'}<div class="before">
													<span class="side">Before</span>
													<pre>{field.before}</pre>
												</div>{/if}
											{#if edit.kind !== 'removed'}<div class="after">
													<span class="side">After</span>
													<pre>{field.after}</pre>
												</div>{/if}
										</dd>
									</div>
								{/each}
							</dl>
						</details>
					{/each}
				</section>
			{/if}
		{/each}
		{#if diff.other}<p class="explanation">
				Map metadata or drawing order also changed. Review the source for those details.
			</p>{/if}
		{#if !diff.nodes.length && !diff.edges.length && !diff.other}<p class="explanation">
				No node or connection changes. The source formatting may have changed.
			</p>{/if}
		<details class="source" open={diff.other}>
			<summary>Source changes</summary><DiffView lines={raw} />
		</details>
	{/if}
</div>

<style>
	.map-diff {
		color: var(--text);
		font-size: 13px;
		line-height: 1.5;
	}
	.summary {
		margin: 0 0 22px;
		color: var(--text-muted);
	}
	h2 {
		margin: 24px 0 8px;
		font-size: 15px;
		color: var(--text-strong);
	}
	.edit {
		border-top: 1px solid var(--bg-hover);
	}
	summary {
		cursor: pointer;
		padding: 12px 4px;
		overflow-wrap: anywhere;
	}
	summary:focus-visible {
		outline: 2px solid var(--focus-ring);
		outline-offset: -2px;
	}
	strong {
		font-weight: 600;
		white-space: pre-wrap;
	}
	.kind {
		display: inline-block;
		min-width: 65px;
		margin-inline-end: 10px;
		font-size: 12px;
		text-transform: capitalize;
	}
	.added {
		color: var(--add-fg);
	}
	.removed {
		color: var(--del-fg);
	}
	.changed {
		color: var(--text-muted);
	}
	dl {
		margin: 0 4px 18px;
	}
	.field {
		padding: 7px 0;
	}
	dt {
		font-weight: 600;
		margin-bottom: 5px;
	}
	dd {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
		gap: 8px;
	}
	.before,
	.after {
		min-width: 0;
		padding: 8px 10px;
		background: var(--bg-list);
		border-radius: 6px;
	}
	.side {
		font-size: 11px;
		color: var(--text-muted);
	}
	pre {
		margin: 3px 0 0;
		font: inherit;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.source {
		margin-top: 24px;
	}
	.source > summary {
		font-weight: 600;
	}
	.explanation {
		color: var(--text-muted);
	}
</style>
