<script lang="ts">
	import type { Editor } from '@tiptap/core';
	import type { Command } from '@tiptap/pm/state';
	import { onMount } from 'svelte';
	import { wrap } from '../editor/MarkdownShortcuts';
	import { lift, sink } from '../editor/ListBehavior';
	import { cycleHeading, insertTag, toggleBullet } from '../editor/formatCommands';
	import { toggleHighlight } from '../editor/HighlightBehavior';
	import { getAppState } from '../stores/app.svelte';
	import type { IconName } from '../icons';
	import Icon from './Icon.svelte';
	import ActionMenu, { type MenuItem } from './ActionMenu.svelte';

	interface Props {
		editor: Editor;
		/** Insert menu (image, table): the editor owns what they open. */
		insert: MenuItem[];
	}

	let { editor, insert }: Props = $props();
	const app = getAppState();

	let insertBtn = $state<HTMLButtonElement | null>(null);
	let insertAt = $state<{ x: number; y: number } | null>(null);

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

	function openInsert(): void {
		if (insertAt) {
			insertAt = null;
			return;
		}
		const r = insertBtn!.getBoundingClientRect();
		// Opens upwards: ActionMenu flips a menu that would overflow the bottom.
		insertAt = { x: r.left, y: r.top - 6 };
	}

	const actions = $derived<{ label: string; icon: IconName; do: () => void }[]>([
		{ label: 'Bold', icon: 'bold', do: () => run(wrap('**')) },
		...(app.settings.highlights
			? [{ label: 'Highlight', icon: 'highlight' as const, do: () => run(toggleHighlight) }]
			: []),
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
	]);
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
	{#if insert.length}
		<button
			bind:this={insertBtn}
			class="fmt"
			class:on={!!insertAt}
			aria-label="Insert"
			title="Insert image or table"
			aria-haspopup="menu"
			aria-expanded={!!insertAt}
			onpointerdown={(e) => e.preventDefault()}
			onclick={openInsert}
		>
			<Icon name="plus" size={20} stroke={2} />
		</button>
	{/if}
</div>

{#if insertAt}
	<ActionMenu
		items={insert}
		at={insertAt}
		sheet={app.layout === 'phone'}
		title="Insert"
		label="Insert"
		trigger={insertBtn}
		onclose={() => (insertAt = null)}
	/>
{/if}

<style>
	.format-toolbar {
		flex: 0 0 auto;
		display: flex;
		justify-content: space-around;
		gap: 2px;
		padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
		/* Narrow phones: scroll rather than squeeze below a finger's width. */
		overflow-x: auto;
		scrollbar-width: none;
		background: var(--bg-secondary);
		box-shadow: 0 -1px 0 var(--bg-hover);
		position: relative;
		z-index: 5;
	}
	.format-toolbar::-webkit-scrollbar {
		display: none;
	}
	.fmt {
		flex: 1 0 auto;
		min-width: 36px;
		max-width: 64px;
		height: 40px;
		border-radius: 10px;
		color: var(--text-main);
		display: grid;
		place-items: center;
		touch-action: manipulation;
	}
	.fmt:active,
	.fmt.on {
		background: var(--bg-hover);
	}
</style>
