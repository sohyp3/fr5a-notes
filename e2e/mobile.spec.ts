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

/** Highlighted stretches as `color:text` (the tint is split into spans; a stretch starts at `md-mark-s`). */
const marks = (page: Page) =>
	page.evaluate(() => {
		const out: string[] = [];
		for (const el of document.querySelectorAll('.ProseMirror .md-mark')) {
			if (el.classList.contains('md-mark-s') || !out.length) {
				const color = [...el.classList].find((c) => /^md-mark-[a-z]{3,}$/.test(c));
				out.push(`${color?.slice(8)}:`);
			}
			out[out.length - 1] += el.textContent;
		}
		return out;
	});
const highlightPicker = (page: Page) => page.getByRole('toolbar', { name: 'Highlight color' });

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

/** Open one of the feature tabs grouped under Settings → Advanced. */
async function openAdvanced(page: Page, tab: 'AI assistant' | 'Git sync' | 'Encryption') {
	const nav = page.getByRole('navigation', { name: 'Settings sections' });
	await nav.getByRole('button', { name: /Advanced/ }).click();
	await page.getByRole('tab', { name: tab, exact: true }).click();
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
	// The frameless desktop controls keep small dots, but their touch targets must be finger-sized.
	for (const name of ['Minimize', 'Maximize', 'Close']) {
		const btn = page.getByRole('button', { name, exact: true });
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

	// The working transcript is device-only: `sessions/device/`, which
	// `sessions/.gitignore` keeps out of sync.
	const sessions = await page.evaluate(() =>
		Object.entries((window as unknown as { __meta: Record<string, string> }).__meta).filter(
			([k]) => k.startsWith('sessions/') && k.endsWith('.md')
		)
	);
	expect(sessions).toHaveLength(1);
	expect(sessions[0][0]).toMatch(/^sessions\/device\/[^/]+\.md$/);
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
	// @/ lists folders only.
	await input.fill('@/');
	await expect(harness.locator('.suggest [role=option]')).toHaveText([/Work\//]);
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

test('tabs on touch: a tab per new note, tap to switch, × to close', async ({ page }) => {
	await openSettings(page);
	await page
		.getByRole('navigation', { name: 'Settings sections' })
		.getByRole('button', { name: /Editor/ })
		.tap();
	await page.getByRole('switch', { name: 'Tabs' }).tap();
	await page.getByRole('button', { name: 'Close settings' }).tap();
	await openPlan(page);
	const tabs = page.getByRole('tablist', { name: 'Open notes' }).getByRole('tab');
	await expect(tabs).toHaveText(['Plan']);
	await page.getByRole('button', { name: 'New note in a new tab' }).tap();
	await expect(tabs).toHaveText(['Plan', 'New note']);
	await page.keyboard.type('Second');
	await expect(tabs).toHaveText(['Plan', 'Second']);
	await tabs.first().tap();
	await expect(page.locator('.ProseMirror')).toContainText('first line');
	await page.getByRole('button', { name: 'Close Plan' }).tap();
	await expect(tabs).toHaveText(['Second']);
	await expect(page.locator('.ProseMirror')).toContainText('Second');
});

test('AI off: no button, no pane', async ({ page }) => {
	await openPlan(page);
	await expect(page.getByRole('button', { name: 'Toggle AI harness' })).toBeVisible();
	// Settings → AI toggle.
	const layout = await layoutOf(page);
	if (layout === 'phone') await page.getByRole('button', { name: 'Back' }).tap();
	if (layout === 'phone') await page.getByRole('button', { name: 'Back' }).tap();
	await openSettings(page);
	await openAdvanced(page, 'AI assistant');
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

test('trash: delete all asks once and empties the list', async ({ page }) => {
	await openFolder(page, /^Trash/);
	await list(page).getByRole('button', { name: 'Delete all' }).tap();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toContainText('Delete all forever?');
	await dialog.getByRole('button', { name: 'Delete all' }).tap();
	await expect(list(page).getByText('Trash is empty')).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { __deleted: string[] }).__deleted))
		.toEqual(['.fr5a_trash/old.md']);
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

test('wide layouts: the list slides, the note wraps once; Animations off snaps', async ({
	page
}) => {
	test.skip((await layoutOf(page)) !== 'desktop', 'three-pane layout only');
	await list(page).locator('.card').first().tap();
	await expect(page.locator('.ProseMirror')).toBeVisible();
	const btn = page.getByRole('button', { name: 'Toggle note list' });
	/** Per frame for ~0.9s: list width, text column width, the scroll's frozen width. */
	const frames = () =>
		page.evaluate(
			() =>
				new Promise<{ list: number; col: number; frozen: string }[]>((done) => {
					const out: { list: number; col: number; frozen: string }[] = [];
					const t0 = performance.now();
					const tick = (): void => {
						const scroll = document.querySelector('.editor-pane .scroll') as HTMLElement;
						out.push({
							list: Math.round(document.querySelector('.list-wrap')!.getBoundingClientRect().width),
							col: (document.querySelector('.ProseMirror') as HTMLElement).offsetWidth,
							frozen: scroll.style.width
						});
						if (performance.now() - t0 < 900) requestAnimationFrame(tick);
						else done(out);
					};
					requestAnimationFrame(tick);
				})
		);
	const colBefore = await page
		.locator('.ProseMirror')
		.evaluate((el) => (el as HTMLElement).offsetWidth);
	const hiding = frames();
	await btn.tap();
	const hide = await hiding;
	const moving = hide.filter((f) => f.list > 0 && f.list < 300);
	// Slid over several frames, the text column held at its old width meanwhile.
	expect(moving.length).toBeGreaterThan(3);
	for (const f of moving) {
		expect(f.col).toBe(colBefore);
		expect(f.frozen).not.toBe('');
	}
	// Settled: unfrozen, the column takes the room.
	expect(hide.at(-1)).toMatchObject({ list: 0, frozen: '' });
	expect(hide.at(-1)!.col).toBeGreaterThan(colBefore);
	await btn.tap();
	await expect.poll(() => width(list(page))).toBeGreaterThan(200);

	// Settings → Appearance → Animations off: the list snaps.
	await openSettings(page);
	await page
		.getByRole('navigation', { name: 'Settings sections' })
		.getByRole('button', { name: /Appearance/ })
		.tap();
	await page.getByRole('switch', { name: 'Animations' }).tap();
	await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
	await page.getByRole('button', { name: 'Close settings' }).tap();
	await expect(page.locator('.view-overlay')).toHaveCount(0);
	const snapping = frames();
	await btn.tap();
	const snap = await snapping;
	expect(snap.filter((f) => f.list > 0 && f.list < 300)).toHaveLength(0);
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

/** A CDP touch drag from a screen point; `hold` ms of rest before lifting (no flick). */
async function touchDrag(page: Page, x: number, y: number, dx: number, dy: number, hold = 0) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
	for (let i = 1; i <= 10; i++)
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }]
		});
	if (hold) await page.waitForTimeout(hold);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('phone: a swipe from the left edge goes back; a short held drag springs back', async ({
	page
}) => {
	test.skip((await layoutOf(page)) !== 'phone', 'phone layout only');
	await openPlan(page);
	await page.evaluate(
		() => ((document.querySelector('.ProseMirror') as HTMLElement).dataset.mark = '1')
	);
	// Too short and placed (no throw): the note stays.
	await touchDrag(page, 4, 420, 60, 0, 200);
	await expect(page.locator('.editor-wrap')).toHaveAttribute('data-pos', 'current');
	await expect
		.poll(() => page.locator('.editor-wrap').evaluate((el) => el.style.transform))
		.toBe('');
	// A real swipe: back to the list, the same editor kept.
	await touchDrag(page, 4, 420, 300, 0);
	await expect(page.locator('.list-wrap')).toHaveAttribute('data-pos', 'current');
	await expect(list(page)).toBeVisible();
	await expect(page.locator('.ProseMirror[data-mark="1"]')).toHaveCount(1);
	await expect
		.poll(() => page.locator('.editor-wrap').evaluate((el) => el.style.transform))
		.toBe('');
});

test('phone: a sheet drags down to close without running a row', async ({ page }) => {
	test.skip((await layoutOf(page)) !== 'phone', 'phone layout only');
	await openPlan(page);
	await page.getByRole('button', { name: 'More actions' }).tap();
	const sheet = page.locator('.sheet[role=menu]');
	await expect(sheet).toBeVisible();
	await page.waitForTimeout(400); // let it rise
	const b = (await sheet.boundingBox())!;
	await touchDrag(page, b.x + b.width / 2, b.y + 60, 0, 320);
	await expect(page.locator('.sheet[role=menu]')).toHaveCount(0);
	await expect(page.locator('.editor-wrap')).toHaveAttribute('data-pos', 'current');
	expect(await readFake(page, 'Work/plan.md')).toBe('# Plan\n\nfirst line');
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

test('tablet: the folders drawer and the AI sheet take turns; the sidebar fills the drawer', async ({
	page
}) => {
	test.skip((await layoutOf(page)) !== 'tablet', 'tablet layout only');
	await openPlan(page);
	await openHarness(page);
	await page.getByRole('button', { name: 'Open folders' }).tap();
	await expect(page.locator('.body')).not.toHaveClass(/harness-open/);
	await expect.poll(() => leftEdge(page, '.sidebar-wrap')).toBeGreaterThan(200);
	// No bare strip between the sidebar and the drawer's edge.
	expect(await width(page.locator('.sidebar'))).toBeCloseTo(await width(sidebar(page)), 0);
});

test('AI harness: the prompt mark, a one-line draft and Send share one line', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	await harness.locator('textarea').fill('hello');
	const mid = (loc: Locator) =>
		loc.evaluate((el) => {
			const r = el.getBoundingClientRect();
			return r.top + r.height / 2;
		});
	const send = await mid(harness.getByRole('button', { name: 'Send' }));
	expect(Math.abs((await mid(harness.locator('textarea'))) - send)).toBeLessThanOrEqual(1);
	expect(Math.abs((await mid(harness.locator('.ps1'))) - send)).toBeLessThanOrEqual(1);
});

test('settings show the app version', async ({ page }) => {
	await openSettings(page);
	await expect(page.locator('.settings .version')).toHaveText(/^fr5a \d+\.\d+\.\d+/);
});

test('reduced motion zeroes the motion tokens', async ({ page }) => {
	const dur = () =>
		page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--dur-pane').trim()
		);
	expect(await dur()).toBe('220ms');
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

test('AI harness: a long question card keeps its buttons on a short pane', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('many?');
	await input.press('Enter');
	const panel = harness.getByRole('group', { name: 'Question from the AI' });
	await expect(panel.getByRole('heading', { name: /^Question 1:/ })).toBeVisible();
	const inside = async () => {
		const pane = (await harness.boundingBox())!;
		for (const el of [
			panel.getByRole('tab').first(),
			panel.getByRole('button', { name: 'Stop' })
		]) {
			const b = (await el.boundingBox())!;
			expect(b.y).toBeGreaterThanOrEqual(pane.y);
			expect(b.y + b.height).toBeLessThanOrEqual(pane.y + pane.height + 1);
		}
	};
	await inside();
	// Context details open and the window shrinks (the keyboard comes up).
	await harness.locator('.ctx-sum').tap();
	const size = page.viewportSize()!;
	await page.setViewportSize({ width: size.width, height: Math.round(size.height * 0.6) });
	await expect(panel.getByRole('button', { name: 'Stop' })).toBeInViewport();
	await inside();
	// The transcript row shows the questions, not their JSON.
	await expect(harness.locator('.tool .args')).toHaveText(/^Question 1: which/);
});

test('AI harness: Stop ends a run whose request never answers', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('hang?');
	await input.press('Enter');
	await expect(harness.locator('.msg.ai.streaming')).toBeVisible();
	await harness.getByRole('button', { name: 'Stop' }).tap();
	await expect(harness.locator('.note.stopped')).toBeVisible();
	await expect(harness.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('AI harness: Retry after Stop brings back what the run was waiting on', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('help me with tone');
	await input.press('Enter');
	await harness.getByRole('button', { name: 'Casual' }).tap();
	const review = harness.getByRole('group', { name: 'Review change' });
	await expect(review).toBeVisible();
	await review.getByRole('button', { name: 'Stop' }).tap();
	await harness.locator('.note.stopped').getByRole('button', { name: 'Retry' }).tap();
	// The change comes back for review; the answer given before stays, not asked again.
	await expect(review).toBeVisible();
	await expect(harness.getByRole('heading', { name: 'Which tone?' })).toHaveCount(0);
	await expect(harness.locator('.tool')).toHaveCount(2);
	await expect(harness.locator('.note.stopped')).toHaveCount(0);
	await review.getByRole('button', { name: 'Apply' }).tap();
	await expect(harness.getByText('Done: Applied to Work/plan.md (append)')).toBeVisible();
	await expect(harness.locator('.msg.you')).toHaveCount(1);
});

test('AI harness: Retry after a refused request keeps the answers', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('filter?');
	await input.press('Enter');
	await expect(harness.getByRole('heading', { name: 'Which tone?' })).toBeVisible();
	await harness.getByRole('button', { name: 'Casual' }).tap();
	const alert = harness.getByRole('alert');
	await expect(alert).toContainText("Blocked by the provider's content filter");
	await alert.getByRole('button', { name: 'Retry' }).tap();
	// Carried on from the answer (its result left out), not from the first message.
	await expect(harness.getByText(/^Done: Withheld/)).toBeVisible();
	await expect(harness.getByRole('heading', { name: 'Which tone?' })).toHaveCount(0);
	await expect(harness.locator('.tool')).toHaveCount(1);
	await expect(harness.getByRole('alert')).toHaveCount(0);
	await expect(harness.locator('.msg.you')).toHaveCount(1);
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

test('AI harness: Exa parameters appear in the context drawer', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	await harness.locator('.ctx-sum').tap();
	await harness.getByRole('button', { name: 'Settings…' }).tap();
	await page.getByRole('radio', { name: /Exa/ }).tap();
	await page.getByLabel('Search mode').selectOption('deep');
	await page.getByLabel('Results', { exact: true }).fill('9');
	await page.getByLabel('Results', { exact: true }).blur();
	await page.getByRole('button', { name: 'Close settings' }).tap();
	const params = harness.getByLabel('Exa search parameters');
	if (!(await params.isVisible())) await harness.locator('.ctx-sum').tap();
	await expect(params).toContainText('deep');
	await expect(params).toContainText('9');
	await expect(params).toContainText('highlights · 600 chars');
});

test('AI harness: each tab keeps its own unsent draft', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('first tab draft');
	await harness.getByRole('button', { name: 'New session', exact: true }).tap();
	await expect(input).toHaveValue('');
	await input.fill('second tab draft');

	await harness.locator('.tab-name').first().tap();
	await expect(input).toHaveValue('first tab draft');
	await harness.locator('.tab-name').nth(1).tap();
	await expect(input).toHaveValue('second tab draft');
});

test('AI harness: closing an unchanged tab does not save it again', async ({ page }) => {
	await openPlan(page);
	await page.getByRole('button', { name: 'Toggle AI harness' }).click();
	const harness = page.getByRole('region', { name: 'AI harness' });
	await expect(harness).toBeVisible();
	await harness.locator('textarea').fill('md?');
	await harness.locator('textarea').press('Enter');
	await expect(harness.locator('.msg.ai .md h1')).toHaveText('Title');
	const sessionWrites = () =>
		page.evaluate(
			() =>
				(window as unknown as { __metaWrites: string[] }).__metaWrites.filter((p) =>
					p.startsWith('sessions/')
				).length
		);
	await expect.poll(sessionWrites).toBeGreaterThan(0);
	const before = await sessionWrites();

	await harness.getByRole('button', { name: 'Close tab' }).tap();
	await expect(harness.getByRole('tab', { selected: true })).toContainText('New session');
	await page.waitForTimeout(500);
	expect(await sessionWrites()).toBe(before);
});

// --- mouse desktop ---------------------------------------------------------------------

/** A mouse window; `seed` notes are written before the app boots (and again on reloads). */
async function desktopPage(browser: Browser, seed: Record<string, string> = {}) {
	const ctx = await browser.newContext({
		viewport: { width: 1280, height: 800 },
		isMobile: false,
		hasTouch: false
	});
	const page = await ctx.newPage();
	await page.addInitScript(installFakeApi);
	await page.addInitScript((notes) => {
		const api = (window as unknown as { api: { writeNote(id: string, text: string): void } }).api;
		for (const [id, text] of Object.entries(notes)) api.writeNote(id, text);
	}, seed);
	await page.goto('/');
	await expect(page.locator('.body')).toHaveAttribute('data-layout', 'desktop');
	return { ctx, page };
}

test('desktop: a long note opens at its top, caret at the end', async ({ browser }) => {
	const body = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join('\n\n');
	const { ctx, page } = await desktopPage(browser, { 'long.md': `# Long note\n\n${body}` });
	await list(page).getByText('Long note', { exact: true }).click();
	await expect(page.locator('.ProseMirror')).toBeFocused();
	await page.waitForTimeout(300);
	expect(await page.locator('.editor-pane .scroll').evaluate((el) => el.scrollTop)).toBe(0);
	await ctx.close();
});

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

test('desktop: search clears with its X or Esc; New note stays visible in a narrow list', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	const search = page.getByRole('textbox', { name: 'Search notes' });
	const clear = page.getByRole('button', { name: 'Clear search' });
	await expect(clear).toHaveCount(0);
	await search.pressSequentially('hello', { delay: 20 });
	await expect(search).toBeFocused();
	await expect(search).toHaveValue('hello');
	await clear.click();
	await expect(search).toHaveValue('');
	await expect(clear).toHaveCount(0);
	await expect(search).toBeFocused();
	await search.fill('hello');
	await search.press('Escape');
	await expect(search).toHaveValue('');

	// Narrowest list: the search field shrinks, the button keeps its place.
	const sep = page.getByRole('separator', { name: 'Resize note list' });
	const b = (await sep.boundingBox())!;
	await page.mouse.move(b.x, b.y + 200);
	await page.mouse.down();
	await page.mouse.move(b.x - 300, b.y + 200, { steps: 6 });
	await page.mouse.up();
	await search.fill('a long search for something');
	const listBox = (await list(page).boundingBox())!;
	for (const btn of [list(page).getByRole('button', { name: 'New note' }), clear]) {
		const box = (await btn.boundingBox())!;
		expect(box.width).toBeGreaterThan(20);
		expect(box.x + box.width).toBeLessThanOrEqual(listBox.x + listBox.width);
	}
	await ctx.close();
});

test('desktop: find in note highlights matches and steps through them', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser);
	await openHello(page);
	await page.keyboard.press('Control+f');
	const find = page.getByRole('textbox', { name: 'Find text' });
	await find.pressSequentially('ll', { delay: 30 });
	await expect(find).toBeFocused();
	await expect(find).toHaveValue('ll');
	await find.fill('l');
	await expect(page.locator('.note-search-hit')).toHaveCount(3);
	await expect(page.getByText('1 / 3', { exact: true })).toBeVisible();
	await find.press('Enter');
	await expect(page.getByText('2 / 3', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Previous match' }).click();
	await expect(page.getByText('1 / 3', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Close find' }).click();
	await expect(page.locator('.note-search-hit')).toHaveCount(0);
	await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
	await ctx.close();
});

test('desktop: exports the open note as PDF from its file menu', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser);
	await openHello(page);
	await page.getByRole('button', { name: /^File: hello\.md/ }).click();
	await page.getByRole('menuitem', { name: 'Export as PDF…' }).click();
	await expect(page.getByRole('status')).toHaveText('PDF exported');
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { __pdfExports: string[] }).__pdfExports))
		.toEqual(['hello.md']);
	await page.emulateMedia({ media: 'print' });
	await expect(page.locator('.titlebar')).toBeHidden();
	await expect(page.locator('.notelist')).toBeHidden();
	await expect(page.locator('.ProseMirror')).toBeVisible();
	await ctx.close();
});

