<script lang="ts">
	import {
		BaseEdge,
		EdgeLabel,
		Position,
		getBezierPath,
		useInternalNode,
		type EdgeProps,
		type InternalNode
	} from '@xyflow/svelte';
	import { getMapApi } from '../../maps/context';

	let {
		id,
		source,
		target,
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		sourceHandleId,
		targetHandleId,
		label,
		selected,
		markerStart,
		markerEnd
	}: EdgeProps = $props();

	const map = getMapApi();
	// An edge's ends never change here (no reconnecting), so the first ids are the ids.
	// svelte-ignore state_referenced_locally
	const from = useInternalNode(source);
	// svelte-ignore state_referenced_locally
	const to = useInternalNode(target);

	/** Middle of the side of `node` that faces `toward`, and that side. */
	function facing(node: InternalNode, toward: { x: number; y: number }) {
		const w = node.measured.width ?? 0;
		const h = node.measured.height ?? 0;
		const { x, y } = node.internals.positionAbsolute;
		const cx = x + w / 2;
		const cy = y + h / 2;
		const dx = toward.x - cx;
		const dy = toward.y - cy;
		if (Math.abs(dx) * h > Math.abs(dy) * w)
			return dx > 0 ? { x: x + w, y: cy, side: Position.Right } : { x, y: cy, side: Position.Left };
		return dy > 0 ? { x: cx, y: y + h, side: Position.Bottom } : { x: cx, y, side: Position.Top };
	}

	const centre = (n: InternalNode) => ({
		x: n.internals.positionAbsolute.x + (n.measured.width ?? 0) / 2,
		y: n.internals.positionAbsolute.y + (n.measured.height ?? 0) / 2
	});

	// Ends without a stored side float: each one leaves from the side facing the other node.
	const path = $derived.by(() => {
		const a = from.current;
		const b = to.current;
		let s = { x: sourceX, y: sourceY, side: sourcePosition };
		let t = { x: targetX, y: targetY, side: targetPosition };
		if (a && b) {
			if (!sourceHandleId) s = facing(a, targetHandleId ? t : centre(b));
			if (!targetHandleId) t = facing(b, sourceHandleId ? s : centre(a));
		}
		return getBezierPath({
			sourceX: s.x,
			sourceY: s.y,
			sourcePosition: s.side,
			targetX: t.x,
			targetY: t.y,
			targetPosition: t.side
		});
	});
</script>

<BaseEdge
	{id}
	path={path[0]}
	{markerStart}
	{markerEnd}
	class={['map-edge', { selected }]}
	interactionWidth={map.touch ? 28 : 18}
	ondblclick={() => map.editLabel(id)}
/>
{#if label}
	<EdgeLabel x={path[1]} y={path[2]} selectEdgeOnClick class="map-edge-label">
		<span role="presentation" ondblclick={() => map.editLabel(id)}>{label}</span>
	</EdgeLabel>
{/if}
