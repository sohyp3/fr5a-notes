import { describe, expect, it } from 'vitest';
import { mindMapVersion } from './mindMapMetadata';

describe('parser-free mind map metadata', () => {
	it.each([
		['ordinary note', '# Hello\nmindmap:\n  version: 1', null],
		['ordinary frontmatter', '---\ntitle: Hello\n---\nmindmap:\n  version: 1', null],
		['nested declaration', '---\nother:\n  mindmap:\n    version: 1\n---\n', null],
		['commented declaration', '---\n# mindmap:\n#   version: 1\n---\n', null],
		['block scalar', '---\ntext: |\n  mindmap:\n    version: 1\n---\n', null],
		['valid declaration', '---\nmindmap:\n  version: 1\n---\n', 1],
		['future version', '---\nmindmap:\n  version: 7\n---\n', 7],
		['zero version', '---\nmindmap:\n  version: 0\n---\n', 0],
		['BOM and CRLF', '\ufeff---\r\n"mindmap":\r\n  "version": 1 # hi\r\n---\r\n', 1],
		['flow declaration', "---\n'mindmap': { 'version': 2, root: r }\n---\n", 2],
		['invalid YAML', '---\nmindmap:\n  version: 1\n  nodes: [\n---\n', 1],
		['unclosed frontmatter', '---\nmindmap:\n  version: 1\n  nodes: [', 1],
		['invalid version', '---\nmindmap:\n  version: nope\n---\n', -1],
		['string version', '---\nmindmap:\n  version: "1"\n---\n', -1],
		['missing version', '---\nmindmap:\n  nodes: []\n---\n', -1],
		['invalid map value', '---\nmindmap: [\n---\n', -1],
		['nested node version', '---\nmindmap:\n  nodes:\n    - version: 9\n---\n', -1],
		['other object version', '---\nmindmap:\n  root: r\nother:\n  version: 9\n---\n', -1]
	])('%s', (_label, source, expected) => {
		expect(mindMapVersion(source as string)).toBe(expected);
	});

	it('can be serialized into the browser fixture without external dependencies', () => {
		const injected = new Function(
			`return (${mindMapVersion.toString()});`
		)() as typeof mindMapVersion;
		expect(injected('---\nmindmap:\n  version: bad\n---\n')).toBe(-1);
	});
});
