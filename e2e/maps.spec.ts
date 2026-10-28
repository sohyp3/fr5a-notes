import { expect, test, type Browser, type Page } from '@playwright/test';
import { installFakeApi } from './fakeApi';
import { enable } from './linkedNotesHelpers';

type Api = {
	createNote(title: string, folder: string, source: string): Promise<unknown>;
	readNote(id: string): Promise<string>;
	listNotes(): Promise<{ id: string; tags: string[] }[]>;
	getState(key: string): Promise<unknown>;
	setState(key: string, value: unknown): Promise<void>;
	writeMeta(rel: string, content: string): Promise<void>;
	deleteMeta(rel: string): Promise<void>;
};
type Win = { api: Api; __meta: Record<string, string>; __writes: { id: string }[] };
type SyncHarness = {
	done(): void;
	holdWrite: boolean;
	writeStarted: boolean;
	releaseWrite(): void;
	failRead: boolean;
	holdRead: boolean;
	readStarted: boolean;
	releaseRead(): void;
	pushSnapshot: Record<string, string>;
};

const MAP = 'maps/Atlas.canvas';

/**
 * The fake API with two #atlas notes (one by a child tag), tags read from the
 * text (the real indexers do that), and `.fr5a/` files + state kept in
 * sessionStorage, so a reload sees what the last page saved.
 */
async function install(page: Page): Promise<void> {
	await page.addInitScript(installFakeApi);
	await page.addInitScript(() => {
		const w = window as unknown as Win;
		const api = w.api;
		void api.createNote('Spec', 'Work', '# Spec\n\nAbout #atlas');
		void api.createNote('Design', 'Work', '# Design\n\nScreens #atlas/ui');
		const list = api.listNotes.bind(api);
		api.listNotes = async () =>
			Promise.all(
				(await list()).map(async (n) => ({
					...n,
					tags: [...(await api.readNote(n.id)).matchAll(/(?:^|\s)#(\p{L}[\p{L}\p{N}_/-]*)/gu)].map(
						(m) => m[1]
					)
				}))
			);
		const saved = JSON.parse(sessionStorage.getItem('e2e-meta') ?? '{}');
		Object.assign(w.__meta, saved);
		const keep = () => sessionStorage.setItem('e2e-meta', JSON.stringify(w.__meta));
		const write = api.writeMeta.bind(api);
		api.writeMeta = async (rel, content) => {
			await write(rel, content);
			keep();
		};
		const del = api.deleteMeta.bind(api);
		api.deleteMeta = async (rel) => {
			await del(rel);
			keep();
		};
		const state = JSON.parse(sessionStorage.getItem('e2e-state') ?? '{}');
		const get = api.getState.bind(api);
		api.getState = async (key) => (key in state ? state[key] : get(key));
		const set = api.setState.bind(api);
		api.setState = async (key, value) => {
			state[key] = value;
			sessionStorage.setItem('e2e-state', JSON.stringify(state));
			await set(key, value);
		};
	});
	await page.goto('/');
	await expect(page.locator('.body[data-layout]')).toBeVisible();
}

async function desktopPage(browser: Browser) {
	const ctx = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		isMobile: false,
		hasTouch: false
	});
	const page = await ctx.newPage();
	await install(page);
	return { ctx, page };
}

const savedMap = (page: Page) =>
	page.evaluate((rel) => {
		const text = (window as unknown as Win).__meta[rel];
		return text ? JSON.parse(text) : null;
	}, MAP) as Promise<{
		nodes: {
			id: string;
			type: string;
			text?: string;
			color?: string;
			file?: string;
			x: number;
			y: number;
			fr5a?: { tag?: string; exclude?: string[]; from?: string };
		}[];
		edges: { fromNode: string; toNode: string }[];
	} | null>;

/** Tablets keep Settings in the folders drawer. */
async function drawer(page: Page): Promise<void> {
	if ((await page.locator('.body').getAttribute('data-layout')) === 'tablet')
		await page.getByRole('button', { name: 'Open folders' }).click();
}

/** Settings → Links & maps → Mind maps on, then its Open button. */
async function openMaps(page: Page): Promise<void> {
	await drawer(page);
	await enable(page, 'Mind maps');
	await page.getByRole('button', { name: 'Open mind maps' }).click();
	await expect(page.getByRole('heading', { name: 'Mind maps' })).toBeVisible();
}

