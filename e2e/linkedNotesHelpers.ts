import { expect, type Browser, type Page } from '@playwright/test';
import { installFakeApi } from './fakeApi';

export type FakeApi = {
	readNote(id: string): Promise<string>;
	writeNote(id: string, source: string): Promise<void>;
	createNote(title: string, folder: string, source: string): Promise<unknown>;
	listNotes(): Promise<{ id: string; tags: string[] }[]>;
};

/** Plan links to Hello and to a note that doesn't exist; Hello links back; Plan is tagged #work. */
export async function installLinkedApi(page: Page): Promise<void> {
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

export async function enable(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: /Links & maps/ }).click();
	await page.getByRole('switch', { name: 'Enable links and maps' }).click();
	await expect(page.getByRole('switch', { name: 'Enable links and maps' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
}

export async function desktop(browser: Browser) {
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