test('desktop: Vim slash search repeats with n and N', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Settings sections' })
		.getByRole('button', { name: /Editor/ })
		.click();
	await page.getByRole('switch', { name: 'Vim motions' }).click();
	await page.getByRole('button', { name: 'Close settings' }).click();
	await openHello(page);
	await expect(page.locator('.vim-badge')).toHaveText('NORMAL');
	await page.keyboard.press('/');
	const find = page.getByRole('textbox', { name: 'Find text' });
	await find.fill('l');
	await find.press('Enter');
	await expect(find).toHaveCount(0);
	const active = () =>
		page.evaluate(() =>
			[...document.querySelectorAll('.note-search-hit')].findIndex((el) =>
				el.classList.contains('active')
			)
		);
	await expect.poll(active).toBe(0);
	await page.keyboard.press('n');
	await expect.poll(active).toBe(1);
	await page.keyboard.press('Shift+n');
	await expect.poll(active).toBe(0);
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

test('desktop: an AI tab keeps writing to the note its run started with', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Plan', { exact: true }).click();
	await page.getByRole('button', { name: 'Toggle AI harness' }).click();
	const harness = page.getByRole('region', { name: 'AI harness' });
	await expect(harness).toBeVisible();
	await harness.locator('textarea').fill('help me with tone');
	await harness.locator('textarea').press('Enter');
	await expect(harness.getByRole('heading', { name: 'Which tone?' })).toBeVisible();

	// A second AI tab and another open note must not redirect the first run.
	await harness.getByRole('button', { name: 'New session', exact: true }).click();
	await harness.locator('textarea').fill('a different topic');
	await harness.locator('.tab-name').first().click();
	await list(page).getByText('Hello', { exact: true }).click();
	await harness.getByRole('button', { name: 'Casual' }).click();
	const review = harness.getByRole('group', { name: 'Review change' });
	await expect(review).toContainText('append → Work/plan.md');
	await review.getByRole('button', { name: 'Apply' }).click();
	await expect(harness.getByText('Done: Applied to Work/plan.md (append)')).toBeVisible();

	const contents = await page.evaluate(async () => {
		const api = (window as unknown as { api: FakeApi }).api;
		return Promise.all([api.readNote('Work/plan.md'), api.readNote('hello.md')]);
	});
	expect(contents[0]).toContain('AI line');
	expect(contents[1]).toBe('# Hello\n\nworld');
	await harness.locator('.tab-name').nth(1).click();
	await expect(harness.locator('textarea')).toHaveValue('a different topic');
	await ctx.close();
});

// --- move / rename, privacy, tables, saved chats ------------------------------------

type FakeApi = {
	listNotes(): Promise<{ id: string }[]>;
	readNote(id: string): Promise<string>;
	writeNote(id: string, content: string): Promise<void>;
	saveAsset?(path: string, data: Uint8Array): Promise<string>;
};
const fakeApi = 'api' as const;

const noteIds = (page: Page) =>
	page.evaluate(async (k) => {
		const api = (window as unknown as Record<typeof k, FakeApi>)[k];
		return (await api.listNotes()).map((n) => n.id).sort();
	}, fakeApi);

const readFake = (page: Page, id: string) =>
	page.evaluate(([k, id]) => (window as unknown as Record<string, FakeApi>)[k].readNote(id), [
		fakeApi,
		id
	] as const);