async function addIdea(page: Page, text: string, touch: boolean): Promise<void> {
	const map = page.getByRole('region', { name: 'Mind map Atlas' });
	if (touch) {
		await map.getByRole('button', { name: 'Add', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Idea' }).click();
	} else await map.getByRole('button', { name: 'Add an idea' }).click();
	const field = map.getByRole('textbox', { name: 'Idea text' });
	await expect(field).toBeFocused();
	await field.fill(text);
	await field.press('Enter');
	await expect(map.locator('.svelte-flow__node', { hasText: text })).toBeVisible();
}

async function newAtlas(page: Page): Promise<void> {
	await openMaps(page);
	await page.getByRole('button', { name: 'New map' }).click();
	await page.getByRole('dialog').getByRole('textbox').fill('Atlas');
	await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
	await expect(page.getByRole('region', { name: 'Mind map Atlas' })).toBeVisible();
}

test('opening an externally written map with malformed display fields does not crash', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await install(page);
	await page.evaluate(async (rel) => {
		await (window as unknown as Win).api.writeMeta(
			rel,
			JSON.stringify({
				nodes: [
					{ id: 'idea', type: 'text', text: 'Idea', x: 0, y: 0 },
					{ id: 'bad-file', type: 'file', file: { path: 'Work/Spec.md' }, x: 280, y: 0 }
				],
				edges: [{ id: 'edge', fromNode: 'idea', toNode: 'bad-file' }]
			})
		);
	}, MAP);
	await openMaps(page);
	await page.getByRole('button', { name: 'Atlas Mind map' }).click();
	const map = page.getByRole('region', { name: 'Mind map Atlas' });
	await expect(map.locator('.svelte-flow__node')).toHaveCount(1);
	await expect(map.locator('.svelte-flow__node', { hasText: 'Idea' })).toBeVisible();
	expect(errors).toEqual([]);
});

async function checkBackWhileSaving(p: Page, touch: boolean): Promise<void> {
	await newAtlas(p);
	await p.evaluate(
		() => ((window as unknown as { __syncHarness: SyncHarness }).__syncHarness.holdWrite = true)
	);
	await addIdea(p, 'Quick', touch);
	await expect
		.poll(() =>
			p.evaluate(
				() => (window as unknown as { __syncHarness: SyncHarness }).__syncHarness.writeStarted
			)
		)
		.toBe(true);
	await p.getByRole('button', { name: 'Back to maps' }).click();
	if (touch && (await p.getByRole('region', { name: 'Mind map Atlas' }).isVisible()))
		await p.getByRole('button', { name: 'Back to maps' }).click();
	await expect(p.getByRole('heading', { name: 'Mind maps' })).toBeVisible();
	await p.evaluate(() =>
		(window as unknown as { __syncHarness: SyncHarness }).__syncHarness.releaseWrite()
	);
	await expect
		.poll(async () => (await savedMap(p))?.nodes.some((n) => n.text === 'Quick'))
		.toBe(true);
	expect(await p.evaluate(() => Object.keys((window as unknown as Win).__meta))).not.toContain(
		'maps/null.canvas'
	);
	await expect(p.getByRole('dialog', { name: 'This map changed on disk' })).toHaveCount(0);
	await expect(p.getByRole('alertdialog', { name: 'This map changed on disk' })).toHaveCount(0);
}

test('Back while saving keeps the original map on phone and desktop', async ({
	browser,
	page
}, info) => {
	await checkBackWhileSaving(page, true);
	if (info.project.name === 'phone 390x844') {
		const d = await desktopPage(browser);
		await checkBackWhileSaving(d.page, false);
		await d.ctx.close();
	}
});

test('Push waits for a closed map save', async ({ browser }, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'desktop push controls');
	const { ctx, page } = await desktopPage(browser);
	await newAtlas(page);
	await page.evaluate(
		() => ((window as unknown as { __syncHarness: SyncHarness }).__syncHarness.holdWrite = true)
	);
	await addIdea(page, 'Latest', false);
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as unknown as { __syncHarness: SyncHarness }).__syncHarness.writeStarted
			)
		)
		.toBe(true);
	await page
		.getByRole('region', { name: 'Mind map Atlas' })
		.getByRole('button', { name: 'Close mind maps' })
		.click();
	await page.getByRole('button', { name: 'Push', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'pushing…' })).toBeVisible();
	expect(
		await page.evaluate(
			(rel) =>
				(window as unknown as { __syncHarness: SyncHarness }).__syncHarness.pushSnapshot[rel],
			MAP
		)
	).toBeUndefined();
	await page.evaluate(() =>
		(window as unknown as { __syncHarness: SyncHarness }).__syncHarness.releaseWrite()
	);
	await expect
		.poll(() =>
			page.evaluate(
				(rel) =>
					(window as unknown as { __syncHarness: SyncHarness }).__syncHarness.pushSnapshot[rel] ??
					'',
				MAP
			)
		)
		.toContain('Latest');
	await ctx.close();
});

