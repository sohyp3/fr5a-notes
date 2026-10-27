/** Decide what a sync may safely do to an open canvas. Never replace pending edits. */
export function mapRefreshDecision(
	previous: string | null,
	onDisk: string | null,
	localChanges: boolean
): 'unchanged' | 'reload' | 'removed' | 'conflict' {
	if (previous === onDisk) return 'unchanged';
	if (localChanges) return 'conflict';
	return onDisk === null ? 'removed' : 'reload';
}
