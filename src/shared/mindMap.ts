import YAML from 'yaml';
import { YAMLMap, YAMLSeq, Scalar, type Node } from 'yaml/types';
import { splitFrontmatter, type FrontmatterParts } from './frontmatter';
import { mindMapVersion } from './mindMapMetadata';
export { splitFrontmatter, markdownBody } from './frontmatter';

const { createNode, parseDocument } = YAML;
import type {
	MindMapConfig,
	MindMapDiagnostic,
	MindMapEdgeSpec,
	MindMapExpandSpec,
	MindMapNodeSpec
} from './types';

export interface ParsedMindMap {
	config: MindMapConfig | null;
	diagnostics: MindMapDiagnostic[];
	version: number | null;
	frontmatter: FrontmatterParts | null;
	readOnly: boolean;
}

// Keep recursive layout/outline consumers within a predictable amount of work.
export const MAX_MIND_MAP_NODES = 1000;
export const MAX_MIND_MAP_DEPTH = 64;
const MAX_YAML_LENGTH = 1_000_000;
const MAX_YAML_DEPTH = 64;

const object = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): string[] | undefined =>
	Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;

function diagnosticsForYaml(errors: readonly unknown[]): MindMapDiagnostic[] {
	return errors.map((value) => {
		const error = value as {
			message?: string;
			linePos?: { start?: { line?: number; col?: number } };
		};
		return {
			severity: 'error',
			code: 'yaml',
			message: error.message ?? 'Malformed YAML frontmatter',
			line: error.linePos?.start?.line ? error.linePos.start.line + 1 : undefined,
			column: error.linePos?.start?.col
		};
	});
}

