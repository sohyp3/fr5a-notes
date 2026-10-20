import { expect, test, type Page } from '@playwright/test';
import { installFakeApi } from './fakeApi';

type FakeApi = { readNote(id: string): Promise<string> };

/** Hello holds two to-dos, one of them checked. */
async function installTasksApi(page: Page): Promise<void> {
	await page.addInitScript(installFakeApi);
	await page.addInitScript(() => {
		const api = (window as unknown as { api: FakeApi }).api;
		const read = api.readNote.bind(api);
		api.readNote = async (id: string) =>
			id === 'hello.md' ? '# Hello\n\n- [ ] milk\n- [x] eggs' : read(id);
	});
	await page.goto('/');
}

const editorText = (page: Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('.ProseMirror p')].map((p) => p.textContent).join('\n')
	);

async function openHello(page: Page): Promise<void> {
	await page.getByRole('button', { name: /^All Notes/ }).click();
	await page.getByText('Hello', { exact: true }).first().click();
	await expect(page.locator('.md-task-box')).toHaveCount(2);
}

test('desktop: a checkbox toggles its to-do; Enter continues unchecked, twice ends the list', async ({
	browser
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const ctx = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		isMobile: false,
		hasTouch: false
	});
	const page = await ctx.newPage();
	await installTasksApi(page);
	await expect(page.locator('.body[data-layout="desktop"]')).toBeVisible();
	await openHello(page);
	const boxes = page.locator('.md-task-box');
	await expect(boxes.nth(0)).toHaveAttribute('aria-checked', 'false');
	await expect(boxes.nth(1)).toHaveAttribute('aria-checked', 'true');
	await expect(page.locator('p.md-task-done')).toHaveText('- [x] eggs');

	await boxes.nth(0).click();
	await expect.poll(() => editorText(page)).toContain('- [x] milk');
	await expect(page.locator('p.md-task-done')).toHaveCount(2);
	await boxes.nth(0).click();
	await expect.poll(() => editorText(page)).toContain('- [ ] milk');

	// The caret stays put: typing goes where it was, not beside the box.
	await page.keyboard.press('Control+End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('bread');
	await expect.poll(() => editorText(page)).toContain('- [x] eggs\n- [ ] bread');
	await page.keyboard.press('Control+Enter');
	await expect.poll(() => editorText(page)).toContain('- [x] bread');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.keyboard.type('after');
	await expect.poll(() => editorText(page)).toContain('- [x] bread\nafter');

	// Mod+Shift+T makes the line a to-do; Backspace at its text drops the box.
	await page.keyboard.press('Control+Shift+T');
	await expect.poll(() => editorText(page)).toContain('\n- [ ] after');
	await page.keyboard.press('End');
	for (let i = 0; i < 'after'.length; i++) await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Backspace');
	await expect.poll(() => editorText(page)).toContain('\n- after');
	await ctx.close();
});

test('touch: a to-do checks off in view mode, without editing or the keyboard', async ({
	page
}, info) => {
	test.skip(info.project.name !== 'tablet landscape 1280x800', 'three panes, touch');
	await installTasksApi(page);
	await expect(page.locator('.body[data-layout="desktop"]')).toBeVisible();
	await openHello(page);
	const pm = page.locator('.ProseMirror');
	await expect(pm).toHaveAttribute('contenteditable', 'false');
	await page.locator('.md-task-box').nth(0).tap();
	await expect.poll(() => editorText(page)).toContain('- [x] milk');
	await expect(pm).toHaveAttribute('contenteditable', 'false');
	expect(await page.evaluate(() => document.activeElement?.closest('.ProseMirror'))).toBeNull();
});
