<script lang="ts">
	import { getAppState } from '../stores/app.svelte';
	import ActionMenu, { type MenuItem } from './ActionMenu.svelte';

	const app = getAppState();

	// The open menu, or null. Reading it here keeps everything below reactive.
	const menu = $derived(app.contextMenu);

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
			{ label: n.pinned ? 'Unpin' : 'Pin', icon: 'pin', action: () => void app.togglePin(n.id) },
			{
				label: n.locked ? 'Unlock' : 'Lock',
				icon: n.locked ? 'unlock' : 'lock',
				action: () => void app.toggleLock(n.id)
			},
			...(app.changeFor(n.id)
				? [{ label: 'Show changes', icon: 'diff', action: () => app.showChanges(n.id) } as MenuItem]
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