function validate(
	raw: Record<string, unknown>,
	diagnostics: MindMapDiagnostic[]
): MindMapConfig | null {
	const version = raw.version;
	if (version !== 1) return null;
	const root = typeof raw.root === 'string' ? raw.root : '';
	const rows = Array.isArray(raw.nodes) ? raw.nodes : [];
	if (!Array.isArray(raw.nodes))
		diagnostics.push({
			severity: 'error',
			code: 'nodes',
			message: 'mindmap.nodes must be a list.'
		});
	if (raw.edges !== undefined && !Array.isArray(raw.edges))
		diagnostics.push({
			severity: 'error',
			code: 'edges',
			message: 'mindmap.edges must be a list.'
		});
	if (raw.hidden !== undefined && !strings(raw.hidden))
		diagnostics.push({
			severity: 'error',
			code: 'hidden',
			message: 'mindmap.hidden must be a list of ids.'
		});
	if (rows.length > MAX_MIND_MAP_NODES) {
		diagnostics.push({
			severity: 'error',
			code: 'node-limit',
			message: `Mind maps support at most ${MAX_MIND_MAP_NODES} explicit nodes. Split this map into smaller maps.`
		});
		return null;
	}
	const nodes: MindMapNodeSpec[] = [];
	const ids = new Set<string>();
	for (let index = 0; index < rows.length; index++) {
		const row = rows[index];
		if (!object(row) || typeof row.id !== 'string' || !row.id.trim()) {
			diagnostics.push({
				severity: 'error',
				code: 'node-id',
				message: `Node ${index + 1} needs an id.`
			});
			continue;
		}
		const id = row.id.trim();
		if (ids.has(id)) {
			diagnostics.push({
				severity: 'error',
				code: 'duplicate-id',
				message: `Duplicate node id “${id}”.`
			});
			continue;
		}
		ids.add(id);
		const node: MindMapNodeSpec = { id };
		if (row.label !== undefined && typeof row.label !== 'string')
			diagnostics.push({
				severity: 'error',
				code: 'label',
				message: `Node “${id}” has an invalid label.`
			});
		if (
			row.note !== undefined &&
			(typeof row.note !== 'string' ||
				!row.note.trim() ||
				/^[a-z][a-z0-9+.-]*:/i.test(row.note) ||
				!/\.(?:md|markdown|mdown|txt)$/i.test(row.note))
		)
			diagnostics.push({
				severity: 'error',
				code: 'note',
				message: `Node “${id}” needs a workspace Markdown note path.`
			});
		if (typeof row.label === 'string') node.label = row.label;
		if (typeof row.note === 'string') node.note = row.note;
		const children = strings(row.children);
		if (row.children !== undefined && !children)
			diagnostics.push({
				severity: 'error',
				code: 'children',
				message: `Node “${id}” has invalid children.`
			});
		else if (children) node.children = children;
		if (row.position !== undefined) {
			if (
				object(row.position) &&
				typeof row.position.x === 'number' &&
				Number.isFinite(row.position.x) &&
				typeof row.position.y === 'number' &&
				Number.isFinite(row.position.y)
			)
				node.position = { x: row.position.x, y: row.position.y };
			else
				diagnostics.push({
					severity: 'error',
					code: 'position',
					message: `Node “${id}” has invalid coordinates.`
				});
		}
		if (row.expand !== undefined) {
			if (!object(row.expand)) {
				diagnostics.push({
					severity: 'error',
					code: 'expand',
					message: `Node “${id}” has invalid expansion settings.`
				});
			} else {
				const expand: MindMapExpandSpec = {};
				const links = row.expand.links;
				if (
					links !== undefined &&
					!['none', 'outgoing', 'incoming', 'both'].includes(String(links))
				)
					diagnostics.push({
						severity: 'error',
						code: 'expand-links',
						message: `Node “${id}” has an invalid link direction.`
					});
				else if (links) expand.links = links as MindMapExpandSpec['links'];
				const tags = strings(row.expand.tags);
				if (row.expand.tags !== undefined && !tags)
					diagnostics.push({
						severity: 'error',
						code: 'expand-tags',
						message: `Node “${id}” has invalid tags.`
					});
				else if (tags) expand.tags = tags;
				for (const key of ['depth', 'limit'] as const) {
					const value = row.expand[key];
					const cap = key === 'depth' ? 2 : 100;
					if (
						value !== undefined &&
						(!Number.isInteger(value) || Number(value) < 0 || Number(value) > cap)
					)
						diagnostics.push({
							severity: 'error',
							code: `expand-${key}`,
							message: `Node “${id}” has an invalid ${key} (maximum ${cap}).`
						});
					else if (value !== undefined) expand[key] = Number(value);
				}
				node.expand = expand;
			}
		}
		nodes.push(node);
	}
	if (!root || !ids.has(root))
		diagnostics.push({
			severity: 'error',
			code: 'root',
			message: 'The map root must reference one explicit node.'
		});
	const parent = new Map<string, string>();
	for (const node of nodes) {
		if (!node.note && !node.label?.trim())
			diagnostics.push({
				severity: 'error',
				code: 'label',
				message: `Concept node “${node.id}” needs a label.`
			});
		for (const child of node.children ?? []) {
			if (!ids.has(child))
				diagnostics.push({
					severity: 'error',
					code: 'missing-child',
					message: `Node “${node.id}” refers to missing child “${child}”.`
				});
			else if (parent.has(child))
				diagnostics.push({
					severity: 'error',
					code: 'multiple-parents',
					message: `Node “${child}” has more than one parent.`
				});
			else parent.set(child, node.id);
		}
	}
	const visiting = new Set<string>();
	if (parent.has(root))
		diagnostics.push({
			severity: 'error',
			code: 'root-parent',
			message: 'The map root cannot have a parent.'
		});
	const visited = new Set<string>();
	const byId = new Map(nodes.map((node) => [node.id, node]));
	// Visit roots first so depth does not depend on the order of rows in YAML.
	const ordered = [...nodes.filter((node) => !parent.has(node.id)), ...nodes];
	for (const node of ordered) {
		if (visited.has(node.id)) continue;
		const stack = [{ id: node.id, depth: 0, exiting: false }];
		while (stack.length) {
			const frame = stack.pop()!;
			if (frame.exiting) {
				visiting.delete(frame.id);
				visited.add(frame.id);
				continue;
			}
			if (visiting.has(frame.id)) {
				diagnostics.push({
					severity: 'error',
					code: 'cycle',
					message: `The hierarchy contains a cycle at “${frame.id}”.`
				});
				continue;
			}
			if (frame.depth > MAX_MIND_MAP_DEPTH) {
				diagnostics.push({
					severity: 'error',
					code: 'depth-limit',
					message: `Node “${frame.id}” exceeds the maximum branch depth of ${MAX_MIND_MAP_DEPTH}. Move this branch closer to the root or split the map.`
				});
				return null;
			}
			if (visited.has(frame.id)) continue;
			visiting.add(frame.id);
			stack.push({ ...frame, exiting: true });
			for (const child of byId.get(frame.id)?.children ?? [])
				if (byId.has(child)) stack.push({ id: child, depth: frame.depth + 1, exiting: false });
		}
	}
	const edges: MindMapEdgeSpec[] = [];
	for (const row of Array.isArray(raw.edges) ? raw.edges : []) {
		if (!object(row) || typeof row.from !== 'string' || typeof row.to !== 'string') {
			diagnostics.push({
				severity: 'error',
				code: 'edge',
				message: 'Every cross-link needs from and to ids.'
			});
			continue;
		}
		if (!ids.has(row.from) || !ids.has(row.to))
			diagnostics.push({
				severity: 'error',
				code: 'dangling-edge',
				message: `Cross-link “${row.from} → ${row.to}” has a missing endpoint.`
			});
		edges.push({
			from: row.from,
			to: row.to,
			...(typeof row.label === 'string' ? { label: row.label } : {})
		});
	}
	return { version: 1, root, nodes, edges, hidden: strings(raw.hidden) ?? [] };
}