test('sync refreshes open map, respects dirty edits, and explains removal', async ({
	browser
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'desktop sync controls');
	const { ctx, page } = await desktopPage(browser);
	await newAtlas(page);
	const map = page.getByRole('region', { name: 'Mind map Atlas' });
	await page.evaluate((rel) => {
		const w = window as unknown as Win;
		w.__meta[rel] = JSON.stringify({
			nodes: [{ id: 'remote', type: 'text', text: 'Remote', x: 20, y: 20, width: 180, height: 44 }],
			edges: []
		});
		(window as unknown as { __syncHarness: SyncHarness }).__syncHarness.done();
	}, MAP);
	await expect(map.getByText('Remote')).toBeVisible();
	await page.evaluate((rel) => {
		const w = window as unknown as Win;
		w.__meta[rel] = JSON.stringify({ nodes: [], edges: [] });
		(window as unknown as { __syncHarness: SyncHarness }).__syncHarness.done();
	}, MAP);
	await expect(map.getByText('Remote')).toHaveCount(0);
	await page.evaluate(
		() => ((window as unknown as { __syncHarness: SyncHarness }).__syncHarness.failRead = true)
	);
	await page.evaluate(() =>
		(window as unknown as { __syncHarness: SyncHarness }).__syncHarness.done()
	);
	await expect(map).toBeVisible();
	await expect(page.getByText(/Couldn’t refresh the map: EIO/)).toBeVisible();
	await page.evaluate(
		() => ((window as unknown as { __syncHarness: SyncHarness }).__syncHarness.failRead = false)
	);
	await page.evaluate((rel) => {
		delete (window as unknown as Win).__meta[rel];
		(window as unknown as { __syncHarness: SyncHarness }).__syncHarness.done();
	}, MAP);
	await expect(page.getByRole('heading', { name: 'Mind maps' })).toBeVisible();
	await expect(page.getByText(/removed or renamed by sync/)).toBeVisible();
	await ctx.close();
});

test('an in-flight refresh cannot navigate after leaving the map', async ({ browser }, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'desktop sync controls');
	const { ctx, page } = await desktopPage(browser);
	await newAtlas(page);
	await page.evaluate(() => {
		const h = (window as unknown as { __syncHarness: SyncHarness }).__syncHarness;
		h.holdRead = true;
		h.done();
	});
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as unknown as { __syncHarness: SyncHarness }).__syncHarness.readStarted
			)
		)
		.toBe(true);
	await page
		.getByRole('region', { name: 'Mind map Atlas' })
		.getByRole('button', { name: 'Back to maps' })
		.click();
	await page.getByRole('button', { name: 'Close mind maps' }).click();
	await page.evaluate(() => {
		const h = (window as unknown as { __syncHarness: SyncHarness }).__syncHarness;
		h.holdRead = false;
		h.releaseRead();
	});
	await expect(page.getByRole('heading', { name: 'Nothing open' })).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await ctx.close();
});

test('dirty open map asks before replacing local edits from sync', async ({ browser }, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'desktop sync controls');
	const { ctx, page } = await desktopPage(browser);
	await newAtlas(page);
	const map = page.getByRole('region', { name: 'Mind map Atlas' });
	await map.getByRole('button', { name: 'Add an idea' }).click();
	await map.getByRole('textbox', { name: 'Idea text' }).fill('Local');
	await page.evaluate((rel) => {
		(window as unknown as Win).__meta[rel] = JSON.stringify({
			nodes: [{ id: 'remote', type: 'text', text: 'Remote', x: 20, y: 20, width: 180, height: 44 }],
			edges: []
		});
		(window as unknown as { __syncHarness: SyncHarness }).__syncHarness.done();
	}, MAP);
	const dialog = page.getByRole('alertdialog', { name: 'This map changed on disk' });
	await expect(dialog).toBeVisible();
	await expect(map.getByText('Local')).toBeVisible();
	await dialog.getByRole('button', { name: 'Reload' }).click();
	await expect(
		page.getByRole('region', { name: 'Mind map Atlas' }).getByText('Remote')
	).toBeVisible();
	await ctx.close();
});

type Pt = { x: number; y: number };

/**
 * Press at `from`, move to `to` in steps, release; `mid` runs before the
 * release. Touch layouts drag with real touch events (CDP), mouse ones with the mouse.
 */
