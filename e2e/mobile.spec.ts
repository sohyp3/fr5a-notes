import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
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
	// The drawer slides shut over the list (tablet) / the list slides in
	// (phone): let it settle before gestures that start from measured points.
	if (layout === 'tablet')
		await expect.poll(() => leftEdge(page, '.sidebar-wrap')).toBeLessThanOrEqual(0);
	if (layout === 'phone')
		await expect.poll(() => list(page).evaluate((el) => el.getBoundingClientRect().x)).toBe(0);
}

async function openPlan(page: Page) {
	await openFolder(page, /^Work \d+$/);
	await list(page).getByText('Plan', { exact: true }).tap();
	await expect(page.locator('.ProseMirror')).toContainText('first line');
}

/** Touch devices open notes in view mode: switch to editing. */
async function edit(page: Page) {
	await page.getByRole('button', { name: 'Edit note' }).tap();
	await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
}

/** A one-finger drag across `target` (CDP touch events, so pointer + touch-action apply). */
async function swipe(page: Page, target: Locator, dx: number, dy = 0) {
	const box = (await target.boundingBox())!;
	const cdp = await page.context().newCDPSession(page);
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
	for (let i = 1; i <= 10; i++)
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }]
		});
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Settings from wherever the layout keeps its button. */
async function openSettings(page: Page) {
	if ((await layoutOf(page)) === 'tablet')
		await page.getByRole('button', { name: 'Open folders' }).tap();
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).tap();
}

async function openHarness(page: Page) {
	await page.getByRole('button', { name: 'Toggle AI harness' }).tap();
	const harness = page.getByRole('region', { name: 'AI harness' });
	await expect(harness).toBeVisible();
	return harness;
}

const width = (loc: Locator) => loc.evaluate((el) => el.getBoundingClientRect().width);

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
	// Push / Pull sit in the top bar (phones: its overflow menu), at finger size.
	if (expected === 'phone') {
		await expect(page.getByRole('button', { name: 'Pull', exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'More', exact: true }).tap();
		await expect(page.locator('.sheet-root')).toBeVisible();
	}
	for (const name of ['Pull', 'Push']) {
		const btn = page.getByRole(expected === 'phone' ? 'menuitem' : 'button', { name, exact: true });
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
	await expect(toolbar(page)).toHaveCount(0);
	await edit(page);
	await expect(toolbar(page)).toBeVisible();
});

