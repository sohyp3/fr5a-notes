import { expect, test, type Page } from '@playwright/test';
import { installFakeApi } from './fakeApi';

/**
 * Touch layouts, run on each project: phone (390×844, stacked panes), tablet
 * portrait (800×1280, list + editor with a folders drawer) and tablet landscape
 * (1280×800, three panes). Plus a mouse-driven desktop check.
 */

type Layout = 'phone' | 'tablet' | 'desktop';

const layoutOf = async (page: Page) =>
	(await page.locator('.body').getAttribute('data-layout')) as Layout;

/** The editor buffer as Markdown text: one paragraph per line. */
const editorText = (page: Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('.ProseMirror p')].map((p) => p.textContent).join('\n')
	);

const sidebar = (page: Page) => page.locator('.sidebar-wrap');
const list = (page: Page) => page.locator('.list-wrap');
const editorPane = (page: Page) => page.locator('.editor-pane');
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });

/** Left edge of an element on screen (drawer closed = pushed off to the left). */
const leftEdge = async (page: Page, sel: string) =>
	page.locator(sel).evaluate((el) => el.getBoundingClientRect().right);

/** Reach a folder's note list with whatever navigation the layout uses. */
async function openFolder(page: Page, name: RegExp) {
	const layout = await layoutOf(page);
	if (layout === 'tablet') await page.getByRole('button', { name: 'Open folders' }).tap();
	await sidebar(page).getByRole('button', { name }).tap();
}

async function openPlan(page: Page) {
	await openFolder(page, /^Work \d+$/);
	await list(page).getByText('Plan', { exact: true }).tap();
	await expect(page.locator('.ProseMirror')).toContainText('first line');
}

test.beforeEach(async ({ page }) => {
	await page.addInitScript(installFakeApi);
	await page.goto('/');
	await expect(page.locator('.body[data-layout]')).toBeVisible();
});

test('layout matches the device', async ({ page }, info) => {
	const expected: Layout = info.project.name.startsWith('phone')
		? 'phone'
		: info.project.name.includes('portrait')
			? 'tablet'
			: 'desktop';
	expect(await layoutOf(page)).toBe(expected);
	await expect(page.locator('html')).toHaveAttribute('data-touch', '');
	// Push / Pull live in the top bar on every layout, at finger size.
	for (const name of ['Pull', 'Push']) {
		const btn = page.getByRole('button', { name, exact: true });
		await expect(btn).toBeVisible();
		expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	}
});

test('phone: stacked navigation folder → note → back', async ({ page }) => {
	test.skip((await layoutOf(page)) !== 'phone', 'phone layout only');
	await expect(sidebar(page)).toBeVisible();
	await expect(list(page)).toBeHidden();
	await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);

	await sidebar(page)
		.getByRole('button', { name: /^Work \d+$/ })
		.tap();
	await expect(list(page)).toBeVisible();
	await expect(sidebar(page)).toBeHidden();
	await expect(list(page).getByText('Hello', { exact: true })).toHaveCount(0);

	await list(page).getByText('Plan', { exact: true }).tap();
	await expect(editorPane(page)).toBeVisible();
	await expect(list(page)).toBeHidden();

	await page.getByRole('button', { name: 'Back' }).tap();
	await expect(list(page)).toBeVisible();
	await expect(editorPane(page)).toBeHidden();
	await page.getByRole('button', { name: 'Back' }).tap();
	await expect(sidebar(page)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
});

test('tablet portrait: list + editor side by side, folders in a drawer', async ({ page }) => {
	test.skip((await layoutOf(page)) !== 'tablet', 'tablet layout only');
	const drawer = page.getByRole('button', { name: 'Open folders' });
	await expect(sidebar(page)).toHaveAttribute('aria-hidden', 'true');
	await expect.poll(() => leftEdge(page, '.sidebar-wrap')).toBeLessThanOrEqual(0);
	await expect(list(page)).toBeVisible();
	await expect(editorPane(page)).toBeVisible();

	// Drawer opens over the list, a scrim closes it.
	await drawer.tap();
	await expect(drawer).toHaveAttribute('aria-expanded', 'true');
	await expect.poll(() => leftEdge(page, '.sidebar-wrap')).toBeGreaterThan(200);
	await page.getByRole('button', { name: 'Close folders' }).tap({ position: { x: 700, y: 400 } });
	await expect(drawer).toHaveAttribute('aria-expanded', 'false');

	// Picking a folder closes the drawer and filters the list; the note opens beside it.
	await openPlan(page);
	await expect(drawer).toHaveAttribute('aria-expanded', 'false');
	await expect(list(page).getByText('Hello', { exact: true })).toHaveCount(0);
	const l = (await list(page).boundingBox())!;
	const e = (await editorPane(page).boundingBox())!;
	expect(l.x + l.width).toBeLessThanOrEqual(e.x + 1);
	expect(e.width).toBeGreaterThan(l.width);
	await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
});