async function drag(page: Page, from: Pt, to: Pt, touch: boolean, mid?: () => Promise<void>) {
	const steps = 18;
	const at = (i: number) => ({
		x: from.x + ((to.x - from.x) * i) / steps,
		y: from.y + ((to.y - from.y) * i) / steps
	});
	if (touch) {
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
		for (let i = 1; i <= steps; i++)
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(i)] });
		await mid?.();
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await cdp.detach();
	} else {
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let i = 1; i <= steps; i++) await page.mouse.move(at(i).x, at(i).y);
		await mid?.();
		await page.mouse.up();
	}
}

const centreOf = (b: { x: number; y: number; width: number; height: number }) => ({
	x: b.x + b.width / 2,
	y: b.y + b.height / 2
});

const box = async (page: Page, text: string) =>
	(await page.locator('.svelte-flow__node', { hasText: text }).boundingBox())!;

async function buildMap(page: Page, touch: boolean): Promise<void> {
	await openMaps(page);
	await page.getByRole('button', { name: 'New map' }).click();
	await page.getByRole('dialog').getByRole('textbox').fill('Atlas');
	await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
	const map = page.getByRole('region', { name: 'Mind map Atlas' });
	await expect(map).toBeVisible();
	await expect(map.getByText('Add an idea, a note or a tag.')).toBeVisible();

	// Two islands: nothing joins them.
	await addIdea(page, 'First', touch);
	await addIdea(page, 'Second', touch);
	await expect(map.locator('.svelte-flow__edge')).toHaveCount(0);

	// Drag: the node follows the finger / pointer while it moves, not only on release.
	const start = await box(page, 'Second');
	const from = centreOf(start);
	await drag(page, from, { x: from.x + 150, y: from.y + 140 }, touch, async () => {
		const mid = await box(page, 'Second');
		expect(mid.x - start.x).toBeGreaterThan(120);
		expect(mid.y - start.y).toBeGreaterThan(110);
	});

	// Connect: select First (its handles show), drag from its right handle onto Second.
	await page.locator('.svelte-flow__node', { hasText: 'First' }).click();
	const handle = page
		.locator('.svelte-flow__node', { hasText: 'First' })
		.locator('.svelte-flow__handle[data-handlepos="right"]');
	await expect(handle).toHaveCSS('opacity', '1');
	await drag(
		page,
		centreOf((await handle.boundingBox())!),
		centreOf(await box(page, 'Second')),
		touch
	);
	await expect(map.locator('.svelte-flow__edge')).toHaveCount(1);

	// Saved (debounced) as JSON Canvas, positions included.
	await expect.poll(async () => (await savedMap(page))?.edges.length, { timeout: 4000 }).toBe(1);
}

/** A node's flow position as Svelte Flow draws it. */
const drawnAt = (page: Page, text: string) =>
	page.locator('.svelte-flow__node', { hasText: text }).evaluate((el) => {
		const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
			(el as HTMLElement).style.transform
		);
		return m ? { x: Math.round(+m[1]), y: Math.round(+m[2]) } : null;
	});

