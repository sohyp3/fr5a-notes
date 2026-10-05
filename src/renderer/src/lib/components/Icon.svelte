<script lang="ts">
	import { ICONS, type IconName } from '../icons';

	let {
		name,
		size = 16,
		stroke = 1.8
	}: { name: IconName; size?: number; stroke?: number } = $props();

	const Glyph = $derived(ICONS[name]);
</script>

<Glyph {size} strokeWidth={stroke} class="icon" aria-hidden="true" />

<style>
	/* Lucide renders the <svg>, so the class is styled globally. */
	:global(svg.icon) {
		flex: 0 0 auto;
		display: block;
	}
</style>
