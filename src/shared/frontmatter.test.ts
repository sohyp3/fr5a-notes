import { describe, expect, it } from 'vitest';
import { editMarkdownBody, markdownBody, splitFrontmatter } from './frontmatter';

describe('lightweight frontmatter boundaries', () => {
	it.each([
		'---\n# Meeting notes\n\nKeep this #tag\n---\nMore notes',
		'---\nNormal prose\n---\n# Heading',
		'---\n\n---\nBody',
		'---\n- first item\n- second item\n---\nBody',
		'---\nhttps://example.com\n---\nBody'
	])('keeps ordinary rule-delimited Markdown intact: %s', (source) => {
		expect(splitFrontmatter(source)).toBeNull();
		expect(markdownBody(source)).toBe(source);
		expect(editMarkdownBody(source, (body) => `${body}\n#new`)).toBe(`${source}\n#new`);
	});

	it('reads metadata after comments and blank lines', () => {
		const yaml = '# metadata\n\ntitle: Note\ntags: [work]\n';
		expect(splitFrontmatter(`---\n${yaml}---\n# Body`)).toMatchObject({
			yaml,
			body: '# Body'
		});
	});

	it.each(['|', '>', '|-', '>+'])('ignores indented rules in a %s block scalar', (scalar) => {
		const yaml = `description: ${scalar}\n  before\n  ---\n  after\ntitle: Note\n`;
		expect(splitFrontmatter(`---\n${yaml}---\n# Body`)).toMatchObject({
			yaml,
			body: '# Body'
		});
	});

	it('preserves BOM and CRLF while editing the body', () => {
		const prefix = '\ufeff---\r\n"mindmap":\r\n  version: 1\r\n---\r\n';
		expect(splitFrontmatter(`${prefix}# Body`)?.lineEnding).toBe('\r\n');
		expect(editMarkdownBody(`${prefix}# Body`, () => '# New')).toBe(`${prefix}# New`);
	});

	it('retains malformed declared map boundaries for parser diagnostics', () => {
		expect(splitFrontmatter('---\nmindmap: [\n---\n# Body')).toMatchObject({
			yaml: 'mindmap: [\n',
			body: '# Body'
		});
	});

	it('leaves an unclosed metadata block unchanged', () => {
		const source = '---\ntitle: Note\n# Body';
		expect(markdownBody(source)).toBe(source);
	});

	it('accepts quoted metadata keys and a closing marker at EOF', () => {
		expect(splitFrontmatter("---\n'custom key': value\n---")?.body).toBe('');
	});

	it.each(['{ title: Note }', '{"title":"Note"}', '"title":"Note"'])(
		'accepts flow and quoted JSON-style metadata: %s',
		(yaml) => {
			expect(splitFrontmatter(`---\n${yaml}\n---\nBody`)?.body).toBe('Body');
		}
	);
});
