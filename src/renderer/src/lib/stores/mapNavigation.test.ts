import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readMap, saved, setState } = vi.hoisted(() => ({
	readMap: vi.fn(),
	saved: vi.fn(() => Promise.resolve()),
	setState: vi.fn()
}));
vi.mock('../platform', () => ({
	platform: { setState },
	hostPlatform: {},
	isMobile: false
}));
vi.mock('../maps/files', () => ({ readMap, saved }));

import { getAppState } from './app.svelte';

const state = Object.assign(<T>(value: T) => value, {
	raw: <T>(value: T) => value,
	snapshot: <T>(value: T) => value
});
vi.stubGlobal('$state', state);
vi.stubGlobal(
	'$derived',
	Object.assign(<T>(value: T) => value, { by: <T>(fn: () => T) => fn() })
);
vi.stubGlobal('document', {
	documentElement: { setAttribute: vi.fn(), removeAttribute: vi.fn() }
});

const settle = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('mind map navigation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const app = getAppState();
		app.settings = { ...app.settings, mindMaps: true, linkedNotes: true };
		app.graphDismiss = null;
		app.setLayout('phone', false);
		app.openMindMap('Planning');
	});

	it('persists the opened map and leaves an already-open canvas untouched', () => {
		const app = getAppState();
		expect(setState).toHaveBeenCalledWith('lastMindMap', 'Planning');
		app.openGraph();
		expect(app.activeMindMap).toBe('Planning');
		expect(app.view).toBe('graph');
		expect(readMap).not.toHaveBeenCalled();
	});

	it('Back visits the chooser, Close exits, and Mod+G reopens the last map', async () => {
		const app = getAppState();
		readMap.mockResolvedValue('{"nodes":[],"edges":[]}');
		expect(app.back()).toBe(true);
		expect(app.activeMindMap).toBeNull();
		expect(app.view).toBe('graph');
		expect(setState).not.toHaveBeenCalledWith('lastMindMap', null);
		expect(app.back()).toBe(true);
		expect(app.view).toBe('editor');
		app.openGraph();
		await vi.waitFor(() => expect(app.activeMindMap).toBe('Planning'));
		expect(app.activeMindMap).toBe('Planning');
		expect(app.view).toBe('graph');
	});

	it('falls back to chooser when the remembered map was removed', async () => {
		const app = getAppState();
		app.setView('editor');
		readMap.mockResolvedValue(null);
		app.openGraph();
		await vi.waitFor(() => expect(setState).toHaveBeenCalledWith('lastMindMap', null));
		expect(app.view).toBe('graph');
		expect(app.activeMindMap).toBeNull();
		expect(setState).toHaveBeenCalledWith('lastMindMap', null);
	});

	it('does not reopen after the user closes maps while validation is pending', async () => {
		const app = getAppState();
		let finish!: (value: string) => void;
		readMap.mockImplementation(() => new Promise<string>((resolve) => (finish = resolve)));
		app.setView('editor');
		app.openGraph();
		await vi.waitFor(() => expect(readMap).toHaveBeenCalledWith('Planning'));
		app.setView('editor');
		finish('{}');
		await settle();
		expect(app.view).toBe('editor');
		expect(app.activeMindMap).toBe('Planning');
	});

	it('retains the last map and reports an I/O error rather than treating it as removal', async () => {
		const app = getAppState();
		app.setView('editor');
		readMap.mockRejectedValue(new Error('Storage unavailable'));
		app.openGraph();
		await vi.waitFor(() => expect(app.notice?.text).toContain('Storage unavailable'));
		expect(app.view).toBe('editor');
		expect(setState).not.toHaveBeenCalledWith('lastMindMap', null);
		readMap.mockResolvedValue('{}');
		app.openGraph();
		await vi.waitFor(() => expect(app.view).toBe('graph'));
		expect(app.activeMindMap).toBe('Planning');
	});

	it('updates the remembered path after rename and clears it after deletion', async () => {
		const app = getAppState();
		app.openMindMap(null);
		app.renamedMindMap('Planning', 'Roadmap');
		expect(setState).toHaveBeenCalledWith('lastMindMap', 'Roadmap');
		readMap.mockResolvedValue('{}');
		app.setView('editor');
		app.openGraph();
		await vi.waitFor(() => expect(app.activeMindMap).toBe('Roadmap'));
		expect(readMap).toHaveBeenCalledWith('Roadmap');
		app.forgotMindMap('Planning');
		expect(setState).not.toHaveBeenCalledWith('lastMindMap', null);
		app.forgotMindMap('Roadmap');
		expect(setState).toHaveBeenCalledWith('lastMindMap', null);
		app.setView('editor');
		app.openGraph();
		expect(app.activeMindMap).toBeNull();
	});

	it('keeps the automatic graph when maps are disabled', () => {
		const app = getAppState();
		app.settings = { ...app.settings, mindMaps: false };
		app.setView('editor');
		app.openGraph();
		expect(app.activeMindMap).toBe('all');
		expect(app.back()).toBe(true);
		expect(app.view).toBe('editor');
		expect(readMap).not.toHaveBeenCalled();
	});
});
