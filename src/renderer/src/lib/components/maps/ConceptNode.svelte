<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { nodeColors, type CanvasNode } from '../../maps/canvas';
	import { getMapApi } from '../../maps/context';
	import NodeHandles from './NodeHandles.svelte';

	let { id, data, selected }: NodeProps & { data: { raw: CanvasNode } } = $props();
	const map = getMapApi();
	const editing = $derived(map.editingId === id);
	const colors = $derived(nodeColors(data.raw.color, map.theme));
	const text = $derived(data.raw.type === 'text' ? (data.raw.text ?? '') : '');

	/**
	 * Attachment: focus the field with its text selected. A new node is hidden
	 * until Svelte Flow has measured it, so this retries for a few frames.
	 */
	function focus(el: HTMLTextAreaElement): () => void {
		let tries = 0;
		let f = 0;
		const go = () => {
			el.focus();
			if (document.activeElement === el) el.select();
			else if (tries++ < 20) f = requestAnimationFrame(go);
		};
		f = requestAnimationFrame(go);
		return () => cancelAnimationFrame(f);
	}

	function key(e: KeyboardEvent): void {
		const el = e.currentTarget as HTMLTextAreaElement;
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			map.commitText(id, el.value);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			map.cancelEdit();
		}
		e.stopPropagation();
	}
</script>

<div
	class={['map-node concept', { selected, colored: !!colors }]}
	style:border-color={colors?.border}
	style:background={colors?.fill}
	role="group"
	aria-label={`${text || 'Empty idea'}, idea`}
	ondblclick={() => map.edit(id)}
	{@attach map.press(id)}
>
	{#if editing}
		<textarea
			class="nodrag nopan nowheel"
			{@attach focus}
			value={text}
			rows={Math.min(8, Math.max(1, text.split('\n').length))}
			aria-label="Idea text"
			dir="auto"
			onkeydown={key}
			onblur={(e) => map.commitText(id, e.currentTarget.value)}></textarea>
	{:else}
		<span class={['text', { empty: !text }]} dir="auto">{text || 'Empty idea'}</span>
	{/if}
	<NodeHandles />
</div>
