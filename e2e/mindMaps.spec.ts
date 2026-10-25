import { expect, test, type Page } from '@playwright/test';
import { parseMindMap } from '../src/shared/mindMap';
import { desktop, enable, installLinkedApi, type FakeApi } from './linkedNotesHelpers';

const authoredMap = `---
owner: retained # keep this comment
mindmap:
  version: 1
  root: root
  nodes:
    - id: root
      label: Project Atlas
      children: [research, build, lost]
    - id: research
      note: hello.md
    - id: build
      label: Build
    - id: lost
      note: Missing.md
---
# Acceptance map

Keep this Markdown body exactly. #map
`;

async function seededMap(page: Page, source = authoredMap): Promise<void> {
	await page.addInitScript((source) => {
		const state = window as unknown as {
			api: FakeApi;
			holdMapWrites?: boolean;
			releaseMapWrite?: () => void;
		};
		void state.api.createNote('Acceptance map', '', source);
		const write = state.api.writeNote.bind(state.api);
		state.api.writeNote = async (id, content) => {
			if (id === 'Acceptance_map.md' && state.holdMapWrites)
				await new Promise<void>((resolve) => {
					state.releaseMapWrite = resolve;
				});
			await write(id, content);
		};
	}, source);
	await page.reload();
	await enable(page);
	await page.getByRole('button', { name: 'Open mind maps' }).click();
	const entry = page.getByRole('button', { name: /Acceptance map.*Acceptance_map.md/ });
	await expect(entry).toBeVisible();
	await entry.click();
}

const readMap = (page: Page) =>
	page.evaluate(() => (window as unknown as { api: FakeApi }).api.readNote('Acceptance_map.md'));

test.beforeEach(async ({ page }) => {
	await installLinkedApi(page);
	await expect(page.locator('.body[data-layout]')).toBeVisible();
});

