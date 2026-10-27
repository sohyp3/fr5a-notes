import { expect, test } from '@playwright/test';
import { installFakeApi } from './fakeApi';

test.beforeEach(async ({ page }, info) => {
	test.skip(!info.project.name.startsWith('phone'), 'Phone navigation and swipe flow');
	await page.addInitScript(installFakeApi);
	await page.goto('/');
	await page.getByRole('button', { name: /^Work \d+$/ }).click();
	await page.getByText('Plan', { exact: true }).click();
	await page.getByRole('button', { name: 'Toggle AI harness' }).click();
});

test('precise AI edit can be rejected or approved without replacing the note', async ({ page }) => {
	const harness = page.getByRole('region', { name: 'AI harness' });
	const input = harness.getByRole('textbox', { name: 'Message' });
	await input.fill('edit plan precisely?');
	await input.press('Enter');
	await expect(harness.getByText(/edit → Work\/plan.md/)).toBeVisible();
	await harness.getByRole('button', { name: 'Reject' }).click();
	await expect(harness.getByText(/user rejected this change/)).toBeVisible();
	await input.fill('edit plan precisely?');
	await input.press('Enter');
	await harness.getByRole('button', { name: 'Apply' }).click();
	await expect(harness.getByText('Done: Edited Work/plan.md')).toBeVisible();
	await expect(page.locator('.ProseMirror')).toContainText('edited line');
});

test('AI deletion requires two approvals and is restorable from Trash', async ({ page }) => {
	const harness = page.getByRole('region', { name: 'AI harness' });
	const input = harness.getByRole('textbox', { name: 'Message' });
	await input.fill('trash plan?');
	await input.press('Enter');
	await expect(harness.getByText(/delete → Plan \(Work\/plan.md\)/)).toBeVisible();
	await harness.getByRole('button', { name: 'Continue to confirmation' }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toContainText('Work/plan.md');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(harness.getByText(/user rejected deletion/)).toBeVisible();
	await input.fill('trash plan?');
	await input.press('Enter');
	await harness.getByRole('button', { name: 'Continue to confirmation' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
	await expect(harness.getByText(/Moved Work\/plan.md to Trash/)).toBeVisible();
	await harness.getByRole('button', { name: 'Close AI pane' }).click();
	await page.getByRole('button', { name: 'Back' }).click();
	await page.getByRole('button', { name: /^Trash/ }).click();
	await expect(page.getByText('Plan', { exact: true })).toBeVisible();
	const card = page.getByRole('button', { name: /Plan/ });
	const box = (await card.boundingBox())!;
	const cdp = await page.context().newCDPSession(page);
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
	for (let i = 1; i <= 10; i++)
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: x + i * 15, y }]
		});
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await page.getByRole('button', { name: 'Restore', exact: true }).click();
	await page.getByRole('button', { name: 'Back' }).click();
	await page.getByRole('button', { name: /^Work \d+$/ }).click();
	await expect(page.getByText('Plan', { exact: true })).toBeVisible();
});
