import { expect, test, type Page } from '@playwright/test';
import { installFakeApi } from './fakeApi';
import type { GitChange } from '../src/shared/types';

const node = (id: string, text: string) => ({
	id,
	type: 'text',
	text,
	x: 0,
	y: 0,
	width: 200,
	height: 60
});
const before = JSON.stringify({
	nodes: [node('a', 'Trade plan'), node('b', 'Monthly review')],
	edges: []
});
const after = JSON.stringify({
	nodes: [{ ...node('a', 'Updated thesis'), x: 160 }, node('b', 'Monthly review')],
	edges: [{ id: 'e', fromNode: 'a', toNode: 'b', label: 'review' }]
});

async function install(page: Page, rows: GitChange[]) {
	await page.addInitScript(installFakeApi);
	await page.addInitScript((changes) => {
		const w = window as unknown as {
			api: {
				gitChanges(): Promise<unknown>;
				getState(key: string): Promise<unknown>;
				writeMeta(path: string, text: string): Promise<void>;
			};
		};
		w.api.gitChanges = async () => changes;
		const get = w.api.getState.bind(w.api);
		w.api.getState = async (key) => (key === 'settings' ? { mindMaps: true } : get(key));
		for (const row of changes)
			if (row.after !== null && row.path.startsWith('.fr5a/maps/'))
				void w.api.writeMeta(row.path.slice(6), row.after);
	}, rows);
	await page.goto('/');
	await expect(page.locator('.body[data-layout]')).toBeVisible();
	if ((await page.locator('.body').getAttribute('data-layout')) === 'phone') {
		await page.getByRole('button', { name: 'More', exact: true }).click();
		await page.getByRole('menuitem', { name: /^Changes/ }).click();
	} else {
		await page.locator('.titlebar').getByRole('button', { name: 'Changes', exact: true }).click();
	}
	await expect(page.getByRole('heading', { name: 'Changes', exact: true })).toBeVisible();
}
const map: GitChange = { path: '.fr5a/maps/Trade.canvas', status: 'modified', before, after };

for (const mode of ['desktop', 'phone'] as const) {
	test.describe(`map differences ${mode}`, () => {
		test.use({
			viewport: mode === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
			isMobile: mode === 'phone',
			hasTouch: mode === 'phone'
		});
		test('renders semantic changes and opens the map; map-only actions stay read-only', async ({
			page
		}, info) => {
			await install(page, [map]);
			await expect(page.locator('.changes .sub')).toContainText('1 map changed');
			await expect(page.getByRole('button', { name: /^Stash/ })).toHaveCount(0);
			await expect(page.getByRole('button', { name: /^Revert/ })).toHaveCount(0);
			await page.getByRole('list', { name: 'Changed notes and maps' }).getByRole('button').click();
			await expect(page.locator('.map-diff')).toContainText('Horizontal position');
			await expect(page.locator('.map-diff')).toContainText('Updated thesis');
			await expect(page.locator('.map-diff')).toContainText('Updated thesis → Monthly review');
			await expect(page.locator('.map-diff .source')).not.toHaveAttribute('open', '');
			await page.screenshot({ path: info.outputPath(`map-diff-${mode}.png`) });
			await page.getByRole('button', { name: 'Open map', exact: true }).click();
			await expect(page.locator('.svelte-flow')).toBeVisible();
		});
		test('explains how to open a map from a nested repository', async ({ page }) => {
			await install(page, [{ ...map, path: 'investing/.fr5a/maps/Trade.canvas' }]);
			await page.getByRole('list', { name: 'Changed notes and maps' }).getByRole('button').click();
			await expect(
				page.getByText('To edit this map, open its repository folder as your workspace.')
			).toBeVisible();
			await expect(page.getByRole('button', { name: 'Open map', exact: true })).toHaveCount(0);
			await expect(page.locator('.map-diff')).toContainText('Horizontal position');
		});
		test('keeps malformed map source visible and all actions limited to notes', async ({
			page
		}) => {
			await install(page, [
				{ ...map, after: '{broken map source' },
				{ path: 'hello.md', status: 'modified', before: '# Hello', after: '# Hello\nchanged' }
			]);
			await expect(page.locator('.changes .sub')).toContainText('1 note and 1 map');
			await expect(page.getByRole('button', { name: 'Stash notes', exact: true })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Revert notes', exact: true })).toBeVisible();
			await page.getByRole('button', { name: 'Revert notes', exact: true }).click();
			await expect(page.getByRole('alertdialog')).toContainText('Revert hello.md?');
			await expect(page.getByRole('alertdialog')).not.toContainText('Trade.canvas');
			await page
				.getByRole('alertdialog')
				.getByRole('button', { name: 'Cancel', exact: true })
				.click();

			await page
				.getByRole('list', { name: 'Changed notes and maps' })
				.getByRole('button')
				.filter({ hasText: 'Trade.canvas' })
				.click();
			await expect(page.locator('.map-diff')).toContainText('Review the source changes below');
			await expect(page.locator('.map-diff')).toContainText('{broken map source');
			await expect(
				page.locator('.detail .acts').getByRole('button', { name: 'Revert', exact: true })
			).toHaveCount(0);
			await expect(
				page.locator('.detail .acts').getByRole('button', { name: 'Stash', exact: true })
			).toHaveCount(0);
		});
	});
}