test('desktop: creates and visually edits a Markdown-backed mind map', async ({
	browser
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktop(browser);
	await enable(page);
	await page.getByRole('button', { name: /^All Notes/ }).click();
	await page.getByText('Hello', { exact: true }).first().click();
	await page.keyboard.press('Control+g');
	await expect(page.getByRole('heading', { name: 'Mind maps' })).toBeVisible();
	await page.getByRole('button', { name: 'Create from this note' }).click();

	const map = page.getByRole('region', { name: 'Mind map' });
	await expect(map).toBeVisible();
	await expect(map.getByRole('button', { name: 'Hello, root' })).toBeVisible();
	await map.getByRole('button', { name: 'Add child' }).click();
	const prompt = page.getByRole('dialog');
	await prompt.getByLabel('Concept label').fill('Questions');
	await prompt.getByRole('button', { name: 'Add' }).click();
	await expect(map.getByRole('button', { name: 'Questions, concept' })).toBeVisible();

	const node = map.getByRole('button', { name: 'Questions, concept' });
	const root = map.getByRole('button', { name: 'Hello, root' });
	await expect(map.locator('.canvas .node[tabindex="0"]')).toHaveCount(1);
	await root.focus();
	const rootBox = await root.boundingBox();
	const childBox = await node.boundingBox();
	expect(rootBox).not.toBeNull();
	expect(childBox).not.toBeNull();
	await root.press(childBox!.x > rootBox!.x ? 'ArrowRight' : 'ArrowLeft');
	await expect(node).toBeFocused();
	await expect(node).toHaveAttribute('tabindex', '0');
	await expect(map.locator('.canvas .node[tabindex="0"]')).toHaveCount(1);
	await node.hover();
	const box = await node.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await page.mouse.down();
	await page.mouse.move(box!.x + box!.width / 2 + 90, box!.y + box!.height / 2 + 35);
	await page.mouse.up();
	await expect
		.poll(
			async () =>
				parseMindMap(
					await page.evaluate(
						() =>
							(window as unknown as { __writes: { content: string }[] }).__writes.at(-1)?.content ??
							''
					)
				).config?.nodes.find((item) => item.id === 'questions')?.position
		)
		.toBeDefined();
	await map.getByRole('button', { name: 'Fit', exact: true }).click();
	await expect(map.locator('[data-node="root"]')).toBeInViewport({ ratio: 1 });
	await expect(node).toBeInViewport({ ratio: 1 });
	await expect(map.getByRole('combobox', { name: /^Depth/ })).toHaveValue('1');
	await page.screenshot({ path: info.outputPath('curated-mind-map.png') });

	await map.getByRole('button', { name: 'Edit source' }).first().click();
	await expect(page.locator('.ProseMirror')).toContainText('mindmap:');
	await page.screenshot({ path: info.outputPath('curated-mind-map-source.png') });
	await ctx.close();
});

test('phone: curated map starts at the root with a full-height editing sheet', async ({
	page
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'phone layout only');
	await enable(page);
	await page.getByRole('button', { name: 'Open mind maps' }).tap();
	await page.getByRole('button', { name: 'Create mind map' }).tap();
	const map = page.getByRole('region', { name: 'Mind map' });
	const root = map.getByRole('button', { name: 'Central idea, root' });
	await expect(root).toBeVisible();
	await expect(page.locator('.titlebar')).toBeVisible();
	await page.waitForTimeout(250);
	await page.screenshot({ path: info.outputPath('curated-mind-map-phone-root.png') });
	await root.tap();
	const inspector = map.getByRole('complementary', { name: 'Map inspector' });
	await expect(inspector).toBeVisible();
	await expect(inspector).toHaveCSS('position', 'absolute');
	await expect(map.getByRole('button', { name: 'Add child' })).toHaveCSS('min-height', '48px');
	await page.screenshot({ path: info.outputPath('curated-mind-map-phone.png') });
	await page.getByRole('button', { name: 'Back' }).tap();
	await expect(inspector).not.toHaveClass(/open/);
	await expect(root).toBeVisible();
});

test('curated authoring: expand, pin, reparent, label connections, repair, and reopen', async ({
	browser
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktop(browser);
	await seededMap(page);
	const map = page.getByRole('region', { name: 'Mind map' });
	await map.locator('[data-node="research"]').click();
	await map.getByLabel('Automatic links').selectOption('both');
	const derived = map.locator('.node.derived').filter({ hasText: 'Plan' });
	await expect(derived).toBeVisible();
	await map.getByRole('button', { name: 'Fit', exact: true }).click();
	await expect(derived).toBeInViewport({ ratio: 1 });
	await derived.click();
	await map.getByRole('button', { name: 'Pin to map' }).click();
	await expect(map.locator('.node.derived').filter({ hasText: 'Plan' })).toHaveCount(0);
	await expect(map.getByRole('alert')).toHaveCount(0);
	await expect(map.getByRole('complementary')).toContainText('Plan');
	await map.getByRole('combobox', { name: /^Parent/ }).selectOption('build');
	await expect
		.poll(
			async () =>
				parseMindMap(await readMap(page)).config?.nodes.find((node) => node.id === 'build')
					?.children
		)
		.toContain('plan');
	await map.getByRole('button', { name: 'Connect', exact: true }).click();
	await map.locator('[data-node="root"]').click();
	await map
		.getByRole('complementary')
		.getByRole('button', { name: 'Project Atlas', exact: true })
		.click();
	await page.getByRole('dialog').getByLabel('Connection label').fill('informs');
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(map.locator('svg text')).toContainText('informs');
	await map.locator('[data-node="lost"]').click();
	await map.getByRole('button', { name: 'Repair reference' }).click();
	await page.getByRole('dialog').getByLabel('Workspace-relative Markdown path').fill('/hello.md');
	await page.getByRole('dialog').getByRole('button', { name: 'Update', exact: true }).click();
	await expect(map.locator('[data-node="lost"]')).not.toHaveClass(/missing/);
	await map.locator('[data-node="build"]').click();
	await map.locator('[data-node="build"]').dblclick();
	await map.getByRole('textbox', { name: 'Node label' }).fill('البناء Build');
	await map.getByRole('textbox', { name: 'Node label' }).press('Enter');
	await expect(map.locator('[data-node="build"]')).toContainText('البناء Build');
	const saved = await readMap(page);
	expect(saved).toContain('owner: retained # keep this comment');
	expect(saved.endsWith('Keep this Markdown body exactly. #map\n')).toBe(true);
	await map.getByRole('button', { name: 'Choose a map' }).click();
	await page.getByRole('button', { name: /Acceptance map.*Acceptance_map.md/ }).click();
	await expect(map.locator('[data-node="build"]')).toContainText('البناء Build');
	await map.locator('.outline summary').focus();
	await page.keyboard.press('Enter');
	const tree = map.getByRole('tree');
	const root = tree.getByRole('treeitem', { name: 'Project Atlas', exact: true });
	await root.focus();
	await root.press('ArrowRight');
	await expect(tree.locator('[data-outline="research"]')).toBeFocused();
	await expect(tree.locator('[data-outline="research"]')).toHaveAttribute('aria-level', '2');
	await page.screenshot({ path: info.outputPath('curated-mind-map-authoring.png') });
	await map.getByRole('button', { name: 'Reflow', exact: true }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Reflow', exact: true }).click();
	await expect
		.poll(async () =>
			parseMindMap(await readMap(page)).config?.nodes.every((node) => node.position !== undefined)
		)
		.toBe(true);
	await map.locator('[data-node="plan"]').click();
	await map.getByRole('button', { name: 'Remove from map' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click();
	await expect(map.locator('[data-node="plan"]')).toHaveCount(0);
	expect(
		await page.evaluate(() => (window as unknown as { api: FakeApi }).api.readNote('Work/plan.md'))
	).toContain('# Plan');
	await ctx.close();
});

test('curated source: invalid YAML stays read-only and external source is never overwritten', async ({
	browser
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktop(browser);
	const invalid = authoredMap.replace('root: root', 'root: [');
	await seededMap(page, invalid);
	const map = page.getByRole('region', { name: 'Mind map' });
	await expect(map.getByRole('alert')).toContainText('Line');
	await expect(map.getByRole('heading', { name: 'The map source needs attention' })).toBeVisible();
	await expect(map.getByRole('button', { name: 'Reflow', exact: true })).toBeDisabled();
	await expect(map.getByRole('button', { name: 'Add child' })).toHaveCount(0);
	expect(await readMap(page)).toBe(invalid);
	await map.getByRole('button', { name: 'Edit source' }).first().click();
	await expect(page.locator('.ProseMirror')).toContainText('mindmap:');
	await page.evaluate(
		(source) => (window as unknown as { api: FakeApi }).api.writeNote('Acceptance_map.md', source),
		authoredMap
	);
	await page.keyboard.press('Control+g');
	await expect(map.locator('[data-node="root"]')).toBeVisible();
	await map.getByRole('button', { name: 'Edit source' }).first().click();
	const labelLine = page.locator('.ProseMirror p').filter({ hasText: 'label: Project Atlas' });
	await labelLine.click();
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await page.keyboard.insertText('      label: Source edited');
	await page.keyboard.press('Control+g');
	await expect(map.locator('[data-node="root"]')).toContainText('Source edited');
	const external = authoredMap.replace('label: Project Atlas', 'label: External change');
	await page.evaluate(
		(source) => (window as unknown as { api: FakeApi }).api.writeNote('Acceptance_map.md', source),
		external
	);
	await map.getByRole('button', { name: 'Add child' }).click();
	await page.getByRole('dialog').getByLabel('Concept label').fill('Must not overwrite');
	await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
	await expect(map.getByRole('alert')).toContainText('source changed outside');
	expect(await readMap(page)).toBe(external);
	await map.getByRole('button', { name: 'Reload map' }).click();
	await expect(map.locator('[data-node="root"]')).toContainText('External change');
	await ctx.close();
});

test('desktop: a note context menu opens its curated map', async ({ browser }, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktop(browser);
	await seededMap(page);
	await page.getByRole('button', { name: /^All Notes/ }).click();
	const card = page.getByRole('listitem').filter({ hasText: 'Acceptance map' });
	await card.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Open mind map', exact: true }).click();
	const map = page.getByRole('region', { name: 'Mind map' });
	await expect(map.locator('[data-node="root"]')).toContainText('Project Atlas');
	await ctx.close();
});

test('desktop: map mutations stay disabled through prompts and pending writes', async ({
	browser
}, info) => {
	test.skip(info.project.name !== 'phone 390x844', 'one desktop run is enough');
	const { ctx, page } = await desktop(browser);
	await seededMap(page);
	const map = page.getByRole('region', { name: 'Mind map' });
	await map.locator('[data-node="root"]').click();
	const add = map.getByRole('button', { name: 'Add child', exact: true });
	const reflow = map.getByRole('button', { name: 'Reflow', exact: true });
	await add.click();
	await expect(add).toBeDisabled();
	await expect(reflow).toBeDisabled();
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(add).toBeEnabled();
	await expect(reflow).toBeEnabled();

	await page.evaluate(() => {
		(window as unknown as { holdMapWrites: boolean }).holdMapWrites = true;
	});
	await add.click();
	await page.getByRole('dialog').getByLabel('Concept label').fill('Accepted child');
	await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() => typeof (window as unknown as { releaseMapWrite?: () => void }).releaseMapWrite
			)
		)
		.toBe('function');
	await expect(add).toBeDisabled();
	await expect(reflow).toBeDisabled();
	await page.evaluate(() =>
		(window as unknown as { releaseMapWrite: () => void }).releaseMapWrite()
	);
	await expect(
		map.getByRole('button', { name: 'Accepted child, concept', exact: true })
	).toBeVisible();
	await expect(add).toBeEnabled();
	expect(
		parseMindMap(await readMap(page)).config?.nodes.filter(
			(node) => node.label === 'Accepted child'
		)
	).toHaveLength(1);
	await ctx.close();
});