const writeFake = (page: Page, id: string, text: string) =>
	page.evaluate(
		([k, id, text]) => (window as unknown as Record<string, FakeApi>)[k].writeNote(id, text),
		[fakeApi, id, text] as const
	);

/** Hold a finger on `target` until its menu opens. */
async function longPress(page: Page, target: Locator) {
	const box = (await target.boundingBox())!;
	const cdp = await page.context().newCDPSession(page);
	const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
	await page.waitForTimeout(750);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect(page.getByRole('menu')).toBeVisible();
}

test('a note is renamed and moved from its menu', async ({ page }) => {
	await openFolder(page, /^All Notes/);
	await longPress(page, list(page).getByRole('button', { name: /Hello/ }));
	await page.getByRole('menuitem', { name: 'Rename…' }).tap();
	const field = page.getByRole('dialog').getByRole('textbox');
	await expect(field).toHaveValue('hello');
	await field.fill('Greetings');
	await field.press('Enter');
	await expect.poll(() => noteIds(page)).toEqual(['Greetings.md', 'Work/plan.md']);
	await expect(page.getByRole('dialog')).toHaveCount(0);

	await longPress(page, list(page).getByRole('button', { name: /Hello/ }));
	await page.getByRole('menuitem', { name: 'Move to…' }).tap();
	const picker = page.getByRole('dialog', { name: /Move/ });
	await expect(picker.getByRole('option', { name: /Notes/ })).toBeDisabled();
	await picker.getByRole('option', { name: /Work/ }).tap();
	await expect.poll(() => noteIds(page)).toEqual(['Work/Greetings.md', 'Work/plan.md']);
	await expect(page.locator('.notice')).toHaveText('Moved to Work');
});

test('desktop: renaming a folder keeps the open note; notes drag onto folders', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page)
		.getByRole('button', { name: /^Work \d+$/ })
		.click();
	await list(page).getByText('Plan', { exact: true }).click();
	await sidebar(page)
		.getByRole('button', { name: /^Work \d+$/ })
		.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Rename…' }).click();
	const field = page.getByRole('dialog').getByRole('textbox');
	await field.fill('Projects');
	await field.press('Enter');
	await expect(page.locator('.editor-head .crumb')).toContainText('Projects /');
	await expect(page.locator('.ProseMirror')).toContainText('first line');
	expect(await noteIds(page)).toEqual(['Projects/plan.md', 'hello.md']);

	// Typing after the rename saves to the new path.
	await page.locator('.ProseMirror p', { hasText: 'first line' }).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' more');
	await expect.poll(() => readFake(page, 'Projects/plan.md')).toContain('first line more');

	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page)
		.getByRole('button', { name: /Hello/ })
		.dragTo(sidebar(page).getByRole('button', { name: /^Projects \d+$/ }));
	await expect.poll(() => noteIds(page)).toEqual(['Projects/hello.md', 'Projects/plan.md']);
	await ctx.close();
});

test('desktop: hiding a folder or a note from cloud AI shows where it applies', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page)
		.getByRole('button', { name: /^Work \d+$/ })
		.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Hide from cloud AI' }).click();
	await expect(sidebar(page).locator('.folder-row .shield')).toHaveCount(1);
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	const shields = list(page).getByRole('img', { name: 'Hidden from cloud AI' });
	await expect(shields).toHaveCount(1);

	// One note on its own: a marker in the file.
	await list(page).getByRole('button', { name: /Hello/ }).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Hide from cloud AI' }).click();
	await expect(shields).toHaveCount(2);
	expect(await readFake(page, 'hello.md')).toBe('<!-- ai: local -->\n# Hello\n\nworld');

	// Settings → AI lists both, with what each folder inherits.
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Settings sections' })
		.getByRole('button', { name: /AI/ })
		.click();
	const tree = page.getByRole('group', { name: 'Folders hidden from cloud AI' });
	await expect(tree.locator('.prow.on')).toHaveText(/Work.*Hidden/);
	await expect(page.locator('.psum')).toContainText('2 of 2 notes hidden');
	await expect(page.locator('.single')).toContainText('hello.md');
	await ctx.close();
});

test('tables render in notes; in edit mode a cell opens the source', async ({ page }) => {
	await writeFake(page, 'hello.md', '# Hello\n\n| a | b |\n|---|--:|\n| **1** | 2 |\n\nend');
	await openFolder(page, /^All Notes/);
	await list(page).getByRole('button', { name: /Hello/ }).tap();
	const table = page.locator('.md-table');
	await expect(table.locator('th')).toHaveText(['a', 'b']);
	await expect(table.locator('td strong')).toHaveText('1');
	await expect(table.locator('td').nth(1)).toHaveCSS('text-align', 'right');
	// View mode (touch default): the table stays rendered.
	await table.locator('td').nth(1).tap();
	await expect(table).toBeVisible();

	await edit(page);
	await page.locator('.md-table td').nth(1).tap();
	await expect(page.locator('.md-table')).toHaveCount(0);
	await expect(page.locator('.ProseMirror p.md-trow')).toHaveCount(3);
	await page.keyboard.type('3');
	expect(await editorText(page)).toContain('| **1** | 23 |');
});

test('desktop: pasting spreadsheet cells makes a Markdown table', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Hello', { exact: true }).click();
	await page.keyboard.press('Control+End');
	await page.evaluate(() => {
		const dt = new DataTransfer();
		dt.setData('text/plain', '\tLite\tCore\nHero\t—\t1 reel\nStories\t3×/week\tdaily\n');
		document
			.querySelector('.ProseMirror')!
			.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
			);
	});
	await expect(page.locator('.md-table th')).toHaveText(['', 'Lite', 'Core']);
	expect(await editorText(page)).toContain(
		'world\n\n|         | Lite    | Core   |\n| ------- | ------- | ------ |\n| Hero    | —       | 1 reel |'
	);
	await ctx.close();
});

test('AI harness: a chat is saved to notes, updated, and forked', async ({ page }) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('md?');
	await input.press('Enter');
	await expect(harness.locator('.msg.ai .md h1')).toHaveText('Title');

	await harness.getByRole('button', { name: 'Session actions' }).tap();
	await page.getByRole('menuitem', { name: /Save to notes/ }).tap();
	await expect(harness.locator('.toast')).toHaveText('Saved to .fr5a/chats/md-.md');
	const saved = await readFake(page, '.fr5a/chats/md-.md');
	expect(saved).toContain('# md?\n\n*AI chat · ');
	expect(saved).toContain('> **You:** md?\n\n# Title');
	// The `.fr5a/sessions/` copy stays, and remembers the note.
	const sessions = await page.evaluate(() =>
		Object.entries((window as unknown as { __meta: Record<string, string> }).__meta).filter(
			([k]) => k.startsWith('sessions/') && k.endsWith('.md')
		)
	);
	expect(sessions[0][1]).toContain('saved: .fr5a/chats/md-.md');

	await harness.getByRole('button', { name: 'Session actions' }).tap();
	await page.getByRole('menuitem', { name: /Update saved note/ }).tap();
	await expect(harness.locator('.toast')).toHaveText('.fr5a/chats/md-.md is up to date');

	await harness.getByRole('button', { name: 'Session actions' }).tap();
	await page.getByRole('menuitem', { name: 'Fork conversation' }).tap();
	await expect(harness.getByRole('tab')).toHaveCount(2);
	await expect(harness.getByRole('tab', { selected: true })).toContainText('md? (fork)');
	await expect(harness.locator('.msg.ai .md h1')).toHaveText('Title');
});

test('desktop: a narrow window keeps room for the editor beside the AI pane', async ({
	browser
}) => {
	const ctx = await browser.newContext({
		viewport: { width: 1024, height: 640 },
		isMobile: false,
		hasTouch: false
	});
	const page = await ctx.newPage();
	await page.addInitScript(installFakeApi);
	await page.goto('/');
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Plan', { exact: true }).click();
	await page.getByRole('button', { name: 'Toggle AI harness' }).click();
	await expect(page.getByRole('region', { name: 'AI harness' })).toBeVisible();
	// The sidebar steps aside and the AI pane narrows; the editor stays usable.
	await expect.poll(() => width(editorPane(page))).toBeGreaterThanOrEqual(300);
	// The pane itself narrows too: none of it is cut off at the window's edge.
	await expect
		.poll(() =>
			page
				.getByRole('region', { name: 'AI harness' })
				.evaluate((el) => el.getBoundingClientRect().right)
		)
		.toBeLessThanOrEqual(1024);
	// Its header buttons too, as the window gets narrower.
	const right = (name: string) =>
		page
			.getByRole('button', { name, exact: true })
			.evaluate((el) => el.getBoundingClientRect().right);
	for (const w of [1024, 820, 720]) {
		await page.setViewportSize({ width: w, height: 640 });
		for (const name of ['New session', 'Past sessions', 'Close AI pane'])
			await expect.poll(() => right(name), `${name} at ${w}px`).toBeLessThanOrEqual(w);
	}
	await page.setViewportSize({ width: 1024, height: 640 });
	await page.getByRole('button', { name: 'Close AI pane' }).click();
	await expect.poll(() => width(sidebar(page))).toBeGreaterThan(150);
	await ctx.close();
});

