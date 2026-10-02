<script lang="ts">
	import { ICONS, type IconName } from '../icons';

	let {
		name,
		size = 16,
		stroke = 1.8
	}: { name: IconName; size?: number; stroke?: number } = $props();
</script>

<svg
	class="icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	aria-hidden="true"
	stroke="currentColor"
	stroke-width={name === 'more' ? 3.2 : stroke}
	stroke-linecap="round"
	stroke-linejoin="round"><path d={ICONS[name]} /></svg
>

<style>
	.icon {
		flex: 0 0 auto;
		display: block;
	}
</style>
