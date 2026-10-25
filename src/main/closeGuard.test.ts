import { describe, expect, it, vi } from 'vitest';
import { flushBeforeClose, type Closable } from './closeGuard';

function fakeWindow() {
	let listener: ((e: { preventDefault(): void }) => void) | null = null;
	const win = {
		closed: 0,
		on(_event: 'close', l: (e: { preventDefault(): void }) => void) {
			listener = l;
		},
		/** A close request (the title-bar button, Alt+F4, a quit): true when it went through. */
		request(): boolean {
			let prevented = false;
			listener?.({ preventDefault: () => (prevented = true) });
			if (!prevented) win.closed++;
			return !prevented;
		},
		close() {
			win.request();
		},
		isDestroyed: () => false
	};
	return win satisfies Closable & object;
}

describe('flushBeforeClose', () => {
	it('closes only once the flush is done, flushing once', async () => {
		const win = fakeWindow();
		let finish!: () => void;
		const flush = vi.fn(() => new Promise<void>((r) => (finish = r)));
		const closed = vi.fn();
		flushBeforeClose(win, flush, closed);
		expect(win.request()).toBe(false);
		expect(win.request()).toBe(false); // pressed again while saving
		expect(flush).toHaveBeenCalledTimes(1);
		await Promise.resolve();
		expect(win.closed).toBe(0);
		finish();
		await vi.waitFor(() => expect(win.closed).toBe(1));
		expect(closed).toHaveBeenCalledTimes(1);
	});

	it('closes anyway when the renderer never answers, or the flush fails', async () => {
		vi.useFakeTimers();
		try {
			const hung = fakeWindow();
			flushBeforeClose(hung, () => new Promise<void>(() => {}), undefined, 1000);
			hung.request();
			await vi.advanceTimersByTimeAsync(999);
			expect(hung.closed).toBe(0);
			await vi.advanceTimersByTimeAsync(1);
			expect(hung.closed).toBe(1);

			const failing = fakeWindow();
			flushBeforeClose(failing, () => Promise.reject(new Error('disk full')));
			failing.request();
			await vi.advanceTimersByTimeAsync(0);
			expect(failing.closed).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
