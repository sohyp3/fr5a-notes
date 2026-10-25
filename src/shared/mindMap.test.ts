import { describe, expect, it } from 'vitest';
import {
	MAX_MIND_MAP_DEPTH,
	MAX_MIND_MAP_NODES,
	markdownBody,
	parseMindMap,
	updateMindMap
} from './mindMap';

const example = `---
title: Kept
# an important comment
mindmap:
  version: 1
  root: project
  nodes:
    - id: project
      label: Project Atlas
      children: [research, build]
      position: { x: 0, y: 0 }
      expand:
        links: both
        tags: [work/atlas]
        depth: 1
        limit: 24
    - id: research
      label: Research
    - id: build
      note: Projects/Atlas Build.md
  edges:
    - from: research
      to: build
      label: informs
---
# Project Atlas Map

Body stays exactly here.
`;

describe('mind map frontmatter', () => {
	it('keeps a declared map with an unclosed header read-only and actionable', () => {
		const parsed = parseMindMap('---\nmindmap:\n  version: 1\n  root: root\n');
		expect(parsed).toMatchObject({ config: null, version: 1, readOnly: true });
		expect(parsed.diagnostics[0].code).toBe('frontmatter-unclosed');
		expect(() =>
			updateMindMap('---\nmindmap:\n  version: 1\n', {
				version: 1,
				root: 'root',
				nodes: [{ id: 'root', label: 'Root' }]
			})
		).toThrow();
		expect(parseMindMap('---\nJust a horizontal rule\n').readOnly).toBe(false);
	});

	const treeSource = (count: number, chain = false, reverse = false) => {
		const rows = Array.from(
			{ length: count },
			(_, index) =>
				`    - { id: n${index}, label: Node ${index}${chain && index < count - 1 ? `, children: [n${index + 1}]` : ''} }`
		);
		if (reverse) rows.reverse();
		return `---\nmindmap:\n  version: 1\n  root: n0\n  nodes:\n${rows.join('\n')}\n---\n`;
	};

	it('caps explicit node count before validating a large map', () => {
		expect(parseMindMap(treeSource(MAX_MIND_MAP_NODES)).readOnly).toBe(false);
		const parsed = parseMindMap(treeSource(MAX_MIND_MAP_NODES + 1));
		expect(parsed).toMatchObject({ config: null, readOnly: true });
		expect(parsed.diagnostics[0].code).toBe('node-limit');
	});

	it.each([false, true])(
		'caps branch depth independently of YAML row ordering (reverse: %s)',
		(reverse) => {
			expect(parseMindMap(treeSource(MAX_MIND_MAP_DEPTH + 1, true, reverse)).readOnly).toBe(false);
			const parsed = parseMindMap(treeSource(MAX_MIND_MAP_DEPTH + 2, true, reverse));
			expect(parsed).toMatchObject({ config: null, readOnly: true });
			expect(parsed.diagnostics.some((item) => item.code === 'depth-limit')).toBe(true);
		}
	);

	it('rejects excessive metadata nesting and size without throwing', () => {
		const nested = `---\nmindmap: {version: 1, root: root, nodes: [{id: root, label: Root}]}\nextension: ${'['.repeat(100)}0${']'.repeat(100)}\n---\n`;
		expect(parseMindMap(nested)).toMatchObject({ config: null, readOnly: true });
		const large = `---\nmindmap: {version: 1}\nextra: ${'a'.repeat(1_000_001)}\n---\n`;
		expect(parseMindMap(large).diagnostics[0].code).toBe('yaml-limit');
	});

	it('parses the version-1 contract', () => {
		const parsed = parseMindMap(example);
		expect(parsed.diagnostics).toEqual([]);
		expect(parsed.config?.root).toBe('project');
		expect(parsed.config?.nodes[0].expand).toEqual({
			links: 'both',
			tags: ['work/atlas'],
			depth: 1,
			limit: 24
		});
		expect(parsed.config?.edges?.[0]).toEqual({ from: 'research', to: 'build', label: 'informs' });
	});

	it('preserves unrelated YAML comments and the Markdown body while updating the map', () => {
		const parsed = parseMindMap(example);
		const next = updateMindMap(example, {
			...parsed.config!,
			nodes: parsed.config!.nodes.map((node) =>
				node.id === 'research' ? { ...node, position: { x: -240, y: 90 } } : node
			)
		});
		expect(next).toContain('title: Kept');
		expect(next).toContain('# an important comment');
		expect(next.slice(next.indexOf('# Project Atlas Map'))).toBe(
			example.slice(example.indexOf('# Project Atlas Map'))
		);
		expect(parseMindMap(next).config?.nodes[1].position).toEqual({ x: -240, y: 90 });
	});

	it('keeps CRLF and excludes frontmatter from the Markdown body', () => {
		const source = example.replace(/\n/g, '\r\n');
		const next = updateMindMap(source, parseMindMap(source).config!);
		expect(next).not.toMatch(/(?<!\r)\n/);
		expect(markdownBody(source)).toBe('# Project Atlas Map\r\n\r\nBody stays exactly here.\r\n');
	});

	it('adds frontmatter to an ordinary Markdown note', () => {
		const next = updateMindMap('# New map\n', {
			version: 1,
			root: 'root',
			nodes: [{ id: 'root', label: 'Idea' }]
		});
		expect(parseMindMap(next).config?.root).toBe('root');
		expect(markdownBody(next)).toBe('# New map\n');
		expect(next).toContain('mindmap:\n  version: 1\n  root: root\n  nodes:\n    - id: root');
	});

	it.each([
		[
			'duplicate ids',
			'nodes:\n    - { id: a, label: A }\n    - { id: a, label: B }',
			'duplicate-id'
		],
		['missing root', 'root: missing\n  nodes:\n    - { id: a, label: A }', 'root'],
		['missing child', 'nodes:\n    - { id: a, label: A, children: [b] }', 'missing-child'],
		[
			'cycle',
			'nodes:\n    - { id: a, label: A, children: [b] }\n    - { id: b, label: B, children: [a] }',
			'cycle'
		],
		['bad position', 'nodes:\n    - { id: a, label: A, position: { x: no, y: 0 } }', 'position'],
		[
			'bad edge',
			'nodes:\n    - { id: a, label: A }\n  edges:\n    - { from: a, to: no }',
			'dangling-edge'
		]
	])('validates %s', (_label, fragment, code) => {
		const yaml = fragment.includes('root:') ? fragment : `root: a\n  ${fragment}`;
		const parsed = parseMindMap(`---\nmindmap:\n  version: 1\n  ${yaml}\n---\n# Body\n`);
		expect(parsed.diagnostics.some((item) => item.code === code)).toBe(true);
		expect(parsed.readOnly).toBe(true);
	});

	it('opens unsupported versions read-only', () => {
		const parsed = parseMindMap('---\nmindmap:\n  version: 2\n---\n# Future\n');
		expect(parsed.version).toBe(2);
		expect(parsed.readOnly).toBe(true);
		expect(parsed.diagnostics[0].code).toBe('unsupported-version');
	});

	it('keeps comments and extension keys inside authored map nodes', () => {
		const source = example
			.replace(
				'label: Research',
				'# branch rationale\n      label: Research # retained inline\n      custom: retained'
			)
			.replace('version: 1', 'version: 1\n  customMapKey: retained');
		const config = parseMindMap(source).config!;
		const next = updateMindMap(source, {
			...config,
			nodes: config.nodes.map((node) =>
				node.id === 'research' ? { ...node, label: 'Updated' } : node
			)
		});
		expect(next).toContain('# branch rationale');
		expect(next).toContain('# retained inline');
		expect(next).toContain('custom: retained');
		expect(next).toContain('customMapKey: retained');
		expect(parseMindMap(next).config?.nodes[1].label).toBe('Updated');
	});

	it('reports source locations for malformed YAML and semantic errors', () => {
		const malformed = parseMindMap('---\nmindmap:\n  nodes: [\n---\n# Body');
		expect(malformed.readOnly).toBe(true);
		expect(malformed.diagnostics[0]).toMatchObject({ line: 3, column: expect.any(Number) });
		const invalid = parseMindMap(
			example.replace('position: { x: 0, y: 0 }', 'position: { x: bad, y: 0 }')
		);
		expect(invalid.diagnostics.find((item) => item.code === 'position')).toMatchObject({
			line: expect.any(Number),
			column: expect.any(Number)
		});
		expect(() =>
			updateMindMap(malformed.frontmatter!.prefix + malformed.frontmatter!.yaml + '---\n# Body', {
				version: 1,
				root: 'root',
				nodes: [{ id: 'root', label: 'Root' }]
			})
		).toThrow();
	});

	it('rejects wrong collection types, string versions and out-of-range expansion', () => {
		for (const invalid of [
			'nodes: no',
			'nodes: []\n  edges: no',
			'nodes: []\n  hidden: no',
			'nodes: [{id: a, label: A, expand: {depth: 3, limit: 101}}]'
		]) {
			expect(
				parseMindMap(`---\nmindmap:\n  version: 1\n  root: a\n  ${invalid}\n---\n`).readOnly
			).toBe(true);
		}
		expect(parseMindMap(example.replace('version: 1', 'version: "1"')).readOnly).toBe(true);
	});

	it('preserves a BOM and refuses to overwrite unsupported versions', () => {
		const next = updateMindMap(`\ufeff${example}`, parseMindMap(example).config!);
		expect(next.startsWith('\ufeff---')).toBe(true);
		expect(() =>
			updateMindMap(example.replace('version: 1', 'version: 2'), parseMindMap(example).config!)
		).toThrow('unsupported');
	});
});