test('formatting toolbar: every button edits the note and keeps focus', async ({ page }) => {
	await openPlan(page);
	await edit(page);
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
	// Phones get a bottom action sheet; wider layouts the anchored menu.
	const phone = (await layoutOf(page)) === 'phone';
	await expect(page.locator('.sheet-root')).toHaveCount(phone ? 1 : 0);
	await expect(page.getByRole('menuitem', { name: 'Pin' })).toBeVisible();
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
	await edit(page);
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
	await edit(page);
	const heading = page.locator('.ProseMirror p').first();
	const hash = heading.locator('.md-syntax').first();
	const fontSize = () => hash.evaluate((el) => getComputedStyle(el).fontSize);
	await page.locator('.ProseMirror p').last().tap();
	await heading.hover();
	// (Poll: the caret just left the heading, whose syntax fades out over 130ms.)
	await expect.poll(fontSize).toBe('0px');
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

test('AI harness: question → approved write → saved session', async ({ page }) => {
	await openPlan(page);
	await page.getByRole('button', { name: 'Toggle AI harness' }).tap();
	const harness = page.getByRole('region', { name: 'AI harness' });
	await expect(harness).toBeVisible();
	if ((await layoutOf(page)) === 'phone') await expect(editorPane(page)).toBeHidden();

	// Built-in skills are seeded into `.fr5a/skills/` on first open.
	await expect(harness.getByRole('button', { name: /\/fact-check/ })).toBeVisible();

	const input = harness.locator('textarea');
	await input.fill('help me with tone');
	await input.press('Enter');

	await expect(harness.getByRole('heading', { name: 'Which tone?' })).toBeVisible();
	await harness.getByRole('button', { name: 'Casual' }).tap();

	await expect(harness.getByText(/append.*current note \(Work\/plan\.md\)/)).toBeVisible();
	await expect(harness.locator('.dl.add').filter({ hasText: 'AI line' })).toHaveText('+AI line');
	await harness.getByRole('button', { name: 'Apply' }).tap();

	await expect(harness.getByText('Done: Applied to Work/plan.md (append)')).toBeVisible();
	expect(await editorText(page)).toBe('# Plan\n\nfirst line\n\nAI line\n');

	const sessions = await page.evaluate(() =>
		Object.entries((window as unknown as { __meta: Record<string, string> }).__meta).filter(([k]) =>
			k.startsWith('sessions/')
		)
	);
	expect(sessions).toHaveLength(1);
	expect(sessions[0][1]).toContain('<!-- turn: you -->\n\nhelp me with tone');
	expect(sessions[0][1]).toContain('<!-- turn: tool ask_user -->');

	// Closing returns to the note (phone: back to the editor pane).
	await harness.getByRole('button', { name: 'Close AI pane' }).tap();
	await expect(editorPane(page)).toBeVisible();
});

test('AI harness: @folder/ mention inlines the folder', async ({ page }) => {
	await openPlan(page);
	await page.getByRole('button', { name: 'Toggle AI harness' }).tap();
	const harness = page.getByRole('region', { name: 'AI harness' });
	const input = harness.locator('textarea');
	await input.fill('@Wo');
	// Folder suggestions come first; Enter picks the highlighted one.
	await expect(harness.locator('.suggest [role=option]').first()).toContainText('Work/');
	await input.press('Enter');
	await expect(input).toHaveValue('@Work/ ');
	await input.pressSequentially('context?');
	await input.press('Enter');
	await expect(harness.getByText('ctx: Work/plan.md | index of @Work/')).toBeVisible();
	// The context summary counts it; expanding shows the attachment itself.
	await expect(harness.locator('.ctx-sum')).toContainText('+1 attached');
	await harness.locator('.ctx-sum').tap();
	await expect(harness.locator('.chip.dir')).toHaveText(/Work\//);
});

test('AI off: no button, no pane', async ({ page }) => {
	await openPlan(page);
	await expect(page.getByRole('button', { name: 'Toggle AI harness' })).toBeVisible();
	// Settings → AI toggle.
	const layout = await layoutOf(page);
	if (layout === 'phone') await page.getByRole('button', { name: 'Back' }).tap();
	if (layout === 'phone') await page.getByRole('button', { name: 'Back' }).tap();
	await openSettings(page);
	await page
		.getByRole('navigation', { name: 'Settings sections' })
		.getByRole('button', { name: /AI assistant/ })
		.tap();
	const sw = page.getByRole('switch', { name: 'Enable AI harness' });
	await expect(sw).toHaveAttribute('aria-checked', 'true');
	await sw.tap();
	await expect(sw).toHaveAttribute('aria-checked', 'false');
	await expect(page.getByText('Max steps per run')).toHaveCount(0);
	await expect(page.locator('.harness')).toHaveCount(0);
});
// --- view / edit mode ------------------------------------------------------------

test('notes open in view mode on touch: no keyboard until Edit', async ({ page }) => {
	await openPlan(page);
	const pm = page.locator('.ProseMirror');
	await expect(pm).toHaveAttribute('contenteditable', 'false');
	await expect(toolbar(page)).toHaveCount(0);
	expect(await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))).toBe(false);
	// A stray tap on the text doesn't start editing.
	await page.locator('.ProseMirror p').last().tap();
	await expect(pm).toHaveAttribute('contenteditable', 'false');

	await edit(page);
	await expect(toolbar(page)).toBeVisible();
	await page.keyboard.type('X');
	await expect.poll(() => editorText(page)).toContain('X');

	await page.getByRole('button', { name: 'Done editing' }).tap();
	await expect(pm).toHaveAttribute('contenteditable', 'false');
	await expect(toolbar(page)).toHaveCount(0);

	// Double-tap edits right there.
	await page.locator('.ProseMirror p').last().dblclick();
	await expect(pm).toHaveAttribute('contenteditable', 'true');
});

test('editor header sits above the text, also when scrolled', async ({ page }) => {
	await openPlan(page);
	await edit(page);
	await page.locator('.ProseMirror p').last().tap();
	for (let i = 0; i < 40; i++) await page.keyboard.press('Enter');
	const scroll = page.locator('.editor-pane .scroll');
	await scroll.evaluate((el) => (el.scrollTop = 300));
	await expect(page.locator('.editor-head')).toHaveClass(/scrolled/);
	const head = (await page.locator('.editor-head').boundingBox())!;
	const body = (await scroll.boundingBox())!;
	expect(body.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
	// What's under the AI button is the button, not note text.
	const hit = await page.getByRole('button', { name: 'Toggle AI harness' }).evaluate((el) => {
		const r = el.getBoundingClientRect();
		return (
			document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.editor-head') !==
			null
		);
	});
	expect(hit).toBe(true);
});

// --- settings ----------------------------------------------------------------------

test('settings: sections instead of one long page', async ({ page }) => {
	await openSettings(page);
	const nav = page.getByRole('navigation', { name: 'Settings sections' });
	await expect(nav).toBeVisible();
	await nav.getByRole('button', { name: /Appearance/ }).tap();
	await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
	// Other sections' controls aren't piled onto the same page.
	await expect(page.getByRole('switch', { name: 'Enable AI harness' })).toHaveCount(0);
	if ((await layoutOf(page)) === 'phone') {
		// Phones drill in: the section replaces the list; back returns to it.
		await expect(nav).toHaveCount(0);
		await page.getByRole('button', { name: 'All settings' }).tap();
		await expect(nav).toBeVisible();
		await page.getByRole('button', { name: 'Back' }).tap();
		await expect(nav).toHaveCount(0);
	} else {
		await nav.getByRole('button', { name: /General/ }).tap();
		await expect(page.getByRole('radiogroup', { name: 'Open notes in' })).toBeVisible();
	}
});

// --- swipe actions -------------------------------------------------------------------

test('swipe reveals an action; only tapping it commits', async ({ page }) => {
	await openFolder(page, /^All Notes/);
	const card = list(page).getByRole('button', { name: /Hello/ });
	const trashed = () =>
		page.evaluate(() => (window as unknown as { __trashed: string[] }).__trashed);

	// A mostly-vertical drag is a scroll: nothing is revealed.
	await swipe(page, card, -20, 80);
	await expect(list(page).locator('.action')).toHaveCount(0);

	// Swipe left: "Trash" shows, but nothing happens until it is tapped.
	await swipe(page, card, -150);
	const trash = list(page).getByRole('button', { name: 'Trash', exact: true });
	await expect(trash).toBeVisible();
	expect((await trash.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await page.waitForTimeout(300);
	expect(await trashed()).toEqual([]);

	// Tapping elsewhere closes it.
	await list(page)
		.locator('.list')
		.tap({ position: { x: 20, y: 300 } });
	await expect(list(page).locator('.action')).toHaveCount(0);
	expect(await trashed()).toEqual([]);

	// Swipe right → Pin, tap to commit.
	await swipe(page, card, 150);
	await list(page).getByRole('button', { name: 'Pin', exact: true }).tap();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { __writes: { content: string }[] }).__writes.some((w) =>
					w.content.includes('<!-- pinned: true -->')
				)
			)
		)
		.toBe(true);

	await swipe(page, card, -150);
	await list(page).getByRole('button', { name: 'Trash', exact: true }).tap();
	await expect.poll(trashed).toEqual(['hello.md']);
});

test('trash: deleting forever asks first', async ({ page }) => {
	await openFolder(page, /^Trash/);
	const card = list(page).getByRole('button', { name: /Old/ });
	const deleted = () =>
		page.evaluate(() => (window as unknown as { __deleted: string[] }).__deleted);
	await swipe(page, card, -150);
	await list(page).getByRole('button', { name: 'Delete forever' }).tap();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toContainText('Delete forever?');
	await dialog.getByRole('button', { name: 'Cancel' }).tap();
	await expect(dialog).toHaveCount(0);
	expect(await deleted()).toEqual([]);

	await swipe(page, card, -150);
	await list(page).getByRole('button', { name: 'Delete forever' }).tap();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete forever' }).tap();
	await expect.poll(deleted).toEqual(['.fr5a_trash/old.md']);
});

// --- changes (git status) ------------------------------------------------------------

/** Edit Plan (so it differs from the last commit) and open the Changes view on it. */
async function changePlan(page: Page) {
	await openPlan(page);
	await edit(page);
	await page.locator('.ProseMirror p').last().tap();
	await page.keyboard.press('End');
	await page.keyboard.type(' extra');
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { __writes: unknown[] }).__writes.length))
		.toBeGreaterThan(0);

	if ((await layoutOf(page)) === 'phone') {
		await page.getByRole('button', { name: 'More', exact: true }).tap();
		await page.getByRole('menuitem', { name: /^Changes/ }).tap();
	} else {
		await page.locator('.titlebar').getByRole('button', { name: 'Changes' }).tap();
	}
	await expect(page.getByRole('heading', { name: 'Changes' })).toBeVisible();
}

