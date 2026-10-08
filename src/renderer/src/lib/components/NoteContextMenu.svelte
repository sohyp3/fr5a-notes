<script lang="ts">
	import { getAppState } from '../stores/app.svelte';
	import ActionMenu, { type MenuItem } from './ActionMenu.svelte';
	import type { NoteMeta } from '../../../../shared/types';

	const app = getAppState();

	// The open menu, or null. Reading it here keeps everything below reactive.
	const menu = $derived(app.contextMenu);

	/** Hide from / show to cloud AI. A folder-wide setting can't be lifted per note. */
	function hideItem(n: NoteMeta): MenuItem {
		const viaFolder = !n.aiLocal && app.hiddenFromAi(n);
		return {
			label: n.aiLocal || viaFolder ? 'Let cloud AI read' : 'Hide from cloud AI',
			icon: 'shield',
			disabled: viaFolder,
			hint: viaFolder ? 'folder' : undefined,
			action: () => void app.setHiddenFromAi(n.id, !n.aiLocal)
		};
	}

	const items = $derived.by((): MenuItem[] => {
		if (!menu) return [];
		const n = menu.note;
		if (n.id.startsWith('.fr5a_trash/') || app.trashOpen)
			return [
				{ label: 'Restore', icon: 'restore', action: () => void app.restoreNote(n.id) },
				{
					label: 'Delete forever',
					icon: 'trash',
					danger: true,
					divider: true,
					action: async () => {
						const ok = await app.confirm({
							title: 'Delete forever?',
							body: `“${n.title}” will be erased from disk. This can't be undone.`,
							confirm: 'Delete forever',
							danger: true
						});
						if (ok) await app.permanentDelete(n.id);
					}
				}
			];
		return [
			{ label: 'Open', icon: 'note', action: () => void app.openNote(n.id) },
			...(app.settings.tabs
				? [
						{
							label: 'Open in new tab',
							icon: 'plus',
							action: () => void app.openNote(n.id, true)
						} as MenuItem
					]
				: []),
			{ label: n.pinned ? 'Unpin' : 'Pin', icon: 'pin', action: () => void app.togglePin(n.id) },
			{
				label: n.locked ? 'Unlock' : 'Lock',
				icon: n.locked ? 'unlock' : 'lock',
				action: () => void app.toggleLock(n.id)
			},
			{ label: 'Rename…', icon: 'rename', action: () => void app.renameNote(n.id) },
			{ label: 'Move to…', icon: 'move', action: () => app.openMove('note', n.id) },
			...(app.changeFor(n.id)
				? [{ label: 'Show changes', icon: 'diff', action: () => app.showChanges(n.id) } as MenuItem]
				: []),
			...(app.settings.ai ? [hideItem(n)] : []),
			...(app.vault
				? [
						{
							label: n.encrypted ? 'Remove encryption' : 'Encrypt',
							icon: 'key',
							action: () => void app.setEncrypted(n.id, !n.encrypted)
						} as MenuItem
					]
				: []),
			{
				label: 'Move to Trash',
				icon: 'trash',
				danger: true,
				divider: true,
				disabled: n.locked,
				hint: n.locked ? 'locked' : undefined,
				action: () => void app.deleteNote(n.id)
			}
		];
	});
</script>

{#if menu}
	<ActionMenu
		{items}
		at={{ x: menu.x, y: menu.y }}
		sheet={app.layout === 'phone'}
		title={menu.note.title}
		label="Note actions"
		onclose={() => app.closeContextMenu()}
	/>
{/if}
