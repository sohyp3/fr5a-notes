<script lang="ts">
	import type { Editor } from '@tiptap/core';
	import type { Command } from '@tiptap/pm/state';
	import { onMount } from 'svelte';
	import { wrap } from '../editor/MarkdownShortcuts';
	import { lift, sink } from '../editor/ListBehavior';
	import { cycleHeading, insertTag, toggleBullet } from '../editor/formatCommands';
	import type { IconName } from '../icons';
	import Icon from './Icon.svelte';

	let { editor }: { editor: Editor } = $props();

	// Height the on-screen keyboard covers when the WebView doesn't resize for it
	// (overlay keyboards); 0 when the layout already shrank (adjustResize).
	let keyboard = $state(0);

	onMount(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const update = () => {
			keyboard = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
		};
		update();
		vv.addEventListener('resize', update);
		vv.addEventListener('scroll', update);
		return () => {
			vv.removeEventListener('resize', update);
			vv.removeEventListener('scroll', update);
		};
	});

	function run(cmd: Command): void {
		cmd(editor.state, editor.view.dispatch);
		editor.view.focus();
	}

	const actions: { label: string; icon: IconName; do: () => void }[] = [
		{ label: 'Bold', icon: 'bold', do: () => run(wrap('**')) },
		{ label: 'Heading', icon: 'heading', do: () => run(cycleHeading) },
		{ label: 'List', icon: 'bullet', do: () => run(toggleBullet) },
		{ label: 'Outdent', icon: 'outdent', do: () => run(lift) },
		{ label: 'Indent', icon: 'indent', do: () => run(sink) },
		{ label: 'Tag', icon: 'tag', do: () => run(insertTag) },
		{
			label: 'Undo',
			icon: 'undo',
			do: () => {
				editor.commands.undo();
				editor.view.focus();
			}
		}
	];
</script>

<div
	class="format-toolbar"
	role="toolbar"
	aria-label="Formatting"
	style:transform={keyboard ? `translateY(-${keyboard}px)` : undefined}
>
	{#each actions as a (a.label)}
		<!-- pointerdown + preventDefault keeps focus (and the keyboard) in the editor. -->
		<button
			class="fmt"
			aria-label={a.label}
			title={a.label}
			onpointerdown={(e) => e.preventDefault()}
			onclick={a.do}
		>
			<Icon name={a.icon} size={20} stroke={2} />
		</button>
	{/each}
</div>

<style>
	.format-toolbar {
		flex: 0 0 auto;
		display: flex;
		justify-content: space-around;
		gap: 4px;
		padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
		background: var(--bg-secondary);
		box-shadow: 0 -1px 0 var(--bg-hover);
		position: relative;
		z-index: 5;
	}
	.fmt {
		flex: 1;
		min-width: 40px;
		max-width: 64px;
		height: 40px;
		border-radius: 10px;
		color: var(--text-main);
		display: grid;
		place-items: center;
		touch-action: manipulation;
	}
	.fmt:active {
		background: var(--bg-hover);
	}
</style>
