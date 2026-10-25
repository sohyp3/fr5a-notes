<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { baseOf, noteStem, parentOf } from '../../../../../shared/paths';
	import { nodeColors, type CanvasNode } from '../../maps/canvas';
	import { getMapApi } from '../../maps/context';
	import { getAppState } from '../../stores/app.svelte';
	import Icon from '../Icon.svelte';
	import NodeHandles from './NodeHandles.svelte';

	let { id, data, selected }: NodeProps & { data: { raw: CanvasNode } } = $props();
	const app = getAppState();
	const map = getMapApi();
	const colors = $derived(nodeColors(data.raw.color, map.theme));
	// Live from the index: titles of encrypted notes are never stored in the map.
	const note = $derived(map.noteFor(data.raw.file));
	const title = $derived(note?.title ?? (noteStem(baseOf(data.raw.file ?? '')) || 'Note'));
	const folder = $derived(note ? parentOf(note.id) : parentOf(data.raw.file ?? ''));
	const hidden = $derived(!!note && app.hiddenFromAi(note));
	const untagged = $derived(map.untagged(id));

	function click(e: MouseEvent): void {
		if (e.metaKey || e.ctrlKey) {
			e.stopPropagation();
			map.openNote(id);
		}
	}
</script>

<!-- Mod+click / double-click open the note; keyboard: the selection bar's Open. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
	class={['map-node note', { selected, missing: !note }]}
	style:border-color={colors?.border}
	style:background={colors?.fill}
	role="group"
	aria-label={`${title}, ${note ? 'note' : 'missing note'}`}
	onclick={click}
	ondblclick={() => note && map.openNote(id)}
	{@attach map.press(id)}
>
	<span class="head">
		<Icon name="note" size={14} />
		<span class="title" dir="auto">{title}</span>
		{#if note?.locked}<span class="state" title="Locked" aria-label="Locked"
				><Icon name="lock" size={12} stroke={2} /></span
			>{/if}
		{#if note?.encrypted}<span class="state" title="Encrypted" aria-label="Encrypted"
				><Icon name="key" size={12} stroke={2} /></span
			>{/if}
		{#if hidden}<span class="state" title="Hidden from cloud AI" aria-label="Hidden from cloud AI"
				><Icon name="shield" size={12} stroke={2} /></span
			>{/if}
	</span>
	<span class="meta">
		<span class="chip" dir="auto">{folder || 'Notes'}</span>
		{#if !note}
			<span class="badge">Missing</span>
			<button class="mini nodrag" onclick={() => map.relink(id)}>Relink…</button>
		{:else if untagged}
			<span class="badge muted" title={`No longer tagged #${untagged.fr5a?.tag}`}>untagged</span>
			<button class="mini nodrag" onclick={() => map.remove([id])}>Remove</button>
		{/if}
	</span>
	<NodeHandles />
</div>