test('desktop: encryption — off by default, then a key, an encrypted note, lock and unlock', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	// Off: no lock button, no Encrypt item.
	await expect(page.getByRole('button', { name: /encrypted notes/ })).toHaveCount(0);
	await list(page).getByRole('button', { name: /Hello/ }).click({ button: 'right' });
	await expect(page.getByRole('menuitem', { name: 'Encrypt' })).toHaveCount(0);
	await page.keyboard.press('Escape');

	// Switch it on and make a key.
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await openAdvanced(page, 'Encryption');
	await page.getByRole('switch', { name: 'Encrypt notes' }).click();
	await page.getByLabel('Passphrase', { exact: true }).fill('correct horse');
	await page.getByLabel('Repeat passphrase').fill('correct horse');
	await page.getByRole('button', { name: 'Create key' }).click();
	await expect(page.getByText('Unlocked', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Close settings' }).click();

	// Encrypt Hello: the file becomes ciphertext, the list and editor still read it.
	await list(page).getByRole('button', { name: /Hello/ }).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Encrypt' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Encrypt' }).click();
	await expect.poll(() => readFake(page, 'hello.md')).toContain('-----BEGIN PGP MESSAGE-----');
	expect(await readFake(page, 'hello.md')).not.toContain('world');
	await list(page).getByText('Hello', { exact: true }).click();
	await expect(page.locator('.ProseMirror')).toContainText('world');

	// Lock: the note closes and the card shows only the file name.
	await page.getByRole('button', { name: 'Lock encrypted notes' }).click();
	await expect(page.locator('.ProseMirror')).toHaveCount(0);
	await expect(list(page).getByText('hello', { exact: true })).toBeVisible();

	// Opening it asks for the passphrase; a wrong one is refused.
	await list(page).getByText('hello', { exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Unlock encrypted notes' });
	await dialog.getByLabel('Key passphrase').fill('wrong');
	await dialog.getByRole('button', { name: 'Unlock' }).click();
	await expect(dialog.getByText('Wrong passphrase.')).toBeVisible();
	await dialog.getByLabel('Key passphrase').fill('correct horse');
	await dialog.getByRole('button', { name: 'Unlock' }).click();
	await expect(page.locator('.ProseMirror')).toContainText('world');

	// Unlocked, the AI may read it (Settings → Encryption): offered as a mention.
	await page.getByRole('button', { name: 'Toggle AI harness' }).click();
	const input = page.getByRole('region', { name: 'AI harness' }).getByRole('textbox');
	await input.fill('@');
	await expect(page.getByRole('option', { name: /Plan/ })).toBeVisible();
	await expect(page.getByRole('option', { name: /Hello/ })).toBeVisible();
	await input.fill('');
	await page.getByRole('button', { name: 'Toggle AI harness' }).click();

	// Switching it off locks, closes the note and takes the controls away.
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await openAdvanced(page, 'Encryption');
	await page.getByRole('switch', { name: 'Encrypt notes' }).click();
	await expect(page.getByRole('button', { name: 'Create key' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Close settings' }).click();
	await expect(page.locator('.ProseMirror')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /encrypted notes/ })).toHaveCount(0);
	await list(page).getByText('hello', { exact: true }).click();
	await expect(page.getByText(/Turn on encryption in Settings/)).toBeVisible();
	await ctx.close();
});

test('encryption on touch: a note encrypted while locked opens after the passphrase', async ({
	page
}) => {
	await openSettings(page);
	await openAdvanced(page, 'Encryption');
	await page.getByRole('switch', { name: 'Encrypt notes' }).tap();
	await page.getByLabel('Passphrase', { exact: true }).fill('correct horse');
	await page.getByLabel('Repeat passphrase').fill('correct horse');
	await page.getByRole('button', { name: 'Create key' }).tap();
	await page.getByRole('button', { name: 'Lock now' }).tap();
	await expect(page.getByText('Locked', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Close settings' }).tap();

	// Encrypting needs only the public key: it works while locked.
	await openFolder(page, /^All Notes/);
	await longPress(page, list(page).getByRole('button', { name: /Hello/ }));
	await page.getByRole('menuitem', { name: 'Encrypt' }).tap();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Encrypt' }).tap();
	await expect.poll(() => readFake(page, 'hello.md')).toContain('-----BEGIN PGP MESSAGE-----');
	const card = list(page).getByRole('button', { name: /hello/ });
	await expect(card).toContainText('Encrypted');

	await card.tap();
	const dialog = page.getByRole('dialog', { name: 'Unlock encrypted notes' });
	await dialog.getByLabel('Key passphrase').fill('correct horse');
	await dialog.getByRole('button', { name: 'Unlock' }).tap();
	await expect(page.locator('.ProseMirror')).toContainText('world');
	await expect(list(page).getByText('Hello', { exact: true })).toBeAttached();
});

test('desktop: a folder can be hidden from the sidebar, shown again, and deleted', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	const work = sidebar(page).getByRole('button', { name: /^Work \d+$/ });
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await expect(list(page).getByText('Plan', { exact: true })).toBeVisible();

	// Hidden: out of the tree and All Notes, still on disk.
	await work.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Hide from sidebar' }).click();
	await expect(work).toHaveCount(0);
	await expect(list(page).getByText('Plan', { exact: true })).toHaveCount(0);
	expect(await noteIds(page)).toContain('Work/plan.md');

	// Settings → General lists it: Open browses it, Show brings it back.
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'General' }).click();
	await page.getByRole('button', { name: 'Open', exact: true }).click();
	await expect(list(page).getByText('Plan', { exact: true })).toBeVisible();
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Show', exact: true }).click();
	await page.getByRole('button', { name: 'Close settings' }).click();
	await expect(work).toBeVisible();

	// Delete: asks first, then the folder's notes go to the trash.
	await work.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
	const confirm = page.getByRole('alertdialog');
	await expect(confirm).toContainText('1 note');
	await confirm.getByRole('button', { name: 'Move to Trash' }).click();
	await expect(work).toHaveCount(0);
	expect(await noteIds(page)).toEqual(['hello.md']);
	await sidebar(page).getByRole('button', { name: /Trash/ }).click();
	await expect(list(page).getByText('Plan', { exact: true })).toBeVisible();
	await ctx.close();
});

test('desktop: saved chats list under AI chats; Storage moves old files into .fr5a', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser, {
		'.fr5a/chats/talk.md': '# Talk\n\n*AI chat · 2026-01-02*\n\n> **You:** hi',
		'AI chats/old.md': '# Old chat\n\n*AI chat · 2025-12-01*\n\nhello',
		'AI chats/mine.md': '# Mine\n\nnot a chat',
		'pics.md': '# Pics\n\n![A cat](assets/cat.png)\nend',
		'links.md': '# Links\n\n[the old chat](AI%20chats/old.md)'
	});
	await page.evaluate(async (k) => {
		const api = (window as unknown as Record<string, FakeApi>)[k];
		await api.saveAsset!('assets/cat.png', new Uint8Array([1, 2]));
	}, fakeApi);
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await expect(list(page).getByText('Pics', { exact: true })).toBeVisible();
	// Saved chats stay out of All Notes and the folder tree…
	await expect(list(page).getByText('Talk', { exact: true })).toHaveCount(0);
	await expect(sidebar(page).getByRole('button', { name: /^\.fr5a/ })).toHaveCount(0);
	// …and have their own entry.
	const chats = sidebar(page).getByTitle('Chats saved with “Save to notes”');
	await expect(chats).toHaveText(/AI chats\s*1/);
	await chats.click();
	await expect(list(page).getByText('Talk', { exact: true })).toBeVisible();
	await expect(list(page).getByText('Pics', { exact: true })).toHaveCount(0);
	await list(page).getByText('Talk', { exact: true }).click();
	await expect(page.locator('.ProseMirror')).toContainText('hi');

	// Settings → General offers the move, with counts; only chats move, not other notes.
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'General' }).click();
	const card = page.getByRole('region', { name: 'Storage' });
	await expect(card).toContainText('Move 1 image and 1 saved chat into .fr5a');
	await card.getByRole('button', { name: 'Move' }).click();
	await expect(card).toHaveCount(0);
	expect(await readFake(page, 'pics.md')).toBe('# Pics\n\n![A cat](.fr5a/assets/cat.png)\nend');
	const ids = await noteIds(page);
	expect(ids).toContain('.fr5a/chats/old.md');
	expect(ids).toContain('AI chats/mine.md');
	expect(ids).not.toContain('AI chats/old.md');
	const assets = await page.evaluate(() => (window as unknown as { __assets: object }).__assets);
	expect(Object.keys(assets)).toEqual(['.fr5a/assets/cat.png']);
	expect(await readFake(page, 'links.md')).toBe('# Links\n\n[the old chat](.fr5a/chats/old.md)');
	await page.getByRole('button', { name: /Links & maps/ }).click();
	await page.getByRole('switch', { name: 'Note links & graph', exact: true }).click();
	await page.getByRole('button', { name: 'Close settings' }).click();
	await expect(chats).toHaveText(/AI chats\s*2/);
	// A link to a saved chat still opens it.
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Links', { exact: true }).click();
	await page.locator('.md-note-link').click({ modifiers: ['Control'] });
	await expect(page.locator('.ProseMirror')).toContainText('hello');
	// The rewritten link still shows the picture.
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Pics', { exact: true }).click();
	await expect(page.locator('.md-image img')).toHaveCount(1);
	await ctx.close();
});

test('AI harness: each reply shows its cost; the chat and the Usage window add it up', async ({
	page
}) => {
	await openPlan(page);
	const harness = await openHarness(page);
	const input = harness.locator('textarea');
	await input.fill('cost?');
	await input.press('Enter');
	await expect(harness.getByText('Priced reply')).toBeVisible();
	await expect(harness.locator('.usage')).toHaveText('1.5k in · 50 out · $0.0021');
	await expect(harness.locator('.chat-cost')).toHaveText('$0.0021');

	// A local model's reply counts its tokens at no cost.
	await input.fill('md?');
	await input.press('Enter');
	await expect(harness.locator('.usage').nth(1)).toHaveText('1.2k in · 34 out · $0');

	// Usage travels with the session file.
	await expect
		.poll(() =>
			page.evaluate(() =>
				Object.entries((window as unknown as { __meta: Record<string, string> }).__meta)
					.filter(([k]) => k.startsWith('sessions/'))
					.map(([, v]) => v)
					.join('')
			)
		)
		.toMatch(/^usage: \[.*\|1500\|50\|0\.0021.*\|1200\|34\|0"\]$/m);

	await harness.getByRole('button', { name: 'Session actions' }).tap();
	await page.getByRole('menuitem', { name: /Usage & cost/ }).tap();
	const usage = page.getByRole('dialog', { name: 'Usage' });
	await expect(usage.locator('.card').first()).toContainText('$0.0021');
	await expect(usage.locator('.card').first()).toContainText('2 runs');
	await expect(usage.getByRole('button', { name: /^cost\?/ })).toContainText('$0.0021');
	await usage.getByRole('button', { name: 'Close', exact: true }).tap();
	await expect(usage).toHaveCount(0);
});

test('desktop: encrypting a folder encrypts its notes, new notes and notes moved in', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await openAdvanced(page, 'Encryption');
	await page.getByRole('switch', { name: 'Encrypt notes' }).click();
	await page.getByLabel('Passphrase', { exact: true }).fill('correct horse');
	await page.getByLabel('Repeat passphrase').fill('correct horse');
	await page.getByRole('button', { name: 'Create key' }).click();
	await expect(page.getByText('Unlocked', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Close settings' }).click();

	const work = sidebar(page).getByRole('button', { name: /^Work \d+$/ });
	await work.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Encrypt all notes' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Encrypt all' }).click();
	await expect.poll(() => readFake(page, 'Work/plan.md')).toContain('-----BEGIN PGP MESSAGE-----');
	await expect(work.locator('.shield')).toBeVisible();

	// A new note in the folder starts encrypted.
	await work.click();
	await list(page).getByRole('button', { name: 'New note' }).click();
	await expect(page.locator('.editor-head')).toContainText('Encrypted');
	await expect(page.locator('.ProseMirror')).toBeFocused();
	await page.keyboard.type('Secret plan');
	await page.keyboard.press('Enter');
	await page.keyboard.type('hidden body');
	// The file is named after the title as typed by the first save.
	const secretId = async () => (await noteIds(page)).find((id) => id.startsWith('Work/Secret'));
	await expect.poll(secretId).toBeTruthy();
	const id = (await secretId())!;
	await expect.poll(() => readFake(page, id)).toContain('-----BEGIN PGP MESSAGE-----');
	await expect.poll(async () => (await readFake(page, id)).includes('hidden body')).toBe(false);

	// A plain note moved in is encrypted too.
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByRole('button', { name: /Hello/ }).dragTo(work);
	await expect.poll(() => readFake(page, 'Work/hello.md')).toContain('-----BEGIN PGP MESSAGE-----');
	await ctx.close();
});

test('desktop: a remembered passphrase unlocks without asking; forgetting deletes it', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	const secret = () =>
		page.evaluate(() =>
			(
				window as unknown as { api: { getSecret(n: string): Promise<string | null> } }
			).api.getSecret('pgp:passphrase')
		);
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await openAdvanced(page, 'Encryption');
	await page.getByRole('switch', { name: 'Encrypt notes' }).click();
	await page.getByLabel('Passphrase', { exact: true }).fill('correct horse');
	await page.getByLabel('Repeat passphrase').fill('correct horse');
	await page.getByRole('button', { name: 'Create key' }).click();

	// Remember: the passphrase is checked, then kept in secure storage.
	const remember = page.getByRole('switch', { name: 'Remember passphrase' });
	await remember.click();
	const dialog = page.getByRole('dialog', { name: 'Remember the passphrase' });
	await dialog.getByLabel('Key passphrase').fill('wrong');
	await dialog.getByRole('button', { name: 'Remember' }).click();
	await expect(dialog.getByText('Wrong passphrase.')).toBeVisible();
	await dialog.getByLabel('Key passphrase').fill('correct horse');
	await dialog.getByRole('button', { name: 'Remember' }).click();
	await expect(remember).toHaveAttribute('aria-checked', 'true');
	expect(await secret()).toBe('correct horse');

	// Encrypt a note, lock, and open it again: no prompt.
	await page.getByRole('button', { name: 'Close settings' }).click();
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByRole('button', { name: /Hello/ }).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Encrypt' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Encrypt' }).click();
	await expect.poll(() => readFake(page, 'hello.md')).toContain('-----BEGIN PGP MESSAGE-----');
	await page.getByRole('button', { name: 'Lock encrypted notes' }).click();
	await list(page).getByText('hello', { exact: true }).click();
	await expect(page.locator('.ProseMirror')).toContainText('world');
	await expect(page.getByRole('dialog', { name: 'Unlock encrypted notes' })).toHaveCount(0);

	// Forget: deleted from the device, and the next unlock asks again.
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await remember.click();
	await expect(remember).toHaveAttribute('aria-checked', 'false');
	expect(await secret()).toBeNull();
	await page.getByRole('button', { name: 'Lock now' }).click();
	await page.getByRole('button', { name: 'Unlock…' }).click();
	await expect(page.getByRole('dialog', { name: 'Unlock encrypted notes' })).toBeVisible();
	await ctx.close();
});

