<script lang="ts">
	import { getAppState } from '../stores/app.svelte';
	import { platform } from '../platform';
	import { baseOf, cleanName } from '../../../../shared/paths';
	import ActionMenu, { type MenuItem } from './ActionMenu.svelte';

	const app = getAppState();
	const menu = $derived(app.folderMenu);

	async function newFolderIn(parent: string): Promise<void> {
		const name = await app.prompt({
			title: `New folder in ${baseOf(parent)}`,
			label: 'Folder name',
			value: '',
			confirm: 'Create',
			check: (v) => (cleanName(v) ? null : 'Enter a name.')
		});
		if (name === null) return;
		try {
			const rel = await platform.createFolder(cleanName(name), parent);
			await app.refresh();
			if (!app.isFolderExpanded(parent, parent.split('/').length - 1))
				app.toggleFolderExpanded(parent, parent.split('/').length - 1);
			app.selectFolder(rel);
		} catch (err) {
			app.notify('error', err instanceof Error ? err.message : String(err));
		}
	}

	const items = $derived.by((): MenuItem[] => {
		if (!menu) return [];
		const path = menu.path;
		const hidden = app.folderHidden(path);
		const items: MenuItem[] = [
			{ label: 'New folder inside…', icon: 'plus', action: () => void newFolderIn(path) },
			{ label: 'Rename…', icon: 'rename', action: () => void app.renameFolder(path) },
			{ label: 'Move to…', icon: 'move', action: () => app.openMove('folder', path) }
		];
		if (app.settings.ai)
			items.push({
				label: hidden ? 'Let cloud AI read' : 'Hide from cloud AI',
				icon: 'shield',
				divider: true,
				disabled: hidden?.via === 'parent',
				hint: hidden?.via === 'parent' ? `via ${baseOf(hidden.folder) || 'Everything'}` : undefined,
				action: () => app.toggleFolderHidden(path)
			});
		items.push(
			{
				label: 'Hide from sidebar',
				icon: 'eye',
				divider: !app.settings.ai,
				action: () => app.setFolderListed(path, false)
			},
			{
				label: 'Move to Trash',
				icon: 'trash',
				danger: true,
				divider: true,
				action: () => void app.deleteFolder(path)
			}
		);
		return items;
	});
</script>

{#if menu}
	<ActionMenu
		{items}
		at={{ x: menu.x, y: menu.y }}
		sheet={app.layout === 'phone'}
		title={baseOf(menu.path)}
		label="Folder actions"
		onclose={() => (app.folderMenu = null)}
	/>
{/if}