async function reopen(page: Page): Promise<void> {
	await page.reload();
	await expect(page.locator('.body[data-layout]')).toBeVisible();
	await drawer(page);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: /Links & maps/ }).click();
	await page.getByRole('button', { name: 'Open mind maps' }).click();
	await expect(page.getByRole('region', { name: 'Mind map Atlas' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await install(page);
});

test('desktop map color swatches, keyboard selection, and reopen without remount', async ({
	browser
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktopPage(browser);
	await openMaps(page);
	await page.getByRole('button', { name: 'New map' }).click();
	await page.getByRole('dialog').getByRole('textbox').fill('Atlas');
	await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
	await addIdea(page, 'Colored idea', false);
	const map = page.getByRole('region', { name: 'Mind map Atlas' });
	const node = map.locator('.svelte-flow__node', { hasText: 'Colored idea' });
	await node.click();
	await map.getByRole('button', { name: 'Color', exact: true }).click();
	const menu = page.getByRole('menu', { name: 'Map actions' });
	const none = menu.getByRole('menuitemradio', { name: 'No color' });
	const red = menu.getByRole('menuitemradio', { name: 'Red' });
	await expect(none).toHaveAttribute('aria-checked', 'true');
	await expect(red.locator('.swatch')).toHaveCSS('background-color', 'rgb(238, 93, 80)');
	await none.press('ArrowDown');
	await expect(red).toBeFocused();
	await red.press('Enter');
	await expect.poll(async () => (await savedMap(page))?.nodes[0]?.color).toBe('1');
	await page.getByRole('button', { name: 'Toggle theme' }).click();
	await map.getByRole('button', { name: 'Color', exact: true }).click();
	await expect(red).toHaveAttribute('aria-checked', 'true');
	await expect(red.locator('.swatch')).toHaveCSS('background-color', 'rgb(255, 106, 92)');
	await none.click();
	await expect.poll(async () => (await savedMap(page))?.nodes[0]?.color).toBeUndefined();
	// If Mod+G remounted the canvas, this DOM marker and the undo stack would vanish.
	await node.evaluate((el) => el.setAttribute('data-e2e-canvas', 'same'));
	await page.keyboard.press('Control+g');
	await expect(node).toHaveAttribute('data-e2e-canvas', 'same');
	await expect(map.getByRole('button', { name: 'Undo' })).toBeEnabled();
	await ctx.close();
});

test('renaming the last map keeps Mod+G pointed at its new name', async ({ browser }, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktopPage(browser);
	await openMaps(page);
	await page.getByRole('button', { name: 'New map' }).click();
	await page.getByRole('dialog').getByRole('textbox').fill('Atlas');
	await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
	await page
		.getByRole('region', { name: 'Mind map Atlas' })
		.getByRole('button', { name: 'Back to maps' })
		.click();
	await page.getByRole('button', { name: 'Actions for Atlas' }).click();
	await page.getByRole('menuitem', { name: 'Rename…' }).click();
	await page.getByRole('dialog').getByRole('textbox').fill('Renamed');
	await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
	await expect(page.getByRole('button', { name: 'Actions for Renamed' })).toBeVisible();
	await page.getByRole('button', { name: 'Close mind maps' }).click();
	await page.keyboard.press('Control+g');
	await expect(page.getByRole('region', { name: 'Mind map Renamed' })).toBeVisible();
	await ctx.close();
});

test('maps: islands, connect, live drag, persist, tag nodes (touch layouts)', async ({ page }) => {
	await buildMap(page, true);
	const map = page.getByRole('region', { name: 'Mind map Atlas' });
	const saved = (await savedMap(page))!;
	const second = saved.nodes.find((n) => n.text === 'Second')!;

	// Back closes the map, then the chooser lists it.
	await reopen(page);
	expect(await drawnAt(page, 'Second')).toEqual({ x: second.x, y: second.y });
	await expect(map.locator('.svelte-flow__edge')).toHaveCount(1);

	// A tag node gathers its notes (a child tag too) from the index: no note is read or written.
	const before = await page.evaluate(() => (window as unknown as Win).__writes.length);
	await map.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Tag…' }).click();
	await page.getByRole('dialog').getByRole('textbox').fill('atlas');
	await page.getByRole('dialog').getByRole('textbox').press('Enter');
	await expect(map.locator('.svelte-flow__node', { hasText: '#atlas' })).toBeVisible();
	await expect(map.locator('.map-node.note')).toHaveCount(2);
	await expect(map.locator('.svelte-flow__edge')).toHaveCount(3);

	// Delete one (tap selects; the selection bar deletes): it's taken off the tag for good.
	await map.locator('.svelte-flow__node', { hasText: 'Design' }).click();
	await page
		.getByRole('toolbar', { name: 'Selection' })
		.getByRole('button', { name: 'Delete' })
		.click();
	await expect(map.locator('.map-node.note')).toHaveCount(1);
	await expect
		.poll(async () => (await savedMap(page))?.nodes.find((n) => n.fr5a?.tag)?.fr5a?.exclude)
		.toEqual(['Work/Design.md']);
	await expect(map.getByRole('button', { name: /new/ })).toHaveCount(0);

	await reopen(page);
	await expect(map.locator('.map-node.note')).toHaveCount(1);
	await expect(map.getByRole('button', { name: /new/ })).toHaveCount(0);
	// The tag and the notes are untouched.
	expect(await page.evaluate(() => (window as unknown as Win).__writes.length)).toBe(before);
	expect(await page.evaluate(() => (window as unknown as Win).api.readNote('Work/Design.md'))).toBe(
		'# Design\n\nScreens #atlas/ui'
	);
});

test('desktop maps: closing the window writes a pending map save at once', async ({
	browser
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktopPage(browser);
	await openMaps(page);
	await page.getByRole('button', { name: 'New map' }).click();
	await page.getByRole('dialog').getByRole('textbox').fill('Atlas');
	await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
	await addIdea(page, 'Unsaved', false);
	// Within the 500 ms debounce: the host's leave callback (window close / quit) flushes it.
	await page.evaluate(() => (window as unknown as { __leave: () => Promise<void> }).__leave());
	expect((await savedMap(page))?.nodes.map((n) => n.text)).toEqual(['Unsaved']);
	await ctx.close();
});

test('desktop maps: build, persist, tag nodes, undo, rename follows', async ({ browser }, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktopPage(browser);
	await buildMap(page, false);
	const map = page.getByRole('region', { name: 'Mind map Atlas' });

	// Undo takes the edge back, redo returns it.
	await page.keyboard.press('Control+z');
	await expect(map.locator('.svelte-flow__edge')).toHaveCount(0);
	await page.keyboard.press('Control+Shift+z');
	await expect(map.locator('.svelte-flow__edge')).toHaveCount(1);

	// Tab adds a connected idea after the selection.
	await map.locator('.svelte-flow__node', { hasText: 'First' }).click();
	await page.keyboard.press('Tab');
	const field = map.getByRole('textbox', { name: 'Idea text' });
	await expect(field).toBeFocused();
	await field.fill('Child');
	await field.press('Enter');
	await expect(map.locator('.svelte-flow__edge')).toHaveCount(2);

	// Tag node, then Delete on a selected note.
	await map.getByRole('button', { name: 'Add a tag' }).click();
	await page.getByRole('dialog').getByRole('textbox').fill('atlas');
	await page.keyboard.press('Enter');
	await expect(map.locator('.map-node.note')).toHaveCount(2);
	await map.locator('.svelte-flow__node', { hasText: 'Design' }).click();
	await page.keyboard.press('Delete');
	await expect(map.locator('.map-node.note')).toHaveCount(1);
	await expect
		.poll(async () => (await savedMap(page))?.nodes.find((n) => n.fr5a?.tag)?.fr5a?.exclude)
		.toEqual(['Work/Design.md']);

	// Mod+G reopens the last map after a reload, positions as saved.
	const saved = (await savedMap(page))!;
	await page.reload();
	await expect(page.locator('.body[data-layout="desktop"]')).toBeVisible();
	await page.keyboard.press('Control+g');
	await expect(map).toBeVisible();
	const child = saved.nodes.find((n) => n.text === 'Child')!;
	expect(await drawnAt(page, 'Child')).toEqual({ x: child.x, y: child.y });
	await expect(map.locator('.map-node.note')).toHaveCount(1);

	// Renaming a note in the app re-points the map at it.
	await map.getByRole('button', { name: 'Close mind maps' }).click();
	await page.getByRole('button', { name: /^All Notes/ }).click();
	await page.locator('.card', { hasText: 'Spec' }).first().click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Rename…' }).click();
	await page.getByRole('dialog').getByRole('textbox').fill('Specification');
	await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
	await expect
		.poll(async () => (await savedMap(page))?.nodes.filter((n) => n.file).map((n) => n.file))
		.toEqual(['Work/Specification.md']);
	await page.keyboard.press('Control+g');
	await expect(map.locator('.map-node.note', { hasText: 'Spec' })).toBeVisible();
	await expect(map.locator('.map-node.missing')).toHaveCount(0);
	await page.screenshot({ path: info.outputPath('map-desktop.png') });
	await ctx.close();
});

test('mind maps off: the map code is never requested', async ({ page }) => {
	const loaded: string[] = [];
	page.on('request', (r) => loaded.push(r.url()));
	await page.reload();
	await expect(page.locator('.body[data-layout]')).toBeVisible();
	await drawer(page);
	await enable(page);
	await page.getByRole('button', { name: 'Open the graph' }).click();
	await expect(page.getByRole('region', { name: 'All notes map' })).toBeVisible();
	const map = loaded.filter((u) => /xyflow|dagre|MapEditor|MapCanvas|lib\/maps\//.test(u));
	expect(map).toEqual([]);
});

test('desktop maps: a change on disk asks Reload / Keep mine; Tidy; graph-only Mod+G', async ({
	browser
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktopPage(browser);
	await buildMap(page, false);
	const map = page.getByRole('region', { name: 'Mind map Atlas' });
	/** Another device (a pull) adds a node to the file. */
	const outside = (text: string) =>
		page.evaluate(
			([rel, text]) => {
				const w = window as unknown as Win;
				const doc = JSON.parse(w.__meta[rel]);
				doc.nodes.push({ id: text, type: 'text', text, x: -400, y: -300, width: 180, height: 44 });
				w.__meta[rel] = JSON.stringify(doc);
			},
			[MAP, text]
		);
	const texts = async () => (await savedMap(page))!.nodes.map((n) => n.text).filter(Boolean);
	const dialog = page.getByRole('alertdialog');

	// Reload: the disk's version shows and stays; the edit made here is dropped.
	await outside('Outside');
	await addIdea(page, 'Mine', false);
	await expect(dialog.getByText('This map changed on disk')).toBeVisible();
	await dialog.getByRole('button', { name: 'Reload' }).click();
	await expect(map.locator('.svelte-flow__node', { hasText: 'Outside' })).toBeVisible();
	await expect(map.locator('.svelte-flow__node', { hasText: 'Mine' })).toHaveCount(0);
	expect(await texts()).toEqual(['First', 'Second', 'Outside']);

	// Keep mine: this canvas is written over the disk's.
	await outside('Elsewhere');
	await addIdea(page, 'Kept', false);
	await expect(dialog.getByText('This map changed on disk')).toBeVisible();
	await dialog.getByRole('button', { name: 'Keep mine' }).click();
	await expect.poll(texts).toEqual(['First', 'Second', 'Outside', 'Kept']);
	await expect(dialog).toHaveCount(0);

	// Tidy lays the connected pair out left to right and saves it.
	const before = (await savedMap(page))!;
	await map.getByRole('button', { name: 'Tidy' }).click();
	// (A long wait: the dev server compiles dagre on its first import.)
	await expect
		.poll(
			async () => {
				const after = (await savedMap(page))!.nodes;
				const at = (t: string) => after.find((n) => n.text === t)!;
				return (
					at('First').x < at('Second').x && JSON.stringify(after) !== JSON.stringify(before.nodes)
				);
			},
			{ timeout: 15000 }
		)
		.toBe(true);

	// Mind maps off with this map remembered: Mod+G opens the graph, not a blank view.
	await map.getByRole('button', { name: 'Close mind maps' }).click();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: /Links & maps/ }).click();
	await page.getByRole('switch', { name: 'Note links & graph', exact: true }).click();
	await page.getByRole('switch', { name: 'Mind maps', exact: true }).click();
	await expect(page.getByRole('switch', { name: 'Mind maps', exact: true })).toHaveAttribute(
		'aria-checked',
		'false'
	);
	await page.keyboard.press('Escape');
	await page.keyboard.press('Control+g');
	await expect(page.getByRole('region', { name: 'All notes map' })).toBeVisible();
	await page.reload();
	await expect(page.locator('.body[data-layout="desktop"]')).toBeVisible();
	await page.keyboard.press('Control+g');
	await expect(page.getByRole('region', { name: 'All notes map' })).toBeVisible();
	await ctx.close();
});

test('selection mode supports group actions, magnet aligns positions, and undo restores deletion', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	try {
		await newAtlas(page);
		await addIdea(page, 'First idea', false);
		await addIdea(page, 'Second idea', false);
		const map = page.getByRole('region', { name: 'Mind map Atlas' });
		const cards = map.locator('.svelte-flow__node');
		const a = await cards.nth(0).boundingBox(),
			b = await cards.nth(1).boundingBox();
		expect(
			a &&
				b &&
				(a.x + a.width <= b.x ||
					b.x + b.width <= a.x ||
					a.y + a.height <= b.y ||
					b.y + b.height <= a.y)
		).toBeTruthy();
		await map.getByRole('button', { name: 'Snap to grid', exact: true }).click();
		await expect(map.getByRole('button', { name: 'Snap to grid', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect
			.poll(async () =>
				(await savedMap(page))?.nodes.every((n) => n.x % 20 === 0 && n.y % 20 === 0)
			)
			.toBe(true);
		await map.getByRole('button', { name: 'Select multiple nodes' }).click();
		// The newest idea was selected when created. Toggle it off, then select both.
		await cards.filter({ hasText: 'Second idea' }).click();
		await cards.filter({ hasText: 'First idea' }).click();
		await cards.filter({ hasText: 'Second idea' }).click();
		await expect(map.getByText('2 selected', { exact: true })).toBeVisible();
		await page.screenshot({ path: 'test-results/maps-desktop-selection.png' });
		await map.getByRole('button', { name: 'Select multiple nodes' }).click();
		await expect(cards.nth(0)).toHaveClass(/draggable/);
		const before = await cards.evaluateAll((els) =>
			els.map((el) => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y }))
		);
		const drag = await cards.nth(0).boundingBox();
		await page.mouse.move(drag!.x + drag!.width / 2, drag!.y + drag!.height / 2);
		await page.mouse.down();
		await page.mouse.move(drag!.x + drag!.width / 2 + 60, drag!.y + drag!.height / 2 + 40, {
			steps: 8
		});
		await page.mouse.up();
		await expect
			.poll(async () => (await cards.nth(0).boundingBox())!.x - before[0].x)
			.toBeGreaterThan(20);
		const after = await cards.evaluateAll((els) =>
			els.map((el) => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y }))
		);
		expect(after[0].x - before[0].x).toBeGreaterThan(20);
		expect(Math.abs(after[0].x - before[0].x - (after[1].x - before[1].x))).toBeLessThan(2);
		await map.getByRole('button', { name: 'Undo', exact: true }).click();
		await map.getByRole('button', { name: 'Redo', exact: true }).click();
		await map.getByRole('button', { name: 'Select multiple nodes' }).click();
		await cards.filter({ hasText: 'First idea' }).click();
		await cards.filter({ hasText: 'Second idea' }).click();
		await map.getByRole('button', { name: 'Delete selected nodes' }).click();
		await expect(cards).toHaveCount(0);
		await map.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(cards).toHaveCount(2);
		await map.getByRole('button', { name: 'Zoom in', exact: true }).click();
		await map.getByRole('button', { name: 'Zoom out', exact: true }).click();
	} finally {
		await ctx.close();
	}
});

test('touch selection exposes group actions without modifier keys', async ({ page }) => {
	await install(page);
	await newAtlas(page);
	await addIdea(page, 'Touch first', true);
	await addIdea(page, 'Touch second', true);
	const map = page.getByRole('region', { name: 'Mind map Atlas' });
	await map.getByRole('button', { name: 'Fit the map' }).click();
	await map.getByRole('button', { name: 'Select multiple nodes' }).click();
	await map.locator('.svelte-flow__node').filter({ hasText: 'Touch second' }).tap();
	await map.locator('.svelte-flow__node').filter({ hasText: 'Touch first' }).tap();
	await map.locator('.svelte-flow__node').filter({ hasText: 'Touch second' }).tap();
	await expect(map.getByText('2 selected', { exact: true })).toBeVisible();
	await page.screenshot({
		path: `test-results/maps-touch-selection-${test.info().project.name.replaceAll(' ', '-')}.png`
	});
});

test('mixed tag and note group deletion preserves surviving tag exclusions and undo', async ({
	browser
}) => {
	const { ctx, page } = await desktopPage(browser);
	try {
		await page.evaluate(async (rel) => {
			await (window as unknown as Win).api.writeMeta(
				rel,
				JSON.stringify({
					nodes: [
						{
							id: 'tag-a',
							type: 'text',
							text: '#atlas',
							x: 0,
							y: 0,
							width: 160,
							height: 44,
							fr5a: { tag: 'atlas', exclude: [] }
						},
						{
							id: 'tag-b',
							type: 'text',
							text: '#atlas/ui',
							x: 0,
							y: 180,
							width: 160,
							height: 44,
							fr5a: { tag: 'atlas/ui', exclude: [] }
						},
						{
							id: 'design',
							type: 'file',
							file: 'Work/Design.md',
							x: 300,
							y: 0,
							width: 240,
							height: 72,
							fr5a: { from: 'tag-a' }
						}
					],
					edges: [
						{ id: 'a-design', fromNode: 'tag-a', toNode: 'design' },
						{ id: 'b-design', fromNode: 'tag-b', toNode: 'design' }
					]
				})
			);
		}, MAP);
		await openMaps(page);
		await page.getByRole('button', { name: 'Atlas Mind map' }).click();
		const map = page.getByRole('region', { name: 'Mind map Atlas' });
		await expect(map.locator('.svelte-flow__node')).toHaveCount(3);
		await map.getByRole('button', { name: 'Select multiple nodes' }).click();
		await map.locator('.svelte-flow__node[data-id="tag-a"] .text').click();
		await map.locator('.svelte-flow__node[data-id="design"]').click();
		await expect(map.getByText('2 selected', { exact: true })).toBeVisible();
		await map.getByRole('button', { name: 'Delete selected nodes' }).click();
		await expect(map.locator('.svelte-flow__node')).toHaveCount(1);
		await expect
			.poll(async () => (await savedMap(page))?.nodes.find((n) => n.id === 'tag-b')?.fr5a?.exclude)
			.toEqual(['Work/Design.md']);
		expect((await savedMap(page))?.edges).toHaveLength(0);
		await map.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(map.locator('.svelte-flow__node')).toHaveCount(3);
		await expect(map.locator('.svelte-flow__edge')).toHaveCount(2);
		await expect
			.poll(async () => (await savedMap(page))?.nodes.find((n) => n.id === 'tag-b')?.fr5a?.exclude)
			.toEqual([]);
		expect(
			await page.evaluate(() => (window as unknown as Win).api.readNote('Work/Design.md'))
		).toBe('# Design\n\nScreens #atlas/ui');
	} finally {
		await ctx.close();
	}
});