/** `.fr5a/` files of the fake workspace. */
const metaKeys = (page: Page) =>
	page.evaluate(() =>
		Object.keys((window as unknown as { __meta: Record<string, string> }).__meta).sort()
	);

test('desktop: the model picker offers provider defaults and extra shortcuts; models.dev prices them', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Plan', { exact: true }).click();
	await page.getByRole('button', { name: 'Toggle AI harness' }).click();
	const harness = page.getByRole('region', { name: 'AI harness' });
	await harness.locator('.ctx-sum').click();
	const picker = harness.getByLabel('Model', { exact: true });
	// Only Fake is set up, so its default is available without any starring ceremony.
	await expect(picker.locator('option')).toHaveText(['Fake · m']);

	// A key for DeepSeek and a model starred: offered now, priced from
	// models.dev. (The sidebar steps aside for the AI pane: close it to reach Settings.)
	const toggle = page.getByRole('button', { name: 'Toggle AI harness' });
	await toggle.click();
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await openAdvanced(page, 'AI assistant');
	await page.getByRole('button', { name: 'Show DeepSeek details' }).click();
	const deepseek = page.locator('.provider', { hasText: 'DeepSeek' });
	await deepseek.locator('#key-deepseek').fill('sk-test');
	await deepseek.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(deepseek.locator('.badge.warn')).toHaveCount(0);
	await expect(deepseek.getByText('$0.28 in · $0.42 out (models.dev)')).toBeVisible();
	await deepseek
		.getByRole('group', { name: 'DeepSeek models' })
		.getByRole('button', { name: /^m\b/ })
		.click();
	await page.getByRole('button', { name: 'Close settings' }).click();
	await toggle.click();

	await expect(picker.locator('option')).toHaveText([
		'DeepSeek · deepseek-chat',
		'DeepSeek · m',
		'Fake · m'
	]);
	await picker.selectOption({ label: 'DeepSeek · m' });
	const input = harness.locator('textarea');
	await input.fill('md?');
	await input.press('Enter');
	// 1200 in × $0.28 + 34 out × $0.42 per 1M tokens.
	await expect(harness.locator('.usage')).toHaveText('1.2k in · 34 out · $0.0004');
	await ctx.close();
});

test('desktop: models starred in Settings are offered in the AI pane, per chat', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await openAdvanced(page, 'AI assistant');

	// OpenCode: a key, then its list (models.dev says gpt-5-nano is served over the Responses API).
	await page.getByRole('button', { name: 'Show OpenCode details' }).click();
	const opencode = page.locator('.provider', { hasText: 'OpenCode' });
	await opencode.locator('#key-opencode-zen').fill('oc-test');
	await opencode.getByRole('button', { name: 'Save', exact: true }).click();
	const ocModels = opencode.getByRole('group', { name: 'OpenCode models' });
	// The default is already in the picker; only extra models need shortcut controls.
	await expect(ocModels.getByRole('button')).toHaveCount(2);
	const nanoRow = ocModels.locator('.mrow', { hasText: 'gpt-5-nano' });
	await expect(nanoRow).toContainText('OpenAI Responses API');
	await nanoRow.getByRole('button').click();
	await ocModels.getByRole('button', { name: /^m\b/ }).click();
	await expect(ocModels.getByRole('button', { name: /^m\b/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(opencode.locator('.badge', { hasText: '2 shortcuts' })).toBeVisible();

	// The local provider: filter its list, star one.
	await page.getByRole('button', { name: 'Show Fake details' }).click();
	const fake = page.locator('.provider', { hasText: 'Fake' });
	await fake.getByLabel('Filter Fake models').fill('nano');
	const fakeModels = fake.getByRole('group', { name: 'Fake models' });
	await expect(fakeModels.getByRole('button')).toHaveCount(1);
	await fakeModels.getByRole('button', { name: /gpt-5-nano/ }).click();
	await page.getByRole('button', { name: 'Close settings' }).click();

	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Plan', { exact: true }).click();
	await page.getByRole('button', { name: 'Toggle AI harness' }).click();
	const harness = page.getByRole('region', { name: 'AI harness' });
	await harness.locator('.ctx-sum').click();
	const picker = harness.getByLabel('Model', { exact: true });
	// Provider defaults are always present; stars add extra shortcuts.
	await expect(picker.locator('option')).toHaveText([
		'OpenCode · big-pickle',
		'OpenCode · gpt-5-nano',
		'OpenCode · m',
		'Fake · m',
		'Fake · gpt-5-nano'
	]);

	// This chat runs on OpenCode's m: the new endpoint, with a chat id and the app named.
	await picker.selectOption({ label: 'OpenCode · m' });
	await expect(harness.locator('.ctx-sum .prov')).toHaveText('OpenCode · m');
	const input = harness.locator('textarea');
	await input.fill('md?');
	await input.press('Enter');
	await expect(harness.locator('.usage')).toBeVisible();
	const sent = await page.evaluate(
		() =>
			(
				window as unknown as {
					__llm: { url: string; headers: Record<string, string>; body: string }[];
				}
			).__llm
	);
	expect(sent).toHaveLength(1);
	expect(sent[0].url).toBe('https://opencode.ai/inference/v1/chat/completions');
	expect(JSON.parse(sent[0].body).model).toBe('m');
	expect(sent[0].headers['x-opencode-session']).toMatch(/^fr5a-/);
	expect(sent[0].headers['User-Agent']).toMatch(/^fr5a\//);
	// Kept with the chat.
	await expect
		.poll(() =>
			page.evaluate(() =>
				Object.entries((window as unknown as { __meta: Record<string, string> }).__meta)
					.filter(([k]) => k.startsWith('sessions/device/'))
					.map(([, v]) => v)
					.join('\n')
			)
		)
		.toMatch(/^provider: opencode-zen\nmodel: m$/m);

	// OpenCode's GPT model: over the Responses API, history and all.
	await harness.locator('.ctx-sum').click();
	await picker.selectOption({ label: 'OpenCode · gpt-5-nano' });
	await input.fill('md?');
	await input.press('Enter');
	await expect(harness.locator('.usage')).toHaveCount(2);
	const viaResponses = await page.evaluate(
		() => (window as unknown as { __llm: { url: string; body: string }[] }).__llm[1]
	);
	expect(viaResponses.url).toBe('https://opencode.ai/inference/v1/responses');
	const body = JSON.parse(viaResponses.body);
	expect(body).toMatchObject({ model: 'gpt-5-nano', store: false });
	expect(body.input.filter((i: { role?: string }) => i.role === 'user')).toHaveLength(2);
	await expect(harness.locator('.msg.ai').last()).not.toBeEmpty();

	// A new chat starts on the model used last, not the default provider's.
	await harness.getByRole('button', { name: 'New session' }).click();
	await expect(harness.locator('.ctx-sum .prov')).toHaveText('OpenCode · gpt-5-nano');
	await ctx.close();
});

test('desktop: model lists and models.dev are fetched once, then read from storage', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	const fetched = (p: Page) => p.evaluate(() => (window as unknown as { __http: string[] }).__http);
	const openAiSettings = async (p: Page) => {
		await sidebar(p).getByRole('button', { name: 'Settings', exact: true }).click();
		await openAdvanced(p, 'AI assistant');
	};
	// First visit: the local provider's list and the catalog (for every cloud provider).
	await openAiSettings(page);
	await expect
		.poll(() => fetched(page))
		.toEqual(expect.arrayContaining(['https://models.dev/api.json', 'http://fake/v1/models']));
	const stored = await page.evaluate(async () => {
		const api = (window as unknown as { api: { getState(k: string): Promise<unknown> } }).api;
		return { models: await api.getState('aiModels'), prices: await api.getState('aiPrices') };
	});
	expect(stored.models).toHaveProperty('fake');
	expect(stored.prices).toHaveProperty('models');

	// The next launch: everything comes from storage, nothing is fetched.
	const next = await ctx.newPage();
	await next.addInitScript(installFakeApi);
	await next.addInitScript((s) => {
		const api = (window as unknown as { api: { setState(k: string, v: unknown): void } }).api;
		api.setState('aiModels', s.models);
		api.setState('aiPrices', s.prices);
	}, stored);
	await next.goto('/');
	await openAiSettings(next);
	await next.getByRole('button', { name: 'Show Fake details' }).click();
	await expect(next.getByRole('group', { name: 'Fake models' }).getByRole('button')).toHaveCount(3);
	await next.getByRole('button', { name: 'Close settings' }).click();
	await sidebar(next)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(next).getByText('Plan', { exact: true }).click();
	await next.getByRole('button', { name: 'Toggle AI harness' }).click();
	await expect(next.getByRole('region', { name: 'AI harness' })).toBeVisible();
	await next.waitForTimeout(300);
	expect(await fetched(next)).toEqual([]);
	await ctx.close();
});

test('desktop: unlocked encrypted notes reach the AI; such a chat is marked private and saves encrypted', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await openAdvanced(page, 'Encryption');
	await page.getByRole('switch', { name: 'Encrypt notes' }).click();
	await page.getByLabel('Passphrase', { exact: true }).fill('correct horse');
	await page.getByLabel('Repeat passphrase').fill('correct horse');
	await page.getByRole('button', { name: 'Create key' }).click();
	await expect(page.getByText('Unlocked', { exact: true })).toBeVisible();
	const allow = page.getByRole('switch', { name: 'AI can read encrypted notes' });
	await expect(allow).toHaveAttribute('aria-checked', 'true');
	await allow.click();
	await page.getByRole('button', { name: 'Close settings' }).click();

	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByRole('button', { name: /Hello/ }).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Encrypt' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Encrypt' }).click();
	await expect.poll(() => readFake(page, 'hello.md')).toContain('-----BEGIN PGP MESSAGE-----');
	await list(page).getByText('Hello', { exact: true }).click();
	await expect(page.locator('.ProseMirror')).toContainText('world');

	// Not allowed: the open note stays out. Working chats always stay on this
	// device (`sessions/device/`, git-ignored), whatever they read.
	await page.getByRole('button', { name: 'Toggle AI harness' }).click();
	const harness = page.getByRole('region', { name: 'AI harness' });
	const input = harness.locator('textarea');
	await input.fill('context?');
	await input.press('Enter');
	await expect(harness.getByText('ctx:', { exact: true })).toBeVisible();
	await expect
		.poll(() => metaKeys(page))
		.toContainEqual(expect.stringMatching(/^sessions\/device\/[^/]+\.md$/));
	expect((await metaKeys(page)).filter((k) => /^sessions\/[^/]+\.md$/.test(k))).toEqual([]);
	expect(
		await page.evaluate(
			() => (window as unknown as { __meta: Record<string, string> }).__meta['sessions/.gitignore']
		)
	).toMatch(/^device\/$/m);
	const privateCtx = harness.locator('.pill', { hasText: 'private context' });
	await expect(privateCtx).toHaveCount(0);

	// Allowed: it reads the note, and the chat is marked as holding decrypted text.
	const toggle = page.getByRole('button', { name: 'Toggle AI harness' });
	await toggle.click();
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await openAdvanced(page, 'Encryption');
	await allow.click();
	await page.getByRole('button', { name: 'Close settings' }).click();
	await toggle.click();
	await input.fill('context?');
	await input.press('Enter');
	await expect(harness.getByText('ctx: hello.md')).toBeVisible();
	await expect(privateCtx).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() =>
				Object.entries((window as unknown as { __meta: Record<string, string> }).__meta)
					.filter(([k]) => k.startsWith('sessions/device/'))
					.map(([, v]) => v)
			)
		)
		.toContainEqual(expect.stringMatching(/^sensitive: yes$/m));
	expect((await metaKeys(page)).filter((k) => /^sessions\/[^/]+\.md$/.test(k))).toEqual([]);

	// Saved to notes (the only way a chat syncs), it's encrypted.
	await harness.getByRole('button', { name: 'Session actions' }).click();
	await page.getByRole('menuitem', { name: /Save to notes/ }).click();
	const chatId = async () => (await noteIds(page)).find((id) => id.startsWith('.fr5a/chats/'));
	await expect.poll(chatId).toBeTruthy();
	await expect
		.poll(async () => readFake(page, (await chatId())!))
		.toContain('-----BEGIN PGP MESSAGE-----');
	await ctx.close();
});

