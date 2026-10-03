import { describe, expect, it } from 'vitest';
import {
	cleanFolder,
	cleanName,
	folderMoveError,
	noteMoveError,
	noteStem,
	remapPath,
	withNoteExt
} from './paths';

describe('paths', () => {
	it('cleans typed names', () => {
		expect(cleanName('  a/b:c  ')).toBe('a-b-c');
		expect(cleanName('..secret')).toBe('secret');
		expect(cleanName('   ')).toBe('');
		expect(cleanFolder('/work//2026/ q3 /')).toBe('work/2026/q3');
	});

	it('keeps or adds the note extension', () => {
		expect(withNoteExt('plan', 'Work/old.markdown')).toBe('plan.markdown');
		expect(withNoteExt('plan.txt', 'Work/old.md')).toBe('plan.txt');
		expect(withNoteExt('v1.2', 'a.md')).toBe('v1.2.md');
		expect(noteStem('Work/plan.v2.md')).toBe('plan.v2');
	});

	it('remaps ids under a moved folder only', () => {
		expect(remapPath('work/a.md', 'work', 'old/work')).toBe('old/work/a.md');
		expect(remapPath('work', 'work', 'archive')).toBe('archive');
		expect(remapPath('workshop/a.md', 'work', 'x')).toBeNull();
		expect(remapPath('a.md', '', 'x')).toBeNull();
	});

	it('refuses impossible moves', () => {
		expect(folderMoveError('work', 'work/sub/work')).toMatch('into itself');
		expect(folderMoveError('', 'x')).toMatch('root');
		expect(folderMoveError('work', '.fr5a/work')).toMatch('Hidden');
		expect(folderMoveError('work', 'archive/work')).toBeNull();
		expect(noteMoveError('a.md', 'b')).toMatch('extension');
		expect(noteMoveError('a.md', '.git/a.md')).toMatch('hidden');
		expect(noteMoveError('a.md', 'x/b.md')).toBeNull();
	});
});
