import { expect, test, type Browser, type Page } from '@playwright/test';
import { installFakeApi } from './fakeApi';

type FakeApi = {
	readNote(id: string): Promise<string>;
	listNotes(): Promise<{ id: string; tags: string[] }[]>;
};

/** Plan links to Hello and to a note that doesn't exist; Hello links back; Plan is tagged #work. */
async function installLinkedApi(page: Page): Promise<void> {
	await page.addInitScript(installFakeApi);
	await page.addInitScript(() => {
		const api = (window as unknown as { api: FakeApi }).api;
		const read = api.readNote.bind(api);
		api.readNote = async (id: string) => {
			const text = await read(id);
			if (id === 'Work/plan.md')
				return `${text}\n\nSee [Hello](../hello.md) and [the idea](Missing%20idea.md).`;
			if (id === 'hello.md') return `${text}\n\nBack to [the plan](Work/plan.md).`;
			return text;
		};
		const list = api.listNotes.bind(api);
		api.listNotes = async () =>
			(await list()).map((n) => (n.id === 'Work/plan.md' ? { ...n, tags: ['work'] } : n));
	});
	await page.goto('/');
}

async function enable(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: /Linked notes/ }).click();
	await page.getByRole('switch', { name: 'Enable linked notes' }).click();
	await expect(page.getByRole('switch', { name: 'Enable linked notes' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
}

async function desktop(browser: Browser) {
	const ctx = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		isMobile: false,
		hasTouch: false
	});
	const page = await ctx.newPage();
	await installLinkedApi(page);
	await expect(page.locator('.body[data-layout="desktop"]')).toBeVisible();
	return { ctx, page };
}

const editorText = (page: Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('.ProseMirror p')].map((p) => p.textContent).join('\n')
	);

test.beforeEach(async ({ page }) => {
	await installLinkedApi(page);
	await expect(page.locator('.body[data-layout]')).toBeVisible();
});

test('linked notes stays dormant until enabled; the map walks notes and tags', async ({
	page
}, info) => {
	const layout = await page.locator('.body').getAttribute('data-layout');
	if (layout === 'tablet') await page.getByRole('button', { name: 'Open folders' }).tap();

	await expect(page.getByRole('button', { name: /Linked notes/ })).toHaveCount(0);
	await enable(page);
	await page.getByRole('button', { name: 'Open map' }).tap();

	const map = page.getByRole('region', { name: 'Linked notes' });
	await expect(map).toBeVisible();
	await expect(page.getByText('2 notes · 1 tag · 3 links')).toBeVisible();
	await expect(map.getByRole('button', { name: 'Plan', exact: true })).toBeVisible();
	await expect(map.getByRole('button', { name: 'Hello', exact: true })).toBeVisible();
	await expect(map.getByRole('button', { name: 'Tag work' })).toBeVisible();
	await expect(map.getByRole('button', { name: 'Missing idea, missing note' })).toBeVisible();
	await page.screenshot({ path: info.outputPath('linked-notes.png'), fullPage: true });

	// A tap lights the note's neighbourhood and opens its panel.
	await map.getByRole('button', { name: 'Hello', exact: true }).tap();
	const panel = page.getByRole('complementary', { name: 'Selected on the map' });
	await expect(panel.locator('.dtitle strong')).toHaveText('Hello');
	await expect(map.locator('.canvas > svg')).toHaveClass(/focused/);
	await expect(map.locator('.node.near')).toHaveCount(2);

	// A row moves the map to that note; Back returns.
	await panel.getByRole('button', { name: /^Plan/ }).first().tap();
	await expect(panel.locator('.dtitle strong')).toHaveText('Plan');
	await expect(panel.getByRole('button', { name: '#work' })).toBeVisible();
	await panel.getByRole('button', { name: '#work' }).tap();
	await expect(panel.locator('.dtitle strong')).toHaveText('#work');
	await panel.getByRole('button', { name: 'Back' }).tap();
	await expect(panel.locator('.dtitle strong')).toHaveText('Plan');
	await panel.getByRole('button', { name: 'Back' }).tap();
	await expect(panel.locator('.dtitle strong')).toHaveText('Hello');

	await panel.getByRole('button', { name: 'Open note' }).tap();
	await expect(page.locator('.ProseMirror')).toContainText('Back to');
	// Touch opens notes in view mode, where a tap follows the Markdown link.
	if (layout !== 'desktop') {
		await page.locator('.md-note-link').tap();
		await expect(page.locator('.ProseMirror')).toContainText('first line');

		// The formatting toolbar's Link (a button on tablets, in Insert on phones) opens the
		// note list at the caret.
		await page.getByRole('button', { name: 'Edit note' }).tap();
		await page.locator('.ProseMirror p').last().tap();
		await page.keyboard.press('End');
		const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
		if (layout === 'tablet') await toolbar.getByRole('button', { name: 'Link', exact: true }).tap();
		else {
			await toolbar.getByRole('button', { name: 'Insert', exact: true }).tap();
			await page.getByRole('menuitem', { name: 'Link…' }).tap();
		}
		await page.locator('.tag-suggest-item', { hasText: 'Hello' }).tap();
		await expect.poll(() => editorText(page)).toContain('[Hello](../hello.md)');
	}
});

test('desktop: [text]( suggests notes; Insert → Link; Mod+click follows', async ({
	browser
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktop(browser);
	await enable(page);
	await page.getByRole('button', { name: /^All Notes/ }).click();
	await page.getByText('Hello', { exact: true }).first().click();
	await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
	await page.keyboard.press('Control+End');
	const suggest = page.locator('.tag-suggest');

	// Writing a link suggests notes for its path.
	await page.keyboard.press('Enter');
	await page.keyboard.type('[our plan](pl');
	await expect(suggest).toContainText('Plan');
	await expect(suggest).toContainText('Work');
	await page.keyboard.press('Enter');
	await expect(suggest).toHaveCount(0);
	expect(await editorText(page)).toContain('[our plan](Work/plan.md)');

	// `[[` is plain text: no list.
	await page.keyboard.type(' [[pl');
	await expect(suggest).toHaveCount(0);
	for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');

	// Insert → Link… with no selection: the note's title, selected to type over.
	await page.keyboard.type(' ');
	await page.getByRole('button', { name: 'Insert', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Link…' }).click();
	await expect(suggest).toContainText('Plan');
	await page.keyboard.press('Enter');
	await page.keyboard.type('the plan');
	expect(await editorText(page)).toContain(' [the plan](Work/plan.md)');

	// …over a selection: it becomes the link's text.
	await page.keyboard.press('End');
	await page.keyboard.type(' see this');
	for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
	await page.getByRole('button', { name: 'Insert', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Link…' }).click();
	await expect(suggest).toContainText('Plan');
	await page.keyboard.press('Enter');
	expect(await editorText(page)).toContain('see [this](Work/plan.md)');

	await page.locator('.md-note-link', { hasText: 'our plan' }).click({ modifiers: ['Control'] });
	await expect(page.locator('.ProseMirror')).toContainText('first line');

	// The map takes the desktop's side panel.
	await page.keyboard.press('Control+g');
	const map = page.getByRole('region', { name: 'Linked notes' });
	await map.getByRole('button', { name: 'Hello', exact: true }).click();
	await expect(map.locator('.inspector')).toHaveCSS('width', '300px');
	await page.screenshot({ path: info.outputPath('linked-notes-desktop.png') });
	await ctx.close();
});