// --- images, dividers, highlights, table creator ---------------------------------

/** Open Hello (seeded by `desktopPage`) from All Notes; notes open editable with a mouse. */
async function openHello(page: Page) {
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Hello', { exact: true }).click();
	await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
}

test('desktop: images show above their hidden line, resize by the corner, paste', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser, {
		'hello.md': '# Hello\n\n![A cat](assets/cat.png)\n<!-- size: 40% -->\n![](missing.png)\nend'
	});
	await openHello(page);
	await expect(page.locator('.md-image img')).toHaveCount(1);
	await expect(page.locator('.md-image-missing')).toContainText('Image not found');
	// The lines are hidden behind the pictures; the size is a share of the column.
	await expect(page.locator('p.md-img-hidden')).toHaveCount(3);
	const share = await page
		.locator('.md-image')
		.first()
		.evaluate(
			(el) =>
				el.querySelector('.md-image-frame')!.getBoundingClientRect().width /
				el.getBoundingClientRect().width
		);
	expect(share).toBeCloseTo(0.4, 2);

	// A click on the picture shows its source below it.
	await page.locator('.md-image img').click();
	await expect(page.locator('p.md-img-src')).toHaveText([
		'![A cat](assets/cat.png)',
		'<!-- size: 40% -->'
	]);

	// Dragging the corner rewrites the size comment; a double-click drops it.
	await page.locator('.md-image').first().hover();
	const h = (await page.locator('.md-image-handle').boundingBox())!;
	await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
	await page.mouse.down();
	await page.mouse.move(h.x + 120, h.y, { steps: 6 });
	await expect(page.locator('.md-image-pct')).toHaveText(/^\d+%$/);
	await page.mouse.up();
	await expect.poll(() => editorText(page)).toMatch(/cat\.png\)\n<!-- size: (\d+)% -->/);
	const pct = Number(/size: (\d+)%/.exec(await editorText(page))![1]);
	expect(pct).toBeGreaterThan(55);
	await page.locator('.md-image').first().hover();
	await page.locator('.md-image-handle').dblclick();
	await expect.poll(() => editorText(page)).toContain('cat.png)\n![](missing.png)');

	// A pasted image is saved under .fr5a/assets/ and linked on its own line.
	await page.keyboard.press('Control+End');
	await page.evaluate(() => {
		const dt = new DataTransfer();
		dt.items.add(new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' }));
		document
			.querySelector('.ProseMirror')!
			.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
			);
	});
	await expect
		.poll(() => editorText(page))
		.toMatch(/\nend\n!\[\]\(\.fr5a\/assets\/image-\d{8}-\d{6}\.png\)\n$/);
	const assets = await page.evaluate(() => (window as unknown as { __assets: object }).__assets);
	expect(Object.values(assets)).toEqual([3]);
	expect(Object.keys(assets)[0]).toMatch(/^\.fr5a\/assets\/image-\d{8}-\d{6}\.png$/);
	await expect(page.locator('.md-image img')).toHaveCount(2);
	await ctx.close();
});

test('desktop: dragging a picture moves its lines', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser, {
		'hello.md': '# Hello\n\n![A cat](assets/cat.png)\n<!-- size: 40% -->\nfirst\nsecond\nend'
	});
	await openHello(page);
	const pic = (await page.locator('.md-image img').boundingBox())!;
	const line = (text: string) =>
		page.locator('.ProseMirror p', { hasText: new RegExp(`^${text}$`) });
	await page.mouse.move(pic.x + pic.width / 2, pic.y + pic.height / 2);
	await page.mouse.down();
	// The press shows the source under the picture: measure after it.
	await expect(page.locator('p.md-img-src')).toHaveCount(2);
	const end = (await line('end').boundingBox())!;
	await page.mouse.move(pic.x + pic.width / 2, end.y - 1, { steps: 8 });
	await expect(page.locator('.md-image.moving')).toHaveCount(1);
	await expect(page.locator('.md-image-drop')).toBeVisible();
	// Escape puts it back.
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(page.locator('.md-image-drop')).toHaveCount(0);
	expect(await editorText(page)).toContain(
		'\n\n![A cat](assets/cat.png)\n<!-- size: 40% -->\nfirst'
	);

	await page.mouse.move(pic.x + pic.width / 2, pic.y + pic.height / 2);
	await page.mouse.down();
	await page.mouse.move(pic.x + pic.width / 2, end.y - 1, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(() => editorText(page))
		.toBe('# Hello\n\nfirst\nsecond\n![A cat](assets/cat.png)\n<!-- size: 40% -->\nend');
	// The caret went along: its source shows at the new place.
	await expect(page.locator('p.md-img-src')).toHaveText([
		'![A cat](assets/cat.png)',
		'<!-- size: 40% -->'
	]);
	// One undo step puts it back.
	await page.keyboard.press('Control+z');
	await expect.poll(() => editorText(page)).toContain('\n\n![A cat](assets/cat.png)\n<!-- size');
	await ctx.close();
});

test('a long press lifts a picture to drag it; a plain swipe scrolls', async ({ page }) => {
	await writeFake(page, 'hello.md', '# Hello\n\n![A cat](assets/cat.png)\nfirst\nsecond\nend');
	await openFolder(page, /^All Notes/);
	await list(page).getByRole('button', { name: /Hello/ }).tap();
	await edit(page);
	const pic = (await page.locator('.md-image img').boundingBox())!;
	const end = (await page.locator('.ProseMirror p', { hasText: /^end$/ }).boundingBox())!;
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: x === undefined ? [] : [{ x, y: y! }]
		});
	const x = pic.x + pic.width / 2;
	const y = pic.y + pic.height / 2;
	// No hold: nothing lifts.
	await touch('touchStart', x, y);
	for (let i = 1; i <= 5; i++) await touch('touchMove', x, y + i * 6);
	await touch('touchEnd');
	await expect(page.locator('.md-image.moving')).toHaveCount(0);

	await touch('touchStart', x, y);
	await page.waitForTimeout(550);
	await expect(page.locator('.md-image.moving')).toHaveCount(1);
	for (let i = 1; i <= 10; i++) await touch('touchMove', x, y + ((end.y - 1 - y) * i) / 10);
	await expect(page.locator('.md-image-drop')).toBeVisible();
	await touch('touchEnd');
	await expect
		.poll(() => editorText(page))
		.toBe('# Hello\n\nfirst\nsecond\n![A cat](assets/cat.png)\nend');
	await expect(page.getByRole('menu')).toHaveCount(0);
});

test('desktop: note tabs — every note opened gets a tab, @tabs for the AI', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser, {
		'alpha.md': '# Alpha\n\none',
		'beta.md': '# Beta\n\ntwo',
		'gamma.md': '# Gamma\n\nthree'
	});
	const tabs = page.getByRole('tablist', { name: 'Open notes' }).getByRole('tab');
	const body = page.locator('.ProseMirror');
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Alpha', { exact: true }).click();
	// Off by default.
	await expect(tabs).toHaveCount(0);
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Settings sections' })
		.getByRole('button', { name: /Editor/ })
		.click();
	await page.getByRole('switch', { name: 'Tabs' }).click();
	await page.getByRole('button', { name: 'Close settings' }).click();
	// The open note is the first tab.
	await expect(tabs).toHaveText(['Alpha']);

	// A list click opens the note in a new tab, after the current one.
	await list(page).getByText('Beta', { exact: true }).click();
	await expect(tabs).toHaveText(['Alpha', 'Beta']);
	await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
	// Closing a tab in the background leaves the open note alone.
	await page.getByRole('button', { name: 'Close Alpha' }).click();
	await expect(tabs).toHaveText(['Beta']);
	await list(page).getByText('Gamma', { exact: true }).click();
	await expect(tabs).toHaveText(['Beta', 'Gamma']);
	await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
	// A note that has a tab switches to it rather than opening another.
	await list(page).getByText('Beta', { exact: true }).click();
	await expect(tabs).toHaveText(['Beta', 'Gamma']);
	await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
	await list(page).getByText('Gamma', { exact: true }).click();
	await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
	// New note: a tab of its own, named once the typed title is saved.
	await page.keyboard.press('Control+n');
	await expect(tabs).toHaveText(['Beta', 'Gamma', 'New note']);
	await expect(body).toBeFocused();
	await page.keyboard.type('Delta');
	await expect(tabs).toHaveText(['Beta', 'Gamma', 'Delta']);
	// Switching: a click, Ctrl+Tab round the ends.
	await tabs.first().click();
	await expect(body).toContainText('two');
	await page.keyboard.press('Control+Tab');
	await expect(body).toContainText('three');
	// Mod+W closes the current tab; the next one opens.
	await page.keyboard.press('Control+w');
	await expect(tabs).toHaveText(['Beta', 'Delta']);
	await expect(body).toContainText('Delta');
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { api: { getState(k: string): Promise<unknown> } }).api.getState(
					'tabs'
				)
			)
		)
		.toEqual(['beta.md', 'Delta.md']);

	// The AI: the current tab is attached; @tabs adds every open one.
	await page.keyboard.press('Control+j');
	const harness = page.getByRole('region', { name: 'AI harness' });
	const input = harness.locator('textarea');
	await input.fill('@ta');
	await expect(harness.locator('.suggest [role=option]').first()).toContainText('all 2 open tabs');
	await input.press('Enter');
	await expect(input).toHaveValue('@tabs ');
	await input.pressSequentially('context?');
	await input.press('Enter');
	await expect(harness.getByText('ctx: Delta.md | beta.md | index of @tabs')).toBeVisible();
	await harness.locator('.ctx-sum').click();
	await expect(harness.getByRole('button', { name: /current tab/ })).toBeVisible();
	await expect(harness.locator('.chip.tabs')).toHaveText(/all tabs/);

	// Off: the strip goes.
	await page.keyboard.press('Control+,');
	await page
		.getByRole('navigation', { name: 'Settings sections' })
		.getByRole('button', { name: /Editor/ })
		.click();
	await page.getByRole('switch', { name: 'Tabs' }).click();
	await page.getByRole('button', { name: 'Close settings' }).click();
	await expect(tabs).toHaveCount(0);
	await ctx.close();
});

// --- tabs: auto-save integrity ----------------------------------------------------

