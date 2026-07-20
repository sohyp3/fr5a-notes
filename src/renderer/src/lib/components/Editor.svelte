<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { Editor } from '@tiptap/core';
	import Document from '@tiptap/extension-document';
	import Paragraph from '@tiptap/extension-paragraph';
	import Text from '@tiptap/extension-text';
	import { UndoRedo } from '@tiptap/extensions';
	import Placeholder from '@tiptap/extension-placeholder';
	import { getAppState } from '../stores/app.svelte';
	import { MarkdownSyntax } from '../editor/MarkdownSyntax';
	import { MarkdownShortcuts } from '../editor/MarkdownShortcuts';
	import { ListBehavior } from '../editor/ListBehavior';
	import { Vim, type VimMode } from '../editor/vim';
	import {
		textToDoc,
		docToText,
		detectDir,
		setDir,
		detectLocked,
		type Direction
	} from '../editor/markdown';
	import EmptyState from './EmptyState.svelte';
	import logo from '$lib/assets/logo.png';
	import mascotNew from '$lib/assets/fr5a-new.png';

	const app = getAppState();

	let editor: Editor | undefined = $state();
	let dir = $state<Direction>('ltr');
	let vimMode = $state<VimMode>('normal');
	// Suppress auto-save while we programmatically replace content.
	let loading = false;

	const activeMeta = $derived(app.notes.find((n) => n.id === app.activeId));
	// Locked notes are read-only. Fall back to the buffer so the badge is right
	// even before the index round-trips.
	const locked = $derived(activeMeta?.locked ?? detectLocked(app.activeContent));
	// Recreate the editor when the note changes, Vim is toggled, or an external
	// rewrite (e.g. pin toggle) bumps the reload token.
	const editorKey = $derived(`${app.activeId ?? ''}:${app.settings.vim}:${app.editorReloadToken}`);

	function buildEditor(node: HTMLElement, content: string): Editor {
		const extensions = [
			Document,
			Paragraph,
			Text,
			UndoRedo,
			Placeholder.configure({ placeholder: 'Start writing…' }),
			MarkdownSyntax,
			MarkdownShortcuts,
			ListBehavior
		];
		if (app.settings.vim) {
			extensions.push(Vim.configure({ onModeChange: (m) => (vimMode = m) }));
		}
		return new Editor({
			element: node,
			extensions,
			content: textToDoc(content),
			// A locked note mounts read-only; it re-mounts (via editorReloadToken)
			// when unlocked, so this is re-evaluated each time.
			editable: !detectLocked(content),
			autofocus: detectLocked(content) ? false : 'end',
			onUpdate: ({ editor }) => {
				if (loading) return;
				app.queueSave(docToText(editor));
			}
		});
	}

	/** Svelte action: owns one TipTap instance for the lifetime of the node. */
	function mount(node: HTMLElement, content: string) {
		dir = detectDir(content) ?? 'ltr';
		vimMode = 'normal';
		const ed = buildEditor(node, content);
		editor = ed;
		return {
			destroy() {
				app.flush();
				ed.destroy();
				// Only clear the shared ref if it still points at *this* instance —
				// during a keyed swap the next editor may already have claimed it.
				if (editor === ed) editor = undefined;
			}
		};
	}

	function toggleDir(): void {
		if (!editor) return;
		const next: Direction = dir === 'rtl' ? 'ltr' : 'rtl';
		const text = setDir(docToText(editor), next);
		loading = true;
		editor.commands.setContent(textToDoc(text), { emitUpdate: false });
		loading = false;
		dir = next;
		app.queueSave(text);
	}
</script>