test('tablet landscape: three panes with touch-sized targets', async ({ page }) => {
	test.skip((await layoutOf(page)) !== 'desktop', 'wide touch layout only');
	await expect(sidebar(page)).toBeVisible();
	await expect(list(page)).toBeVisible();
	await expect(editorPane(page)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open folders' })).toHaveCount(0);
	const row = sidebar(page).locator('.folder-row').first();
	expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(42);
	await openPlan(page);
	await expect(toolbar(page)).toBeVisible();
});

test('formatting toolbar: every button edits the note and keeps focus', async ({ page }) => {
	await openPlan(page);
	await expect(toolbar(page)).toBeVisible();
	await page.locator('.ProseMirror p').last().tap();
	await page.keyboard.press('End');
	const expected: Record<string, ((before: string) => string) | undefined> = {
		Bold: (b) => b + '****',
		Heading: (b) => b.replace(/\nfirst line/, '\n# first line'),
		List: (b) => b.replace(/\n# first line/, '\n- # first line'),
		Indent: (b) => b.replace(/\n- # first line/, '\n  - # first line'),
		Outdent: (b) => b.replace(/\n {2}- # first line/, '\n- # first line')
	};
	for (const name of ['Bold', 'Heading', 'List', 'Indent', 'Outdent', 'Tag', 'Undo']) {
		const before = await editorText(page);
		await toolbar(page).getByRole('button', { name, exact: true }).tap();
		await expect.poll(() => editorText(page), { message: name }).not.toBe(before);
		const want = expected[name]?.(before);
		if (want) expect(await editorText(page), name).toBe(want);
		expect(
			await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror')),
			`${name} keeps focus`
		).toBe(true);
	}
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { __writes: unknown[] }).__writes.length))
		.toBeGreaterThan(0);
});

test('long-press a note opens its menu without opening the note', async ({ page }) => {
	await openFolder(page, /^All Notes/);
	const card = list(page).getByRole('button', { name: /Hello/ });
	const box = (await card.boundingBox())!;
	const cdp = await page.context().newCDPSession(page);
	const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
	await page.waitForTimeout(750);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect(page.getByRole('menu')).toBeVisible();
	await expect(list(page).locator('.card.active')).toHaveCount(0);
	// A normal tap still opens the note.
	await page.keyboard.press('Escape');
	await expect(page.getByRole('menu')).toHaveCount(0);
	await card.tap();
	await expect(list(page).locator('.card.active')).toHaveCount(1);
	await expect(page.locator('.ProseMirror')).toContainText('world');
});

test('rotating keeps the same editor, text and caret', async ({ page }) => {
	await openPlan(page);
	await page.locator('.ProseMirror p').last().tap();
	await page.keyboard.press('End');
	await page.keyboard.type(' typed');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await page.evaluate(
		() => ((document.querySelector('.ProseMirror') as HTMLElement).dataset.mark = '1')
	);
	const caret = () =>
		page.evaluate(() => {
			const s = document.getSelection()!;
			return { text: s.anchorNode?.textContent, offset: s.anchorOffset };
		});
	const before = { text: await editorText(page), caret: await caret() };
	const layoutBefore = await layoutOf(page);
	const vp = page.viewportSize()!;

	const rotations = [
		{ size: { width: vp.height, height: vp.width }, rotated: true },
		{ size: { width: vp.width, height: vp.height }, rotated: false }
	];
	for (const { size, rotated } of rotations) {
		await page.setViewportSize(size);
		// Every device here crosses a layout boundary when it rotates.
		if (rotated) await expect.poll(() => layoutOf(page)).not.toBe(layoutBefore);
		else await expect.poll(() => layoutOf(page)).toBe(layoutBefore);
		await expect(editorPane(page)).toBeVisible();
		await expect(page.locator('.ProseMirror[data-mark="1"]')).toHaveCount(1);
		expect(await editorText(page)).toBe(before.text);
		expect(await caret()).toEqual(before.caret);
		await expect(toolbar(page)).toBeVisible();
	}
});

test('ghost syntax: no hover reveal on touch, shown at the caret', async ({ page }) => {
	await expect(page.locator('html')).toHaveAttribute('data-hover', 'none');
	await openPlan(page);
	const heading = page.locator('.ProseMirror p').first();
	const hash = heading.locator('.md-syntax').first();
	const fontSize = () => hash.evaluate((el) => getComputedStyle(el).fontSize);
	await page.locator('.ProseMirror p').last().tap();
	await heading.hover();
	expect(await fontSize()).toBe('0px');
	await heading.tap({ position: { x: 2, y: 8 } });
	await page.keyboard.press('Home');
	await expect.poll(fontSize).not.toBe('0px');
});

test('desktop mouse windows keep the side-by-side layout at any width', async ({ browser }) => {
	for (const width of [1180, 800]) {
		const ctx = await browser.newContext({
			viewport: { width, height: 800 },
			isMobile: false,
			hasTouch: false
		});
		const page = await ctx.newPage();
		await page.addInitScript(installFakeApi);
		await page.goto('/');
		await expect(page.locator('.body')).toHaveAttribute('data-layout', 'desktop');
		await expect(page.locator('html')).not.toHaveAttribute('data-touch', '');
		await expect(page.locator('.sidebar-wrap')).toBeVisible();
		await expect(page.locator('.list-wrap')).toBeVisible();
		await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible();
		await ctx.close();
	}
});