/** The page's fake host with `createNote` / `readNote` that can be held mid-call. */
type Gated = {
	api: {
		readNote(id: string): Promise<string>;
	};
	__writes: { id: string; content: string }[];
	__creates: string[];
	holdCreate?: boolean;
	holdRead?: string;
	/** Resolvers of the calls being held, released together by `releaseAll`. */
	release: (() => void)[];
};

/** A mouse window with tabs on, the host gated, and `ids` (titles) opened as tabs in order. */
async function tabsPage(browser: Browser, titles: string[]) {
	const { ctx, page } = await desktopPage(browser, {
		'alpha.md': '# Alpha\n\none',
		'beta.md': '# Beta\n\ntwo'
	});
	await page.addInitScript(() => {
		const w = window as unknown as Gated & {
			api: {
				setState(k: string, v: unknown): Promise<void>;
				createNote(...a: unknown[]): Promise<unknown>;
			};
		};
		void w.api.setState('settings', { tabs: true });
		w.__creates = [];
		w.release = [];
		const hold = () => new Promise<void>((resolve) => w.release.push(resolve));
		const create = w.api.createNote.bind(w.api);
		w.api.createNote = async (...args: unknown[]) => {
			w.__creates.push(String(args[0]));
			if (w.holdCreate) await hold();
			return create(...args);
		};
		const read = w.api.readNote.bind(w.api);
		w.api.readNote = async (id: string) => {
			if (w.holdRead === id) await hold();
			return read(id);
		};
	});
	await page.reload();
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	const tabs = page.getByRole('tablist', { name: 'Open notes' }).getByRole('tab');
	for (const title of titles) await list(page).getByText(title, { exact: true }).click();
	await expect(tabs).toHaveText(titles);
	return { ctx, page, tabs };
}

const creates = (page: Page) => page.evaluate(() => (window as unknown as Gated).__creates);
const writeCount = (page: Page) =>
	page.evaluate(() => (window as unknown as Gated).__writes.length);
const fileText = (page: Page, id: string) =>
	page.evaluate((id) => (window as unknown as Gated).api.readNote(id), id);
const hold = (page: Page, what: { create?: boolean; read?: string }) =>
	page.evaluate((what) => {
		const w = window as unknown as Gated;
		w.holdCreate = what.create;
		w.holdRead = what.read;
	}, what);
/** Wait until `n` host calls are being held. */
const held = (page: Page, n = 1) =>
	expect.poll(() => page.evaluate(() => (window as unknown as Gated).release.length)).toBe(n);
const releaseAll = (page: Page) =>
	page.evaluate(() => {
		const w = window as unknown as Gated;
		w.holdCreate = false;
		w.holdRead = undefined;
		for (const r of w.release.splice(0)) r();
	});

test('desktop tabs: closing tabs nobody edited writes nothing', async ({ browser }) => {
	const { ctx, page, tabs } = await tabsPage(browser, ['Alpha', 'Beta']);
	await page.waitForTimeout(700);
	const before = await writeCount(page);
	await page.keyboard.press('Control+w');
	await expect(tabs).toHaveText(['Alpha']);
	await expect(page.locator('.ProseMirror')).toContainText('one');
	await list(page).getByText('Beta', { exact: true }).click();
	await page.getByRole('button', { name: 'Close Alpha' }).click();
	await expect(tabs).toHaveText(['Beta']);
	await page.waitForTimeout(700);
	expect(await writeCount(page)).toBe(before);
	await ctx.close();
});

test('desktop tabs: a draft closed while its file is being created is created once', async ({
	browser
}) => {
	const { ctx, page, tabs } = await tabsPage(browser, ['Alpha']);
	await page.keyboard.press('Control+n');
	await expect(page.locator('.ProseMirror')).toBeFocused();
	await hold(page, { create: true });
	await page.keyboard.type('Foo');
	// The auto-save starts creating Foo.md, which the host holds.
	await expect.poll(async () => (await creates(page)).length).toBe(1);
	await page.keyboard.press('Enter');
	await page.keyboard.type('more text');
	await page.keyboard.press('Control+w');
	await page.waitForTimeout(700);
	await releaseAll(page);
	await expect(tabs).toHaveText(['Alpha']);
	await expect(page.locator('.ProseMirror')).toContainText('one');
	await page.waitForTimeout(700);
	expect(await creates(page)).toEqual(['Foo']);
	expect(await noteIds(page)).not.toContain('Foo_2.md');
	expect(await fileText(page, 'Foo.md')).toBe('# Foo\nmore text');
	expect(await fileText(page, 'alpha.md')).toBe('# Alpha\n\none');
	await ctx.close();
});

test('desktop tabs: text typed while the neighbour loads stays in the closed note', async ({
	browser
}) => {
	const { ctx, page, tabs } = await tabsPage(browser, ['Alpha']);
	await page.keyboard.press('Control+n');
	await expect(page.locator('.ProseMirror')).toBeFocused();
	await page.keyboard.type('Foo');
	await expect(tabs).toHaveText(['Alpha', 'Foo']);
	await hold(page, { read: 'alpha.md' });
	await page.keyboard.press('Control+w');
	await held(page);
	await page.keyboard.type(' bar');
	await page.waitForTimeout(700);
	await releaseAll(page);
	await expect(tabs).toHaveText(['Alpha']);
	await expect(page.locator('.ProseMirror')).toContainText('one');
	await page.waitForTimeout(700);
	expect(await fileText(page, 'alpha.md')).toBe('# Alpha\n\none');
	expect(await fileText(page, 'Foo.md')).toBe('# Foo bar');
	expect(await creates(page)).toEqual(['Foo']);
	await ctx.close();
});

test('desktop tabs: typing through Ctrl+Tab stays in the tab it was typed in', async ({
	browser
}) => {
	const { ctx, page, tabs } = await tabsPage(browser, ['Alpha', 'Beta']);
	await tabs.first().click();
	await expect(page.locator('.ProseMirror')).toContainText('one');
	await page.keyboard.press('Control+End');
	await page.keyboard.type(' aaa');
	await hold(page, { read: 'beta.md' });
	await page.keyboard.press('Control+Tab');
	await held(page);
	// Still Alpha on screen until Beta has loaded.
	await page.keyboard.type(' bbb');
	await releaseAll(page);
	await expect(page.locator('.ProseMirror')).toContainText('two');
	await page.keyboard.press('Control+End');
	await page.keyboard.type(' ccc');
	await page.waitForTimeout(700);
	expect(await fileText(page, 'alpha.md')).toBe('# Alpha\n\none aaa bbb');
	expect(await fileText(page, 'beta.md')).toBe('# Beta\n\ntwo ccc');
	await ctx.close();
});

test('desktop tabs: pinning while typing loses no keystroke', async ({ browser }) => {
	const { ctx, page } = await tabsPage(browser, ['Alpha']);
	await page.keyboard.press('Control+End');
	await page.keyboard.type(' abc');
	await hold(page, { read: 'alpha.md' });
	await page.keyboard.press('Control+p');
	await page.keyboard.type(' def');
	await page.waitForTimeout(300);
	await releaseAll(page);
	await page.waitForTimeout(700);
	await expect(page.locator('.ProseMirror')).toContainText('one abc def');
	const text = await fileText(page, 'alpha.md');
	expect(text).toContain('<!-- pinned: true -->');
	expect(text).toContain('one abc def');
	await ctx.close();
});

test('desktop: closing the window writes the edit still waiting for the auto-save', async ({
	browser
}) => {
	const { ctx, page } = await tabsPage(browser, ['Alpha']);
	await page.keyboard.press('Control+End');
	await page.keyboard.type(' bye');
	// What main asks for when the window closes; it answers well inside the 500ms debounce.
	await page.evaluate(() => (window as unknown as { __leave: () => Promise<void> }).__leave());
	expect(await fileText(page, 'alpha.md')).toBe('# Alpha\n\none bye');
	await ctx.close();
});

test("desktop tabs: trashing another note keeps the open note's unsaved edit", async ({
	browser
}) => {
	const { ctx, page } = await tabsPage(browser, ['Alpha']);
	await page.keyboard.press('Control+End');
	await page.keyboard.type(' abc');
	await list(page).getByText('Beta', { exact: true }).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
	// (The fake host only records the trashed id.)
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { __trashed?: string[] }).__trashed))
		.toEqual(['beta.md']);
	await page.waitForTimeout(700);
	expect(await fileText(page, 'alpha.md')).toBe('# Alpha\n\none abc');
	await ctx.close();
});

test('desktop: past the tab limit a note opens in the current tab', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser, {
		'alpha.md': '# Alpha\n\none',
		'beta.md': '# Beta\n\ntwo',
		'gamma.md': '# Gamma\n\nthree',
		'delta.md': '# Delta\n\nfour'
	});
	const tabs = page.getByRole('tablist', { name: 'Open notes' }).getByRole('tab');
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Alpha', { exact: true }).click();
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Settings sections' })
		.getByRole('button', { name: /Editor/ })
		.click();
	await page.getByRole('switch', { name: 'Tabs' }).click();
	const limit = page.getByLabel('Tab limit');
	await expect(limit).toHaveValue('5');
	await limit.selectOption('2');
	await page.getByRole('button', { name: 'Close settings' }).click();

	await list(page).getByText('Beta', { exact: true }).click();
	await expect(tabs).toHaveText(['Alpha', 'Beta']);
	// Full: Gamma takes over the current tab.
	await list(page).getByText('Gamma', { exact: true }).click();
	await expect(tabs).toHaveText(['Alpha', 'Gamma']);
	await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
	// A note with a tab still switches to it.
	await list(page).getByText('Alpha', { exact: true }).click();
	await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
	await list(page).getByText('Delta', { exact: true }).click();
	await expect(tabs).toHaveText(['Delta', 'Gamma']);
	await ctx.close();
});

test('desktop: dividers draw by kind; highlights mark a line or a stretch, in colors', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser, {
		'hello.md': '# Hello\n\na\n---\nb\n* * *\nc\n___\nhello brave world\nlast'
	});
	await openHello(page);
	await expect(page.locator('p.md-hr-line')).toHaveText('---');
	await expect(page.locator('p.md-hr-dots')).toHaveText('* * *');
	await expect(page.locator('p.md-hr-double')).toHaveText('___');

	// Mod+Shift+H on a selection: offsets in a hidden comment above the line.
	const line = page.locator('.ProseMirror p', { hasText: 'hello brave world' });
	await line.click();
	await page.keyboard.press('Home');
	for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
	// Paced like a held key: instant presses can outrun the editor's selection sync.
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('Shift+ArrowRight');
		await page.waitForTimeout(40);
	}
	await page.keyboard.press('Control+Shift+H');
	await expect
		.poll(() => editorText(page))
		.toContain('<!-- highlight: 6-11 -->\nhello brave world');
	await expect.poll(() => marks(page)).toEqual(['yellow:brave']);
	await expect(page.locator('p.md-hl-comment')).toBeHidden();
	// The stretch keeps to its word while the line is edited before it.
	await page.keyboard.press('Home');
	await page.keyboard.type('oh ');
	await expect.poll(() => editorText(page)).toContain('<!-- highlight: 9-14 -->\noh hello brave');
	await expect.poll(() => marks(page)).toEqual(['yellow:brave']);

	// No selection: the whole line, in a color picked from Insert → Highlight….
	await page.locator('.ProseMirror p', { hasText: 'last' }).click();
	await page.getByRole('button', { name: 'Insert', exact: true }).click();
	await page.getByRole('menuitem', { name: /Highlight/ }).click();
	await expect(highlightPicker(page).getByRole('button', { name: 'Yellow' })).toBeFocused();
	await expect(
		highlightPicker(page).getByRole('button', { name: 'Remove highlight' })
	).toBeDisabled();
	await highlightPicker(page).getByRole('button', { name: 'Green' }).click();
	await expect(highlightPicker(page)).toHaveCount(0);
	await expect.poll(() => editorText(page)).toContain('<!-- highlight: green -->\nlast');
	await expect.poll(() => marks(page)).toEqual(['yellow:brave', 'green:last']);
	// The picker shows the line's color; the shortcut clears, then paints the color last picked.
	await page.getByRole('button', { name: 'Insert', exact: true }).click();
	await page.getByRole('menuitem', { name: /Highlight/ }).click();
	await expect(highlightPicker(page).getByRole('button', { name: 'Green' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.keyboard.press('Escape');
	await page.locator('.ProseMirror p', { hasText: 'last' }).click();
	await page.keyboard.press('Control+Shift+H');
	await expect.poll(() => editorText(page)).toMatch(/brave world\nlast$/);
	await page.keyboard.press('Control+Shift+H');
	await expect.poll(() => editorText(page)).toContain('<!-- highlight: green -->\nlast');
	// The eraser clears it.
	await page.getByRole('button', { name: 'Insert', exact: true }).click();
	await page.getByRole('menuitem', { name: /Highlight/ }).click();
	await highlightPicker(page).getByRole('button', { name: 'Remove highlight' }).click();
	await expect.poll(() => editorText(page)).toMatch(/brave world\nlast$/);

	// Off in Settings: the comments are plain text again.
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: /^Editor/ }).click();
	await page.getByRole('switch', { name: 'Highlights' }).click();
	await page.keyboard.press('Escape');
	await expect(page.locator('.md-mark')).toHaveCount(0);
	await expect(
		page.locator('.ProseMirror p', { hasText: '<!-- highlight: 9-14 -->' })
	).toBeVisible();
	await ctx.close();
});

