import { describe, expect, it } from 'vitest';
import { mapRefreshDecision } from './refresh';

describe('open map after sync', () => {
	it('reloads remote edits and follows remote deletion when clean', () => {
		expect(mapRefreshDecision('old', 'remote', false)).toBe('reload');
		expect(mapRefreshDecision('old', null, false)).toBe('removed');
	});
	it('preserves pending local edits until the user resolves the conflict', () => {
		expect(mapRefreshDecision('old', 'remote', true)).toBe('conflict');
		expect(mapRefreshDecision('old', null, true)).toBe('conflict');
		expect(mapRefreshDecision('old', 'old', true)).toBe('unchanged');
	});
});