const changedFile = (page: Page, name: string) =>
	page.getByRole('list', { name: 'Changed notes' }).locator('.file').filter({ hasText: name });

test('changes: an edited note shows up with its diff', async ({ page }) => {
	await changePlan(page);
	await changedFile(page, 'plan.md').tap();
	await expect(page.locator('.dl.add').filter({ hasText: 'first line extra' })).toBeVisible();
	await expect(page.locator('.dl.del').filter({ hasText: /^.*first line$/ })).toBeVisible();
	// Closing the view leaves the same editor (never unmounted underneath).
	await page.getByRole('button', { name: 'Close changes' }).tap();
	await expect(page.locator('.ProseMirror')).toContainText('first line extra');
});

test('changes: stash a note, see it, restore it, then revert', async ({ page }) => {
	await changePlan(page);
	await page.getByRole('button', { name: 'Stash all' }).tap();
	await page.getByLabel('Stash plan.md as').fill('try this');
	await page.locator('form.bar').getByRole('button', { name: 'Stash' }).tap();
	await expect(page.getByRole('status')).toContainText('Stashed plan.md as “try this”');
	await expect(page.getByRole('list', { name: 'Changed notes' })).toHaveCount(0);

	// The stash lists its notes with their diff.
	await page.getByRole('list', { name: 'Stashes' }).getByText('try this').tap();
	await expect(page.locator('.dl.add').filter({ hasText: 'first line extra' })).toBeVisible();
	await page.getByRole('button', { name: 'Restore' }).tap();
	await expect(page.getByRole('list', { name: 'Stashes' })).toHaveCount(0);
	await expect(changedFile(page, 'plan.md')).toBeVisible();

	// Revert asks first, then the note (and the open editor) is back to the commit.
	await changedFile(page, 'plan.md').tap();
	await page.getByRole('button', { name: 'Revert', exact: true }).tap();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Revert' }).tap();
	await expect(page.getByText('No note differs from the last commit.')).toBeVisible();
	await page.getByRole('button', { name: 'Close changes' }).tap();
	await expect(page.locator('.ProseMirror')).toContainText('first line');
	await expect(page.locator('.ProseMirror')).not.toContainText('extra');
});

