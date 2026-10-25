/** The bits of a BrowserWindow the guard uses (a fake in tests). */
export interface Closable {
	on(event: 'close', listener: (e: { preventDefault(): void }) => void): unknown;
	close(): void;
	isDestroyed(): boolean;
}

/**
 * Hold the window's first close until `flush` (the renderer writing its queued
 * edits) settles, or `timeoutMs` passes, then close it for real and call
 * `closed` (which re-issues an interrupted quit). Closes asked for meanwhile wait too.
 */
export function flushBeforeClose(
	win: Closable,
	flush: () => Promise<void>,
	closed: () => void = () => {},
	timeoutMs = 2000
): void {
	let state: 'open' | 'flushing' | 'done' = 'open';
	win.on('close', (e) => {
		if (state === 'done') return;
		e.preventDefault();
		if (state === 'flushing') return;
		state = 'flushing';
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)));
		void Promise.race([flush().catch(() => {}), timeout]).then(() => {
			clearTimeout(timer);
			state = 'done';
			if (!win.isDestroyed()) win.close();
			closed();
		});
	});
}