export function parseMindMap(source: string): ParsedMindMap {
	const frontmatter = splitFrontmatter(source);
	if (!frontmatter) {
		const version = mindMapVersion(source);
		return {
			config: null,
			diagnostics:
				version === null
					? []
					: [
							{
								severity: 'error',
								code: 'frontmatter-unclosed',
								message: 'Close the mind map frontmatter with a --- line before the Markdown body.',
								line: 1,
								column: 1
							}
						],
			version,
			frontmatter: null,
			readOnly: version !== null
		};
	}
	const failure = (code: string, message: string): ParsedMindMap => ({
		config: null,
		diagnostics: [{ severity: 'error', code, message, line: 2, column: 1 }],
		version: mindMapVersion(source),
		frontmatter,
		readOnly: true
	});
	if (frontmatter.yaml.length > MAX_YAML_LENGTH)
		return failure(
			'yaml-limit',
			'The frontmatter is too large to edit visually. Split the map or reduce its metadata to under 1 MB.'
		);
	let document: ReturnType<typeof parseDocument>;
	try {
		document = parseDocument(frontmatter.yaml, { keepCstNodes: true, keepNodeTypes: true });
	} catch {
		return failure(
			'yaml',
			'Cannot parse this YAML. Reduce deeply nested metadata and repair the source.'
		);
	}
	// Bound conversion to JSON as well as the authored hierarchy. Extension
	// metadata may be deeply nested even when the node list itself is shallow.
	const pending: { value: unknown; depth: number }[] = [{ value: document.contents, depth: 0 }];
	const seen = new Set<unknown>();
	while (pending.length) {
		const { value, depth } = pending.pop()!;
		if (!value || typeof value !== 'object' || seen.has(value)) continue;
		if (depth > MAX_YAML_DEPTH)
			return failure(
				'yaml-depth',
				`YAML metadata exceeds ${MAX_YAML_DEPTH} nesting levels. Flatten the metadata before visual editing.`
			);
		seen.add(value);
		if (value instanceof YAMLMap)
			for (const pair of value.items) {
				pending.push({ value: pair.key, depth: depth + 1 });
				pending.push({ value: pair.value, depth: depth + 1 });
			}
		else if (value instanceof YAMLSeq)
			for (const item of value.items) pending.push({ value: item, depth: depth + 1 });
	}
	const diagnostics = diagnosticsForYaml(document.errors);
	const locate = (offset: number) => {
		const before = frontmatter.yaml.slice(0, offset);
		return { line: before.split('\n').length + 1, column: offset - before.lastIndexOf('\n') };
	};
	for (let i = 0; i < diagnostics.length; i++) {
		const error = document.errors[i] as unknown as { source?: { range?: { start: number } } };
		Object.assign(diagnostics[i], locate(error.source?.range?.start ?? 0));
	}
	if (diagnostics.length)
		return { config: null, diagnostics, version: null, frontmatter, readOnly: true };
	let top: unknown;
	try {
		top = document.toJSON();
	} catch (cause) {
		diagnostics.push({
			severity: 'error',
			code: 'yaml',
			message: cause instanceof Error ? cause.message : 'Invalid YAML aliases.',
			...locate(0)
		});
		return { config: null, diagnostics, version: null, frontmatter, readOnly: true };
	}
	if (!object(top) || !object(top.mindmap))
		return { config: null, diagnostics: [], version: null, frontmatter, readOnly: false };
	const version = top.mindmap.version;
	if (typeof version !== 'number' || !Number.isInteger(version)) {
		diagnostics.push({ severity: 'error', code: 'version', message: 'mindmap.version must be 1.' });
		return { config: null, diagnostics, version: null, frontmatter, readOnly: true };
	}
	if (version !== 1) {
		diagnostics.push({
			severity: 'warning',
			code: 'unsupported-version',
			message: `Mind map version ${version} is not supported. Upgrade it before visual editing.`
		});
		return { config: null, diagnostics, version, frontmatter, readOnly: true };
	}
	const config = validate(top.mindmap, diagnostics);
	for (const diagnostic of diagnostics) {
		const id =
			/(?:Node|node) “([^”]+)”/.exec(diagnostic.message)?.[1] ??
			/Duplicate node id “([^”]+)”/.exec(diagnostic.message)?.[1];
		const rows = document.getIn(['mindmap', 'nodes'], true);
		const matches =
			rows instanceof YAMLSeq
				? rows.items.filter((item) => item instanceof YAMLMap && item.get('id') === id)
				: [];
		const node = diagnostic.code === 'duplicate-id' ? matches[1] : matches[0];
		const offset =
			node?.range?.[0] ?? (document.getIn(['mindmap'], true) as Node | undefined)?.range?.[0] ?? 0;
		Object.assign(diagnostic, locate(offset));
	}
	return {
		config,
		diagnostics,
		version,
		frontmatter,
		readOnly: diagnostics.some((d) => d.severity === 'error')
	};
}

