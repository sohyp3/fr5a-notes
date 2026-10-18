import { expect, test, type Page } from '@playwright/test';
import { installFakeApi } from './fakeApi';

async function installLinkedApi(page: Page): Promise<void> {
	await page.addInitScript(installFakeApi);
	await page.addInitScript(() => {
		const api = (window as unknown as { api: { readNote(id: string): Promise<string> } }).api;
		const read = api.readNote.bind(api);
		api.readNote = async (id: string) => {
			const text = await read(id);
			if (id === 'Work/plan.md') return `${text}\n\nSee [[Hello]] and [[Missing idea]].`;
			if (id === 'hello.md') return `${text}\n\nBack to [[Work/plan|the plan]].`;
			return text;
		};
	});
	await page.goto('/');
}

test.beforeEach(async ({ page }) => {
	await installLinkedApi(page);
	await expect(page.locator('.body[data-layout]')).toBeVisible();
});

test('linked notes stays dormant until enabled and adapts its map', async ({ page }, info) => {
	const layout = await page.locator('.body').getAttribute('data-layout');
	if (layout === 'tablet') await page.getByRole('button', { name: 'Open folders' }).tap();

	await expect(page.getByRole('button', { name: /Linked notes/ })).toHaveCount(0);
	await page.getByRole('button', { name: 'Settings', exact: true }).tap();
	await page.getByRole('button', { name: /Linked notes/ }).tap();
	await page.getByRole('switch', { name: 'Enable linked notes' }).tap();
	await expect(page.getByRole('switch', { name: 'Enable linked notes' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await page.getByRole('button', { name: 'Open map' }).tap();

	await expect(page.getByRole('region', { name: 'Linked notes' })).toBeVisible();
	await expect(page.getByRole('button', { name: /Plan, \d+ connections?/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Hello, \d+ connections?/ })).toBeVisible();
	await expect(
		page.getByRole('button', { name: /Missing idea, \d+ connection.*missing note/ })
	).toBeVisible();
	await expect(page.getByText('2 notes · 3 links · 0 unlinked')).toBeVisible();
	// Phones swap the legend for a hint about tapping into a note's connections.
	if (layout === 'phone') {
		await expect(page.locator('.legend')).toHaveCount(0);
		await expect(page.getByText('Tap a note to bring its connections into focus')).toBeVisible();
	} else await expect(page.locator('.legend')).toBeVisible();

	await page.screenshot({
		path: info.outputPath('linked-notes.png'),
		fullPage: true
	});

	await page.getByRole('button', { name: /Hello, \d+ connections?/ }).click();
	await page.getByRole('button', { name: 'Open note' }).click();
	await expect(page.locator('.ProseMirror')).toContainText('Back to');
	await page.locator('.md-wiki-link').click();
	await expect(page.locator('.ProseMirror')).toContainText('first line');
});

test('desktop map uses the wide inspector layout', async ({ browser }, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop verification is enough');
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		isMobile: false,
		hasTouch: false,
		deviceScaleFactor: 1
	});
	const page = await context.newPage();
	await installLinkedApi(page);
	await expect(page.locator('.body[data-layout="desktop"]')).toBeVisible();
	await expect(page.locator('html')).not.toHaveAttribute('data-touch', '');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: /Linked notes/ }).click();
	await page.getByRole('switch', { name: 'Enable linked notes' }).click();
	await page.getByRole('button', { name: 'Open map' }).click();
	await expect(page.getByRole('region', { name: 'Linked notes' })).toBeVisible();
	await expect(page.locator('.linked-notes')).not.toHaveClass(/tablet/);
	await expect(page.locator('.linked-notes > .workspace')).toHaveCSS(
		'grid-template-columns',
		/292px$/
	);
	await page.screenshot({
		path: test.info().outputPath('linked-notes-desktop-1440x900.png'),
		fullPage: true
	});
	await context.close();
});
