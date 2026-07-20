<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Mascot / hero image source. */
		src: string;
		alt?: string;
		title: string;
		body?: string;
		/** Smaller mascot for tight spaces like the note list. */
		compact?: boolean;
		/** Optional call-to-action rendered below the text. */
		action?: Snippet;
	}

	let { src, alt = '', title, body, compact = false, action }: Props = $props();
</script>

<div class="empty-state" class:compact>
	<img class="mascot" {src} {alt} draggable="false" />
	<h2>{title}</h2>
	{#if body}<p>{body}</p>{/if}
	{#if action}{@render action()}{/if}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 6px;
		padding: 24px;
	}
	.mascot {
		height: 148px;
		width: auto;
		object-fit: contain;
		margin-bottom: 10px;
		user-select: none;
		-webkit-user-drag: none;
	}
	.compact .mascot {
		height: 104px;
		margin-bottom: 6px;
	}
	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
		color: var(--text-strong);
	}
	.compact h2 {
		font-size: 15px;
	}
	p {
		margin: 0;
		max-width: 340px;
		font-size: 13.5px;
		line-height: 1.6;
		color: var(--text-muted);
	}
	.compact p {
		font-size: 12.5px;
		color: var(--text-faint);
	}
</style>