test('changes: a stash can be dropped after confirming', async ({ page }) => {
	await changePlan(page);
	await page.getByRole('button', { name: 'Stash all' }).tap();
	await page.locator('form.bar').getByRole('button', { name: 'Stash' }).tap();
	const stashList = page.getByRole('list', { name: 'Stashes' });
	// No message typed: the stash is named after its notes.
	await stashList.getByText('plan', { exact: true }).tap();
	await page.getByRole('button', { name: 'Drop' }).tap();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Drop' }).tap();
	await expect(stashList).toHaveCount(0);
	await expect(page.getByText('No note differs from the last commit.')).toBeVisible();
});

// --- layout ----------------------------------------------------------------------------

test('note list can be hidden on wide layouts, landscape included', async ({ page }) => {
	test.skip((await layoutOf(page)) === 'phone', 'phones show one pane at a time');
	const btn = page.getByRole('button', { name: 'Toggle note list' });
	expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await expect.poll(() => width(list(page))).toBeGreaterThan(200);
	await btn.tap();
	await expect(list(page)).toHaveAttribute('aria-hidden', 'true');
	await expect.poll(() => width(list(page))).toBeLessThan(2);
	await btn.tap();
	await expect.poll(() => width(list(page))).toBeGreaterThan(200);
});