<section class="editor-pane" class:is-rtl={dir === 'rtl'}>
	{#if !app.workspace}
		<div class="placeholder-screen" in:fade={{ duration: 150 }}>
			<EmptyState
				src={logo}
				alt="fr5a"
				title="Welcome"
				body="Choose a folder of Markdown files to begin. Your files stay yours — on disk, in plain text."
			>
				{#snippet action()}
					<button class="cta" onclick={() => app.pickWorkspace()}>Choose folder…</button>
				{/snippet}
			</EmptyState>
		</div>
	{:else if !app.activeId}
		<div class="placeholder-screen" in:fade={{ duration: 150 }}>
			<EmptyState
				src={mascotNew}
				title="Nothing open"
				body="Pick a note from the list, or start a fresh one."
			>
				{#snippet action()}
					<button class="cta" onclick={() => app.createNote()}>New note</button>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div class="editor-actions">
			<button
				class="act pin"
				class:on={activeMeta?.pinned}
				title={activeMeta?.pinned ? 'Unpin note' : 'Pin note'}
				aria-label="Toggle pin"
				onclick={() => app.activeId && app.togglePin(app.activeId)}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
					<path
						d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z M12 15v5"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
			<button
				class="act dir"
				title="Text direction (LTR / RTL)"
				aria-label="Toggle text direction"
				disabled={locked}
				onclick={toggleDir}
			>
				{dir === 'rtl' ? 'RTL' : 'LTR'}
			</button>
			<button
				class="act lock"
				class:on={locked}
				title={locked ? 'Unlock note' : 'Lock note'}
				aria-label="Toggle lock"
				onclick={() => app.activeId && app.toggleLock(app.activeId)}
			>
				{#if locked}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
						<rect
							x="5"
							y="11"
							width="14"
							height="9"
							rx="2"
							stroke="currentColor"
							stroke-width="1.7"
						/>
						<path
							d="M8 11V8a4 4 0 0 1 7-2.6"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
						/>
					</svg>
				{:else}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
						<rect
							x="5"
							y="11"
							width="14"
							height="9"
							rx="2"
							stroke="currentColor"
							stroke-width="1.7"
						/>
						<path
							d="M8 11V8a4 4 0 0 1 8 0v3"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
						/>
					</svg>
				{/if}
			</button>
			{#if activeMeta && !locked}
				<button
					class="act del"
					title="Delete note"
					aria-label="Delete note"
					onclick={() => app.deleteActive()}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
						<path
							d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
			{/if}
		</div>

		{#key editorKey}
			<div class="scroll" in:fly={{ y: 12, duration: 190 }}>
				<div class="mount" style="direction:{dir}" use:mount={app.activeContent}></div>
			</div>
		{/key}

		{#if app.settings.vim}
			<div
				class="vim-badge"
				class:insert={vimMode === 'insert'}
				class:visual={vimMode === 'visual'}
			>
				{vimMode.toUpperCase()}
			</div>
		{/if}
	{/if}
</section>

<style>
	.editor-pane {
		flex: 1;
		min-width: 0;
		height: 100%;
		position: relative;
		background: var(--bg-editor);
		border-radius: 12px;
		box-shadow: var(--shadow-pane);
		overflow: hidden;
	}
	.scroll {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		padding: 24px 40px 0;
	}
	.editor-actions {
		position: absolute;
		top: 12px;
		right: 16px;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.editor-pane.is-rtl .editor-actions {
		right: auto;
		left: 16px;
	}
	.act {
		display: grid;
		place-items: center;
		height: 30px;
		border-radius: 8px;
		color: var(--text-faint);
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.act.del,
	.act.pin,
	.act.lock {
		width: 30px;
	}
	.act.pin.on {
		color: #e0a520;
	}
	.act.lock.on {
		color: var(--accent);
	}
	.act:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.act:disabled:hover {
		background: none;
		color: var(--text-faint);
	}
	.act.dir {
		padding: 0 9px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.03em;
	}
	.act:hover {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.vim-badge {
		position: absolute;
		bottom: 12px;
		left: 16px;
		z-index: 5;
		padding: 3px 9px;
		border-radius: 6px;
		font-family: var(--font-mono);
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: #fff;
		background: var(--text-muted);
	}
	.vim-badge.insert {
		background: var(--accent);
	}
	.vim-badge.visual {
		background: #7c6ff0;
	}
	.placeholder-screen {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}
	.cta {
		margin-top: 14px;
		padding: 9px 18px;
		border-radius: 9px;
		background: var(--accent);
		color: #fff;
		font-size: 13.5px;
		font-weight: 600;
		transition: filter 120ms ease;
	}
	.cta:hover {
		filter: brightness(1.05);
	}
</style>
