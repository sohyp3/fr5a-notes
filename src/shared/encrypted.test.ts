import { describe, expect, it } from 'vitest';
import { isEncryptedNote, splitEncrypted, splitHeader } from './encrypted';

const ARMOR = '-----BEGIN PGP MESSAGE-----\n\nwV4D\n-----END PGP MESSAGE-----\n';

describe('splitHeader', () => {
	it('keeps only the leading metadata lines in the head', () => {
		const text = '<!-- dir: rtl -->\n<!-- pinned: true -->\n# Title\n<!-- locked: true -->\nbody';
		expect(splitHeader(text)).toEqual({
			head: '<!-- dir: rtl -->\n<!-- pinned: true -->\n',
			body: '# Title\n<!-- locked: true -->\nbody'
		});
	});

	it('has an empty head for a note without metadata', () => {
		expect(splitHeader('# Title\n')).toEqual({ head: '', body: '# Title\n' });
	});

	it('leaves a file that is only a metadata line without newline as body', () => {
		expect(splitHeader('<!-- pinned: true -->')).toEqual({
			head: '',
			body: '<!-- pinned: true -->'
		});
	});

	it('tolerates CRLF line endings', () => {
		expect(splitHeader('<!-- ai: local -->\r\nx')).toEqual({
			head: '<!-- ai: local -->\r\n',
			body: 'x'
		});
	});
});

describe('splitEncrypted', () => {
	it('finds the armor right after the metadata', () => {
		expect(splitEncrypted(`<!-- pinned: true -->\n${ARMOR}`)).toEqual({
			head: '<!-- pinned: true -->\n',
			armor: ARMOR
		});
		expect(isEncryptedNote(ARMOR)).toBe(true);
	});

	it('ignores a PGP block quoted further down a plain note', () => {
		expect(isEncryptedNote(`# Key exchange\n\n${ARMOR}`)).toBe(false);
		expect(isEncryptedNote('')).toBe(false);
	});

	it('round-trips with splitHeader', () => {
		const head = '<!-- dir: rtl -->\n';
		const enc = splitEncrypted(head + ARMOR)!;
		expect(enc.head).toBe(splitHeader(`${head}# body`).head);
	});
});