test('phone: panes slide without remounting the editor', async ({ page }) => {
	test.skip((await layoutOf(page)) !== 'phone', 'phone layout only');
	await openPlan(page);
	await page.evaluate(
		() => ((document.querySelector('.ProseMirror') as HTMLElement).dataset.mark = '1')
	);
	await page.getByRole('button', { name: 'Back' }).tap();
	await expect(editorPane(page)).toBeHidden();
	// Waiting off to the right, still mounted.
	await expect(page.locator('.editor-wrap')).toHaveAttribute('data-pos', 'after');
	await list(page).getByText('Plan', { exact: true }).tap();
	await expect(editorPane(page)).toBeVisible();
	await expect(page.locator('.list-wrap')).toHaveAttribute('data-pos', 'before');
	await expect(page.locator('.ProseMirror[data-mark="1"]')).toHaveCount(1);
});

test('tablet: the AI sheet expands and its scrim closes it', async ({ page }) => {
	test.skip((await layoutOf(page)) !== 'tablet', 'tablet layout only');
	await openPlan(page);
	await openHarness(page);
	const wrap = page.locator('.harness-wrap');
	const half = await wrap.evaluate((el) => el.getBoundingClientRect().height);
	await page.getByRole('button', { name: 'Expand AI sheet' }).tap();
	await expect(page.locator('.body')).toHaveClass(/sheet-expanded/);
	await expect
		.poll(() => wrap.evaluate((el) => el.getBoundingClientRect().height))
		.toBeGreaterThan(half + 200);
	await page.getByRole('button', { name: 'Shrink AI sheet' }).tap();
	await expect(page.locator('.body')).not.toHaveClass(/sheet-expanded/);
	await page
		.getByRole('button', { name: 'Close AI', exact: true })
		.tap({ position: { x: 20, y: 20 } });
	await expect(page.locator('.body')).not.toHaveClass(/harness-open/);
});

test('reduced motion zeroes the motion tokens', async ({ page }) => {
	const dur = () =>
		page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--dur-pane').trim()
		);
	expect(await dur()).toBe('180ms');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	expect(await dur()).toBe('0ms');
});

// --- AI harness ------------------------------------------------------------------------

test('AI harness: several questions in one full-width card', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('multi?');
	await input.press('Enter');

	const panel = harness.getByRole('group', { name: 'Question from the AI' });
	await expect(panel.getByRole('heading', { name: 'Who is it for?' })).toBeVisible();
	expect(await width(panel)).toBeGreaterThan((await width(harness)) * 0.95);
	await expect(panel.getByText('internal readers')).toBeVisible();
	await expect(panel.getByRole('tab')).toHaveCount(2);
	// While a question is open, the prompt makes room for it.
	await expect(harness.locator('textarea')).toHaveCount(0);

	await panel.getByRole('button', { name: /Team/ }).tap();
	await expect(panel.getByRole('heading', { name: 'Which sections?' })).toBeVisible();
	await panel.getByRole('button', { name: /Intro/ }).tap();
	await panel.getByRole('button', { name: /Body/ }).tap();
	await panel.getByRole('button', { name: 'Submit answers' }).tap();

	await expect(harness.getByText(/Who is it for\? → Team/)).toBeVisible();
	await expect(harness.getByText(/Which sections\? → Intro, Body/)).toBeVisible();
	await expect(harness.locator('textarea')).toBeVisible();
});

