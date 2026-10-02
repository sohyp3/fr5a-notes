<script lang="ts">
	import type { Snippet } from 'svelte';
	import { scale } from 'svelte/transition';
	import { reducedMotion } from '../portal';

	interface Props {
		/** Mascot / hero image source. */
		src: string;
		alt?: string;
		title: string;
		body?: string;
		/** Smaller mascot for tight spaces like the note list. */
		compact?: boolean;
		/** Even smaller (the AI pane's welcome). */
		small?: boolean;
		/** Optional call-to-action rendered below the text. */
		action?: Snippet;
	}

	let { src, alt = '', title, body, compact = false, small = false, action }: Props = $props();
	const dur = reducedMotion() ? 0 : 1;
</script>

<div class="empty-state" class:compact class:small>
	<img
		class="mascot"
		{src}
		{alt}
		draggable="false"
		in:scale={{ start: 0.92, opacity: 0, duration: 260 * dur }}
	/>
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
	.small .mascot {
		height: 76px;
		margin-bottom: 2px;
	}
	.small {
		padding: 8px;
	}
	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
		color: var(--text-strong);
	}
	.compact h2,
	.small h2 {
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
