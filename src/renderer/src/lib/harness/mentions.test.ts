import { describe, expect, it } from 'vitest';
import {
	expandMentions,
	fromKey,
	mentionKey,
	mentionText,
	parseMentions,
	remapKey
} from './mentions';
import type { NoteMeta } from '../../../../shared/types';

const note = (id: string, title: string, tags: string[] = []): NoteMeta => ({
	id,
	absPath: id,
	title,
	snippet: '',
	mtime: 0,
	tags,
	pinned: false,
	locked: false,
	aiLocal: false,
	encrypted: false
});

const notes = [
	note('a.md', 'Alpha', ['research']),
	note('Work/plan.md', 'Plan'),
	note('Work/deep/x.md', 'X', ['research/ai']),
	note('Workshop/y.md', 'Y')
];

describe('mentions', () => {
	it('parses notes, folders and tags', () => {
		expect(parseMentions('see @a.md, @Work/ and @#research! also @"My Folder/"')).toEqual([
			{ kind: 'note', value: 'a.md' },
			{ kind: 'dir', value: 'Work' },
			{ kind: 'tag', value: 'research' },
			{ kind: 'dir', value: 'My Folder' }
		]);
	});

	it('round-trips keys and input text', () => {
		for (const m of parseMentions('@a.md @Work/ @#t @"x y.md"')) {
			expect(fromKey(mentionKey(m))).toEqual(m);
			expect(parseMentions(mentionText(m))).toEqual([m]);
		}
	});

	it('expands folders recursively, tags with children, and caps', () => {
		const e = expandMentions(['@Work/', '#research', 'Plan', 'nope.md'], notes, ['a.md']);
		expect(e.ids).toEqual(['a.md', 'Work/plan.md', 'Work/deep/x.md']);
		expect(e.groups).toEqual([
			{ key: '@Work/', ids: ['Work/plan.md', 'Work/deep/x.md'] },
			{ key: '#research', ids: ['a.md', 'Work/deep/x.md'] }
		]);
		expect(e.missing).toEqual(['nope.md']);
		expect(expandMentions(['@Work/'], notes, [], 1)).toMatchObject({
			ids: ['Work/plan.md'],
			omitted: 1
		});
	});

	it('@tabs stands for the notes open in tabs when sent', () => {
		expect(parseMentions('compare @tabs, and @"tabs"')).toEqual([
			{ kind: 'tabs', value: '' },
			{ kind: 'note', value: 'tabs' }
		]);
		for (const m of parseMentions('@tabs @"tabs"')) {
			expect(fromKey(mentionKey(m))).toEqual(m);
			expect(parseMentions(mentionText(m))).toEqual([m]);
		}
		const e = expandMentions(['@tabs'], notes, ['a.md'], 25, ['a.md', 'gone.md', 'Workshop/y.md']);
		expect(e.ids).toEqual(['a.md', 'Workshop/y.md']);
		expect(e.groups).toEqual([{ key: '@tabs', ids: ['a.md', 'Workshop/y.md'] }]);
		expect(expandMentions(['@tabs'], notes).missing).toEqual(['@tabs']);
		expect(remapKey('@tabs', 'tabs', 'x')).toBe('@tabs');
	});

	it('follows moved notes and folders', () => {
		expect(remapKey('Work/plan.md', 'Work', 'Archive/Work')).toBe('Archive/Work/plan.md');
		expect(remapKey('@Work/', 'Work', 'Old')).toBe('@Old/');
		expect(remapKey('@Workshop/', 'Work', 'Old')).toBe('@Workshop/');
		expect(remapKey('#Work', 'Work', 'Old')).toBe('#Work');
	});
});
