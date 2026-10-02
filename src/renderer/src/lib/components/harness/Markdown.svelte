<script lang="ts">
	import { renderReply } from '../../harness/render';

	let { text }: { text: string } = $props();

	// render.ts escapes every character of the source and emits only its own
	// tags, so the reply's own HTML can never reach the DOM.
	const html = $derived(renderReply(text));

	/** Copy buttons on code blocks (event delegation over the rendered HTML). */
	async function onclick(e: MouseEvent): Promise<void> {
		const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.md-copy');
		if (!btn) return;
		const code = btn.closest('.md-code')?.querySelector('pre')?.textContent ?? '';
		try {
			await navigator.clipboard.writeText(code);
			btn.textContent = 'Copied';
		} catch {
			btn.textContent = 'Failed';
		}
		setTimeout(() => (btn.textContent = 'Copy'), 1400);
	}
</script>

<!-- Clicks only reach the code blocks' own <button>s; this is just delegation. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" dir="auto" {onclick}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- escaped + tag-whitelisted by render.ts -->
	{@html html}
</div>

<style>
	.md {
		font-family: var(--font-editor);
		font-size: 14px;
		line-height: 1.6;
		color: var(--text);
		overflow-wrap: anywhere;
		user-select: text;
	}
	:global(html[data-touch]) .md {
		font-size: 15.5px;
	}
	.md > :global(:first-child) {
		margin-top: 0;
	}
	.md > :global(:last-child) {
		margin-bottom: 0;
	}
	.md :global(p) {
		margin: 0 0 0.7em;
	}
	.md :global(h1),
	.md :global(h2),
	.md :global(h3),
	.md :global(h4),
	.md :global(h5),
	.md :global(h6) {
		margin: 1em 0 0.4em;
		line-height: 1.3;
		color: var(--text-strong);
	}
	.md :global(h1) {
		font-size: 1.35em;
	}
	.md :global(h2) {
		font-size: 1.2em;
	}
	.md :global(h3) {
		font-size: 1.08em;
	}
	.md :global(h4),
	.md :global(h5),
	.md :global(h6) {
		font-size: 1em;
	}
	.md :global(strong) {
		color: var(--text-strong);
	}
	.md :global(del) {
		color: var(--text-muted);
	}
	.md :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-decoration-color: var(--accent-soft);
		text-underline-offset: 2px;
	}
	.md :global(code) {
		font-family: var(--font-mono);
		font-size: 0.86em;
		padding: 0.1em 0.35em;
		border-radius: 4px;
		background: var(--code-bg);
	}
	.md :global(ul),
	.md :global(ol) {
		margin: 0 0 0.7em;
		padding-inline-start: 1.4em;
	}
	.md :global(li) {
		margin: 0.15em 0;
	}
	.md :global(li > ul),
	.md :global(li > ol) {
		margin: 0.15em 0 0;
	}
	.md :global(li::marker) {
		color: var(--accent);
	}
	.md :global(li.task) {
		list-style: none;
		margin-inline-start: -1.2em;
	}
	.md :global(li.task input) {
		accent-color: var(--accent);
		margin: 0 0.3em 0 0;
	}
	.md :global(blockquote) {
		margin: 0 0 0.7em;
		padding: 0.1em 0 0.1em 0.9em;
		box-shadow: inset 3px 0 0 var(--text-faint);
		color: var(--text-muted);
	}
	.md :global(hr) {
		border: none;
		height: 1px;
		margin: 1em 0;
		background: var(--bg-active);
	}
	.md :global(.md-code) {
		margin: 0 0 0.8em;
		border-radius: 9px;
		background: var(--code-bg);
		overflow: hidden;
	}
	.md :global(.md-code-head) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 3px 4px 3px 10px;
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--text-faint);
		box-shadow: inset 0 -1px 0 var(--bg-hover);
	}
	.md :global(.md-copy) {
		padding: 2px 8px;
		border-radius: 5px;
		font-family: var(--font-ui);
		font-size: 11px;
		color: var(--text-muted);
	}
	:global(html[data-touch]) .md :global(.md-copy) {
		padding: 8px 12px;
	}
	.md :global(.md-copy:hover) {
		background: var(--bg-hover);
		color: var(--text);
	}
	.md :global(pre) {
		margin: 0;
		padding: 9px 11px;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
	}
	.md :global(pre code) {
		padding: 0;
		background: none;
		font-size: inherit;
	}
	.md :global(.md-table) {
		margin: 0 0 0.8em;
		overflow-x: auto;
	}
	.md :global(table) {
		border-collapse: collapse;
		font-size: 0.93em;
	}
	.md :global(th),
	.md :global(td) {
		padding: 5px 10px;
		box-shadow: inset 0 -1px 0 var(--bg-active);
		text-align: start;
	}
	.md :global(th) {
		color: var(--text-strong);
		font-weight: 600;
	}
	.md :global(.j-key) {
		color: var(--accent);
	}
	.md :global(.j-str) {
		color: var(--add-fg);
	}
	.md :global(.j-num),
	.md :global(.j-lit) {
		color: #7c6ff0;
	}
</style>
