import { expect, test, type Page } from '@playwright/test';
import { installFakeApi } from './fakeApi';

async function open(page: Page): Promise<void> {
	await page.addInitScript(installFakeApi);
	await page.addInitScript(() => {
		const api = (
			window as unknown as {
				api: {
					listNotes(): Promise<{ id: string; tags: string[] }[]>;
					listTags(): Promise<unknown>;
				};
			}
		).api;
		const list = api.listNotes.bind(api);
		api.listNotes = async () =>
			(await list()).map((note) => ({
				...note,
				tags: note.id === 'hello.md' ? ['focus'] : []
			}));
		api.listTags = async () => [
			{ name: 'focus', path: 'focus', count: 1, children: [] },
			{ name: 'empty', path: 'empty', count: 0, children: [] }
		];
	});
	await page.goto('/');
	await expect(page.locator('.body[data-layout]')).toBeVisible();
}

test('tag selection shows the filtered list on touch layouts, including empty results', async ({
	page
}) => {
	await open(page);
	const layout = await page.locator('.body').getAttribute('data-layout');
	if (layout === 'tablet') await page.getByRole('button', { name: 'Open folders' }).click();
	await page
		.locator('.sidebar-wrap .tag-row')
		.getByRole('button', { name: /#\s*focus/ })
		.click();
	await expect(page.locator('.list-wrap')).toHaveAttribute('aria-hidden', 'false');
	await expect(page.locator('.list-wrap')).toContainText('Hello');
	await expect(page.locator('.list-wrap')).not.toContainText('Plan');
	if (layout === 'phone') {
		await expect(page.locator('.body')).toHaveAttribute('data-pane', 'list');
		await page.getByRole('button', { name: 'Back' }).click();
	} else if (layout === 'tablet') await page.getByRole('button', { name: 'Open folders' }).click();
	await page
		.locator('.sidebar-wrap .tag-row')
		.getByRole('button', { name: /#\s*empty/ })
		.click();
	await expect(page.locator('.list-wrap')).toContainText('No notes with this tag');
	await expect(page.locator('.list-wrap')).toContainText('#empty');
});

test('narrow desktop swaps navigation and tagged results without losing the tag', async ({
	browser
}) => {
	const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, hasTouch: false });
	const page = await ctx.newPage();
	await open(page);
	await page
		.locator('.sidebar-wrap .tag-row')
		.getByRole('button', { name: /#\s*focus/ })
		.click();
	await page.setViewportSize({ width: 700, height: 800 });
	await expect(page.locator('.list-wrap')).toHaveAttribute('aria-hidden', 'false');
	await expect(page.locator('.list-wrap')).toContainText('Hello');
	await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await page.getByRole('button', { name: 'Toggle sidebar' }).click();
	await expect(page.locator('.sidebar-wrap')).toHaveAttribute('aria-hidden', 'false');
	await expect(page.locator('.list-wrap')).toHaveAttribute('aria-hidden', 'true');
	await page.getByRole('button', { name: 'Toggle note list' }).click();
	await expect(page.locator('.list-wrap')).toHaveAttribute('aria-hidden', 'false');
	await expect(page.locator('.list-wrap')).toContainText('#focus');
	await ctx.close();
});

test('tag and AI fit all three panes when possible, then close AI visibly when not', async ({
	browser
}) => {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: false });
	const page = await ctx.newPage();
	await open(page);
	await page
		.locator('.sidebar-wrap .tag-row')
		.getByRole('button', { name: /#\s*focus/ })
		.click();
	await page.keyboard.press('Control+j');
	for (const selector of ['.sidebar-wrap', '.list-wrap', '.harness-wrap'])
		await expect(page.locator(selector)).toHaveAttribute('aria-hidden', 'false');
	await page.setViewportSize({ width: 900, height: 800 });
	await expect(page.locator('.sidebar-wrap')).toHaveAttribute('aria-hidden', 'false');
	await expect(page.locator('.list-wrap')).toHaveAttribute('aria-hidden', 'false');
	await expect(page.locator('.harness-wrap')).toHaveAttribute('aria-hidden', 'true');
	await expect(page.getByText('Widen the window to show AI alongside tagged notes.')).toBeVisible();
	await ctx.close();
});
