import { describe, expect, it } from 'vitest';
import {
	APP_ASSETS_DIR,
	APP_CHATS_DIR,
	APP_MAPS_DIR,
	cleanChatsFolder,
	cleanFolder,
	isAppAssetPath,
	isAppNotePath,
	isAssetPathAllowed,
	isScannedPath,
	relativeLink,
	cleanName,
	folderMoveError,
	noteFileStem,
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

	it('uses underscores instead of spaces in new note filenames', () => {
		expect(noteFileStem('  Project meeting notes  ')).toBe('Project_meeting_notes');
		expect(noteFileStem('Project\tmeeting')).toBe('Project_meeting');
		expect(noteFileStem('   ')).toBe('Untitled');
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

describe('app files under .fr5a/', () => {
	it('keeps synced app data in hidden folders', () => {
		expect([APP_ASSETS_DIR, APP_CHATS_DIR, APP_MAPS_DIR]).toEqual([
			'.fr5a/assets', '.fr5a/chats', '.fr5a/maps'
		]);
	});
	it('lets images into .fr5a/assets only', () => {
		expect(isAppAssetPath('.fr5a/assets/a.png')).toBe(true);
		expect(isAppAssetPath('.fr5a/assets/sub/a.png')).toBe(true);
		expect(isAppAssetPath('.fr5a/assets/a.md')).toBe(false);
		expect(isAppAssetPath('.fr5a/assets/.git/a.png')).toBe(false);
		expect(isAppAssetPath('.fr5a/sessions/a.png')).toBe(false);
		expect(isAppAssetPath('.fr5a/assets')).toBe(false);
		expect(isAssetPathAllowed('assets/a.png')).toBe(true);
		expect(isAssetPathAllowed('.fr5a/assets/a.png')).toBe(true);
		expect(isAssetPathAllowed('.git/a.png')).toBe(false);
		expect(isAssetPathAllowed('.fr5a/skills/a.png')).toBe(false);
	});

	it('scans .fr5a/chats and nothing else hidden', () => {
		expect(isScannedPath('Work/plan.md')).toBe(true);
		expect(isScannedPath('.fr5a')).toBe(true);
		expect(isScannedPath('.fr5a/chats')).toBe(true);
		expect(isScannedPath('.fr5a/chats/a.md')).toBe(true);
		expect(isScannedPath('.fr5a/chats/old/a.md')).toBe(true);
		expect(isScannedPath('.fr5a/chats/.git')).toBe(false);
		expect(isScannedPath('.fr5a/sessions/device/a.md')).toBe(false);
		expect(isScannedPath('.fr5a/a.md')).toBe(false);
		expect(isScannedPath('.git')).toBe(false);
		expect(isScannedPath('.fr5a_trash/a.md')).toBe(false);
		expect(isAppNotePath('.fr5a/chats/a.md')).toBe(true);
		expect(isAppNotePath('.fr5a/chatsx/a.md')).toBe(false);
	});

	it('lets saved chats move in and out of .fr5a/chats', () => {
		expect(noteMoveError('.fr5a/chats/a.md', 'Work/a.md')).toBeNull();
		expect(noteMoveError('Work/a.md', '.fr5a/chats/a.md')).toBeNull();
		expect(noteMoveError('Work/a.md', '.fr5a/sessions/a.md')).not.toBeNull();
	});

	it('keeps the chats folder setting inside .fr5a', () => {
		expect(cleanChatsFolder('.fr5a/chats')).toBe('.fr5a/chats');
		expect(cleanChatsFolder(' .fr5a / chats/ ')).toBe('.fr5a/chats');
		expect(cleanChatsFolder('.fr5a/other')).toBe('fr5a/other');
		expect(cleanChatsFolder('AI chats')).toBe('AI chats');
	});

	it('links relative to a folder', () => {
		expect(relativeLink('Work', '.fr5a/assets/a b.png')).toBe('../.fr5a/assets/a%20b.png');
		expect(relativeLink('', '.fr5a/assets/a.png')).toBe('.fr5a/assets/a.png');
		expect(relativeLink('.fr5a/chats', 'Work/plan.md')).toBe('../../Work/plan.md');
	});
});