/** Replace only the mindmap subtree; unrelated YAML/comments and the body survive. */
export function updateMindMap(source: string, config: MindMapConfig): string {
	const parts = splitFrontmatter(source);
	const ending = parts?.lineEnding ?? (source.includes('\r\n') ? '\r\n' : '\n');
	// Seed a block-style mapping for new documents so source editing stays as
	// readable as the documented contract (an empty `{}` would retain flow style).
	const document = parseDocument(parts?.yaml ?? 'mindmap: null\n', {
		keepCstNodes: true,
		keepNodeTypes: true
	});
	if (document.errors.length)
		throw new Error('Cannot visually edit malformed YAML. Open the source to repair it.');
	const current = parseMindMap(source);
	if (current.readOnly)
		throw new Error(
			'Cannot visually edit an invalid or unsupported map. Open the source to repair it.'
		);
	// Retain existing AST nodes (and their comments) by stable node id. Delete
	// only schema-owned fields; extension metadata survives visual transactions.
	const owned: Record<string, string[]> = {
		mindmap: ['version', 'root', 'nodes', 'edges', 'hidden'],
		nodes: ['id', 'label', 'note', 'children', 'position', 'expand'],
		edges: ['from', 'to', 'label'],
		expand: ['links', 'tags', 'depth', 'limit'],
		position: ['x', 'y']
	};
	function merge(existing: unknown, value: unknown, key: string): Node {
		if (existing instanceof YAMLMap && object(value)) {
			for (const field of owned[key] ?? []) if (value[field] === undefined) existing.delete(field);
			for (const [field, child] of Object.entries(value))
				if (child !== undefined)
					existing.set(field, merge(existing.get(field, true), child, field));
			return existing;
		}
		if (existing instanceof YAMLSeq && Array.isArray(value)) {
			const before = [...existing.items];
			existing.items = value.map((item, index) => {
				const match =
					object(item) && key === 'nodes'
						? before.find((row) => row instanceof YAMLMap && row.get('id') === item.id)
						: object(item) && key === 'edges'
							? before.find(
									(row) =>
										row instanceof YAMLMap &&
										row.get('from') === item.from &&
										row.get('to') === item.to
								)
							: before[index];
				return merge(match, item, key);
			});
			return existing;
		}
		if (existing instanceof Scalar && (value === null || typeof value !== 'object')) {
			existing.value = value;
			return existing;
		}
		return createNode(value) as Node;
	}
	document.setIn(['mindmap'], merge(document.getIn(['mindmap'], true), config, 'mindmap'));
	const yaml = document
		.toString()
		.replace(/\n/g, ending)
		.replace(new RegExp(`${ending}$`), '');
	const body = parts?.body ?? source;
	return `${source.startsWith('\ufeff') ? '\ufeff' : ''}---${ending}${yaml}${ending}---${ending}${body}`;
}

export { mindMapVersion } from './mindMapMetadata';