test('desktop: Insert → Table puts a blank table at the caret', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser);
	await openHello(page);
	await page.keyboard.press('Control+End');
	await page.getByRole('button', { name: 'Insert', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Table…' }).click();
	const picker = page.getByRole('dialog', { name: 'Insert table' });
	await picker.locator('[data-cell="2:1"]').hover();
	await expect(picker).toContainText('3 columns × 2 rows');
	await picker.locator('[data-cell="2:1"]').click();
	await expect(picker).toHaveCount(0);
	// The caret waits in the first header cell; Tab moves on.
	await page.keyboard.type('Name');
	await page.keyboard.press('Tab');
	await page.keyboard.type('Qty');
	expect(await editorText(page)).toBe(
		'# Hello\n\nworld\n\n| Name    | Qty    |     |\n| --- | --- | --- |\n|     |     |     |\n'
	);
	await ctx.close();
});

test('formatting toolbar: Highlight picks a color for the line; Insert → Table sizes on a grid', async ({
	page
}) => {
	await openPlan(page);
	await edit(page);
	await page.locator('.ProseMirror p').last().tap();
	await toolbar(page).getByRole('button', { name: 'Highlight', exact: true }).tap();
	await highlightPicker(page).getByRole('button', { name: 'Pink' }).tap();
	await expect.poll(() => editorText(page)).toContain('<!-- highlight: pink -->\nfirst line');
	await expect.poll(() => marks(page)).toEqual(['pink:first line']);
	// The picker never took the focus (the keyboard stays up).
	await expect(page.locator('.ProseMirror')).toBeFocused();

	await page.keyboard.press('End');
	await toolbar(page).getByRole('button', { name: 'Insert', exact: true }).tap();
	await page.getByRole('menuitem', { name: 'Table…' }).tap();
	const picker = page.getByRole('dialog', { name: 'Insert table' });
	await picker.locator('[data-cell="1:1"]').tap();
	// Phones: a tap only sizes, Insert confirms. Elsewhere the tap inserts.
	if ((await layoutOf(page)) === 'phone') {
		await expect(picker.locator('.sheet-title, .size')).toContainText('2 columns × 2 rows');
		await picker.getByRole('button', { name: 'Insert 2 × 2' }).tap();
	}
	await expect(picker).toHaveCount(0);
	await expect
		.poll(() => editorText(page))
		.toContain('first line\n\n|     |     |\n| --- | --- |\n|     |     |');
});

test('desktop: toolbar buttons move between the bar and its menu', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser);
	await openHello(page);
	const head = page.locator('.editor-head');
	const more = head.getByRole('button', { name: 'More actions' });
	// Every button fits the bar by default: no ⋯.
	await expect(head.getByRole('button', { name: 'Toggle pin' })).toBeVisible();
	await expect(more).toHaveCount(0);

	// Right-click a button to move it into ⋯, where it still works.
	await head.getByRole('button', { name: 'Toggle pin' }).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move “Pin” to the menu' }).click();
	await expect(head.getByRole('button', { name: 'Toggle pin' })).toHaveCount(0);
	await more.click();
	await page.getByRole('menuitem', { name: 'Pin note' }).click();
	await expect.poll(() => editorText(page)).toContain('<!-- pinned: true -->');
	await more.click();

	// ⋯ → Customize: Highlight gets a button of its own, Insert goes into ⋯.
	await page.getByRole('menuitem', { name: 'Customize toolbar…' }).click();
	const spot = (item: string, to: string) =>
		page.getByRole('radiogroup', { name: item, exact: true }).getByRole('radio', { name: to });
	await expect(spot('Pin', 'Menu')).toHaveAttribute('aria-checked', 'true');
	await spot('Highlight', 'Bar').click();
	await spot('Insert', 'Menu').click();
	await page.keyboard.press('Escape');

	await page.locator('.ProseMirror p', { hasText: 'world' }).click();
	await expect(head.getByRole('button', { name: 'Insert', exact: true })).toHaveCount(0);
	await head.getByRole('button', { name: 'Highlight', exact: true }).click();
	await highlightPicker(page).getByRole('button', { name: 'Green' }).click();
	await expect.poll(() => editorText(page)).toContain('<!-- highlight: green -->\nworld');
	await more.click();
	await expect(page.getByRole('menuitem', { name: 'Table…' })).toBeVisible();
	await expect(page.getByRole('menuitem', { name: 'Highlight…' })).toHaveCount(0);
	await page.keyboard.press('Escape');

	// Reset puts everything back.
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: /^Toolbar/ }).click();
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect(head.getByRole('button', { name: 'Toggle pin' })).toBeVisible();
	await expect(head.getByRole('button', { name: 'Insert', exact: true })).toBeVisible();
	await expect(head.getByRole('button', { name: 'Highlight', exact: true })).toHaveCount(0);
	await expect(more).toHaveCount(0);
	await ctx.close();
});

test('toolbar on touch: formatting into ⋯, Highlight into Insert, Image a button, Pin into ⋯', async ({
	page
}) => {
	await openSettings(page);
	await page
		.getByRole('navigation', { name: 'Settings sections' })
		.getByRole('button', { name: /Toolbar/ })
		.tap();
	await expect(page.getByRole('heading', { name: 'Formatting toolbar' })).toBeVisible();
	const spot = (item: string, to: string) =>
		page.getByRole('radiogroup', { name: item, exact: true }).getByRole('radio', { name: to });
	// Touch keeps Highlight in the formatting toolbar by default.
	await expect(spot('Highlight', 'Bar')).toHaveAttribute('aria-checked', 'true');
	await spot('Highlight', 'Insert').tap();
	await spot('Image', 'Bar').tap();
	await spot('Pin', 'Menu').tap();
	await spot('Tag', 'Menu').tap();
	await spot('Undo', 'Menu').tap();
	await page.getByRole('button', { name: 'Close settings' }).tap();

	await openPlan(page);
	await edit(page);
	const head = page.locator('.editor-head');
	await expect(head.getByRole('button', { name: 'Toggle pin' })).toHaveCount(0);
	await expect(toolbar(page).getByRole('button', { name: 'Highlight', exact: true })).toHaveCount(
		0
	);
	await expect(toolbar(page).getByRole('button', { name: 'Image', exact: true })).toBeVisible();

	await page.locator('.ProseMirror p').last().tap();
	await toolbar(page).getByRole('button', { name: 'Insert', exact: true }).tap();
	await page.getByRole('menuitem', { name: 'Highlight…' }).tap();
	await highlightPicker(page).getByRole('button', { name: 'Pink' }).tap();
	await expect.poll(() => editorText(page)).toContain('<!-- highlight: pink -->\nfirst line');

	// Formatting moved out of the toolbar runs from its ⋯, and the caret stays in the note.
	for (const name of ['Tag', 'Undo'])
		await expect(toolbar(page).getByRole('button', { name, exact: true })).toHaveCount(0);
	await page.keyboard.press('End');
	await toolbar(page).getByRole('button', { name: 'More formatting' }).tap();
	await page.getByRole('menuitem', { name: 'Tag', exact: true }).tap();
	await expect.poll(() => editorText(page)).toContain('first line #');
	await expect(page.locator('.ProseMirror')).toBeFocused();
	await toolbar(page).getByRole('button', { name: 'More formatting' }).tap();
	await page.getByRole('menuitem', { name: 'Undo', exact: true }).tap();
	await expect.poll(() => editorText(page)).not.toContain('first line #');

	await head.getByRole('button', { name: 'More actions' }).tap();
	await expect(page.getByRole('menuitem', { name: 'Pin note' })).toBeVisible();
	await expect(page.getByRole('menuitem', { name: 'Customize toolbar…' })).toBeVisible();
});

test('desktop: a middle click never pastes, but still closes a tab', async ({ browser }) => {
	const { ctx, page } = await desktopPage(browser, {
		'alpha.md': '# Alpha\n\none two',
		'beta.md': '# Beta\n\nthree'
	});
	const body = page.locator('.ProseMirror');
	const tabs = page.getByRole('tablist', { name: 'Open notes' }).getByRole('tab');
	await sidebar(page)
		.getByRole('button', { name: /^All Notes/ })
		.click();
	await list(page).getByText('Alpha', { exact: true }).click();
	await expect(body).toHaveAttribute('contenteditable', 'true');
	// Record whether each middle-button mouseup reached the default action (Linux's
	// PRIMARY-selection paste happens there).
	await page.evaluate(() => {
		const w = window as unknown as { middleUps: boolean[] };
		w.middleUps = [];
		window.addEventListener('mouseup', (e) => {
			if (e.button === 1) w.middleUps.push(e.defaultPrevented);
		});
	});
	const middleUps = () =>
		page.evaluate(() => (window as unknown as { middleUps: boolean[] }).middleUps);

	// Select a word (fills PRIMARY on Linux), then middle-click elsewhere in the note.
	await body.getByText('one two').dblclick();
	const before = await body.innerText();
	await body.getByText('Alpha').click({ button: 'middle' });
	await page.waitForTimeout(200);
	expect(await body.innerText()).toBe(before);
	expect(await middleUps()).toEqual([true]);

	// A text field too.
	await page.keyboard.press('Control+f');
	const find = page.getByRole('textbox', { name: 'Find text' });
	await find.click({ button: 'middle' });
	await page.waitForTimeout(200);
	await expect(find).toHaveValue('');
	expect(await middleUps()).toEqual([true, true]);
	await page.keyboard.press('Escape');

	// Middle-click on a tab still closes it.
	await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Settings sections' })
		.getByRole('button', { name: /Editor/ })
		.click();
	await page.getByRole('switch', { name: 'Tabs' }).click();
	await page.getByRole('button', { name: 'Close settings' }).click();
	await list(page).getByText('Beta', { exact: true }).click();
	await expect(tabs).toHaveText(['Alpha', 'Beta']);
	await tabs.first().click({ button: 'middle' });
	await expect(tabs).toHaveText(['Beta']);
	await ctx.close();
});