test('AI harness: replies render Markdown and JSON, never raw HTML', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('md?');
	await input.press('Enter');
	const md = harness.locator('.msg.ai .md');
	await expect(md.locator('h1')).toHaveText('Title');
	await expect(md.locator('li strong')).toHaveText('bold');
	await expect(md.locator('a')).toHaveAttribute('href', 'https://example.com');
	await expect(md.locator('.md-code .j-key')).toHaveText('"a"');
	await expect(md.locator('img')).toHaveCount(0);
	await expect(md).toContainText('<img src=x');
	expect(
		await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)
	).toBeUndefined();
});

test('AI harness: a dropped connection can be retried', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('flaky? context?');
	await input.press('Enter');
	const alert = harness.getByRole('alert');
	await expect(alert).toContainText('Network problem');
	await alert.getByRole('button', { name: 'Retry' }).tap();
	await expect(harness.getByText(/^ctx: /)).toBeVisible();
	await expect(harness.getByRole('alert')).toHaveCount(0);
	// Retry re-ran the same message rather than adding a second one.
	await expect(harness.locator('.msg.you')).toHaveCount(1);
});

test('AI harness: jump to latest after scrolling up', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('long?');
	await input.press('Enter');
	await expect(harness.getByText('line 80', { exact: true })).toBeVisible();
	await harness.locator('.transcript').evaluate((el) => (el.scrollTop = 0));
	const jump = harness.getByRole('button', { name: 'Latest' });
	await expect(jump).toBeVisible();
	await jump.tap();
	await expect(jump).toHaveCount(0);
	await expect(harness.getByText('line 80', { exact: true })).toBeInViewport();
});

test('AI harness: web search turns on from the context panel', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	await harness.locator('.ctx-sum').tap();
	await harness.getByRole('button', { name: /Search off/ }).tap();
	await expect(harness.getByRole('button', { name: /Search on · DuckDuckGo/ })).toBeVisible();
	await expect(harness.locator('.ctx-sum')).toContainText('web');
});

// --- mouse desktop ---------------------------------------------------------------------

async function desktopPage(browser: Browser) {
	const ctx = await browser.newContext({
		viewport: { width: 1280, height: 800 },
		isMobile: false,
		hasTouch: false
	});
	const page = await ctx.newPage();
	await page.addInitScript(installFakeApi);
	await page.goto('/');
	await expect(page.locator('.body')).toHaveAttribute('data-layout', 'desktop');
	return { ctx, page };
}

test('desktop: panes resize by dragging their edges; the list toggles', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser);
	const sep = page.getByRole('separator', { name: 'Resize note list' });
	const before = await width(list(page));
	const b = (await sep.boundingBox())!;
	const y = b.y + 200;
	await page.mouse.move(b.x, y);
	await page.mouse.down();
	await page.mouse.move(b.x + 80, y, { steps: 6 });
	await page.mouse.up();
	await expect.poll(() => width(list(page))).toBeGreaterThan(before + 60);
	// Double-click puts it back.
	await page.mouse.dblclick(b.x + 80, y);
	await expect.poll(() => width(list(page))).toBeLessThan(before + 5);

	await page.keyboard.press('Control+Shift+L');
	await expect(list(page)).toHaveAttribute('aria-hidden', 'true');
	await page.keyboard.press('Control+Shift+L');
	await expect(list(page)).toHaveAttribute('aria-hidden', 'false');
	await ctx.close();
});

test('desktop: notes open editable; the note menu is anchored, not a sheet', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Plan', { exact: true }).click();
	await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
	await list(page).getByRole('button', { name: /Hello/ }).click({ button: 'right' });
	await expect(page.getByRole('menu')).toBeVisible();
	await expect(page.locator('.sheet-root')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('menu')).toHaveCount(0);
	await ctx.close();
});
