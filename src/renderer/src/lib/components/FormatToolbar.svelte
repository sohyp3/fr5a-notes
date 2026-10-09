<script lang="ts" module>
	import type { IconName } from '../icons';

	/** An insert action (Settings → Toolbar): a button of the toolbar, or a row of its Insert menu. */
	export interface ToolAction {
		label: string;
		icon: IconName;
		/** `anchor`: the button pressed (Insert's when picked from its menu). */
		do(anchor: HTMLElement, fromMenu: boolean): void;
		/** Opens a popup; `on` while it's open. */
		popup?: boolean;
		on?: boolean;
	}
</script>

<script lang="ts">
	import type { Editor } from '@tiptap/core';
	import type { Command } from '@tiptap/pm/state';
	import { createSubscriber } from 'svelte/reactivity';
	import { on } from 'svelte/events';
	import { wrap } from '../editor/MarkdownShortcuts';
	import { lift, sink } from '../editor/ListBehavior';
	import { cycleHeading, insertTag, toggleBullet } from '../editor/formatCommands';
	import { getAppState } from '../stores/app.svelte';
	import type { FormatItem } from '../noteBar';
	import Icon from './Icon.svelte';
	import ActionMenu, { type MenuItem } from './ActionMenu.svelte';

	interface Props {
		editor: Editor;
		/**
		 * Insert actions with a button here, after Bold (the editor owns what
		 * they open: its pickers sit over the button, which closes them again).
		 */
		buttons: ToolAction[];
		/** The other insert actions, in the Insert (+) menu. */
		insert: ToolAction[];
	}

	let { editor, buttons, insert }: Props = $props();
	const app = getAppState();

	let insertBtn = $state<HTMLButtonElement | null>(null);
	let insertAt = $state<{ x: number; y: number } | null>(null);
	let moreBtn = $state<HTMLButtonElement | null>(null);
	let moreAt = $state<{ x: number; y: number } | null>(null);

	const viewport = window.visualViewport;
	const viewportMoved = createSubscriber((update) => {
		if (!viewport) return;
		const offResize = on(viewport, 'resize', update);
		const offScroll = on(viewport, 'scroll', update);
		return () => {
			offResize();
			offScroll();
		};
	});
	// Height the on-screen keyboard covers when the WebView doesn't resize for it
	// (overlay keyboards); 0 when the layout already shrank (adjustResize).
	const keyboard = $derived.by(() => {
		viewportMoved();
		if (!viewport) return 0;
		return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
	});

	function run(cmd: Command): void {
		cmd(editor.state, editor.view.dispatch);
		editor.view.focus();
	}

	/** Where a menu opens over `button`, or null when it's open (pressing it again closes it). */
	function menuAt(open: unknown, button: HTMLElement): { x: number; y: number } | null {
		if (open) return null;
		const r = button.getBoundingClientRect();
		// Opens upwards: ActionMenu flips a menu that would overflow the bottom.
		return { x: r.left, y: r.top - 6 };
	}

	const insertItems = $derived<MenuItem[]>(
		insert.map((a) => ({
			label: `${a.label}…`,
			icon: a.icon,
			action: () => a.do(insertBtn!, true)
		}))
	);

	interface Action {
		label: string;
		icon: IconName;
		do: (button: HTMLElement) => void;
		/** Opens a popup; `on` while it's open. */
		popup?: boolean;
		on?: boolean;
	}

	/** Formatting; Settings → Toolbar keeps each a button or moves it into ⋯. */
	const formats: (Action & { id: FormatItem })[] = [
		{ id: 'bold', label: 'Bold', icon: 'bold', do: () => run(wrap('**')) },
		{ id: 'heading', label: 'Heading', icon: 'heading', do: () => run(cycleHeading) },
		{ id: 'list', label: 'List', icon: 'bullet', do: () => run(toggleBullet) },
		{ id: 'outdent', label: 'Outdent', icon: 'outdent', do: () => run(lift) },
		{ id: 'indent', label: 'Indent', icon: 'indent', do: () => run(sink) },
		{ id: 'tag', label: 'Tag', icon: 'tag', do: () => run(insertTag) },
		{
			id: 'undo',
			label: 'Undo',
			icon: 'undo',
			do: () => {
				editor.commands.undo();
				editor.view.focus();
			}
		}
	];
	const shown = $derived(formats.filter((a) => app.barSpot(a.id) === 'bar'));

	/** The bar: Bold, then the insert buttons, then the rest of the formatting. */
	const actions = $derived<Action[]>([
		...shown.filter((a) => a.id === 'bold'),
		...buttons.map((b) => ({ ...b, do: (button: HTMLElement) => b.do(button, false) })),
		...shown.filter((a) => a.id !== 'bold')
	]);

	/** ⋯: the formatting moved out of the bar. */
	const moreItems = $derived<MenuItem[]>([
		...formats
			.filter((a) => app.barSpot(a.id) === 'menu')
			.map((a) => ({ label: a.label, icon: a.icon, action: () => a.do(moreBtn!) })),
		{
			label: 'Customize toolbar…',
			icon: 'toolbar',
			divider: true,
			action: () => app.openSettings('toolbar')
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
			class={['fmt', { on: a.on }]}
			aria-label={a.label}
			title={a.label}
			aria-haspopup={a.popup ? 'true' : undefined}
			aria-expanded={a.popup ? !!a.on : undefined}
			onpointerdown={(e) => e.preventDefault()}
			onclick={(e) => a.do(e.currentTarget)}
		>
			<Icon name={a.icon} size={20} stroke={2} />
		</button>
	{/each}
	{#if insert.length}
		<button
			bind:this={insertBtn}
			class={['fmt', { on: !!insertAt }]}
			aria-label="Insert"
			title="Insert"
			aria-haspopup="menu"
			aria-expanded={!!insertAt}
			onpointerdown={(e) => e.preventDefault()}
			onclick={() => (insertAt = menuAt(insertAt, insertBtn!))}
		>
			<Icon name="plus" size={20} stroke={2} />
		</button>
	{/if}
	{#if moreItems.length > 1}
		<button
			bind:this={moreBtn}
			class={['fmt', { on: !!moreAt }]}
			aria-label="More formatting"
			title="More formatting"
			aria-haspopup="menu"
			aria-expanded={!!moreAt}
			onpointerdown={(e) => e.preventDefault()}
			onclick={() => (moreAt = menuAt(moreAt, moreBtn!))}
		>
			<Icon name="more" size={20} stroke={2} />
		</button>
	{/if}
</div>

{#if insertAt}
	<ActionMenu
		items={insertItems}
		at={insertAt}
		sheet={app.layout === 'phone'}
		title="Insert"
		label="Insert"
		trigger={insertBtn}
		onclose={() => (insertAt = null)}
	/>
{/if}

{#if moreAt}
	<ActionMenu
		items={moreItems}
		at={moreAt}
		sheet={app.layout === 'phone'}
		title="Formatting"
		label="More formatting"
		trigger={moreBtn}
		onclose={() => (moreAt = null)}
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
