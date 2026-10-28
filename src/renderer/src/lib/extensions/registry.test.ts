import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';
import {
	ExtensionRegistry,
	extensions,
	runExtensionHarness,
	type DocumentContext
} from './registry';
import type { LoopOptions } from '../harness/loop';
import { toolsForRun, type Tool, type ToolDeps } from '../harness/tools';

const component = (() => {}) as unknown as Component<{ document: DocumentContext }>;
const tool = (name: string): Tool => ({
	def: { name, description: name, parameters: { type: 'object', properties: {} } },
	run: async () => 'ok'
});

describe('trusted extension registry', () => {
	it('validates atomically, notifies and disposes once', () => {
		const registry = new ExtensionRegistry();
		const dispose = vi.fn();
		const changed = vi.fn();
		const stop = registry.subscribe(changed);
		const unregister = registry.register({
			id: 'example',
			tabs: [{ id: 'summary', label: 'Summary', component }],
			activate: () => dispose
		});
		expect(() =>
			registry.register({ id: 'second', tabs: [{ id: 'summary', label: 'Other', component }] })
		).toThrow('Duplicate');
		expect(registry.all()).toHaveLength(1);
		unregister();
		unregister();
		stop();
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(changed).toHaveBeenCalledTimes(2);
		expect(registry.all()).toEqual([]);
	});
	it('matches custom file types and Markdown flags without executing metadata', () => {
		const registry = new ExtensionRegistry();
		registry.register({
			id: 'example',
			documentTypes: [
				{
					id: 'report',
					matches: (d) => d.id.endsWith('.report') || d.frontmatter.kind === 'report'
				}
			],
			tabs: [{ id: 'review', label: 'Review', component, documentTypes: ['report'] }]
		});
		expect(registry.tabs(registry.document('plain.md', '# Hello'))).toEqual([]);
		expect(registry.tabs(registry.document('x.md', '---\nkind: report\n---\nHello'))).toHaveLength(
			1
		);
		expect(registry.tabs(registry.document('x.report', 'Hello'))).toHaveLength(1);
	});
	it('preserves tools and rejects shadowing', () => {
		const registry = new ExtensionRegistry();
		const host = tool('read_note');
		registry.register({
			id: 'example',
			tools: (builtins) => {
				expect(builtins).toEqual([host]);
				return [tool('example_task')];
			}
		});
		expect(registry.tools([host]).map((t) => t.def.name)).toEqual(['read_note', 'example_task']);
		registry.register({ id: 'collision', tools: () => [tool('read_note')] });
		expect(() => registry.tools([host])).toThrow('Duplicate tool');
	});
	it('adds extension tasks through existing skill tool restrictions', () => {
		const unregister = extensions.register({
			id: 'test-tools',
			tools: () => [tool('example_task')]
		});
		try {
			const deps = { profile: { tools: true } } as ToolDeps;
			const skill = {
				name: 'task',
				description: '',
				prompt: '',
				provider: '',
				output: 'chat' as const,
				tools: ['example_task']
			};
			expect(toolsForRun(skill, deps).map((t) => t.def.name)).toEqual(['example_task']);
			expect(toolsForRun(skill, { profile: { tools: false } } as ToolDeps)).toEqual([]);
		} finally {
			unregister();
		}
	});
	it('uses a selected server orchestrator and returns to local loop after disposal', async () => {
		const complete = vi.fn(async () => ({
			content: 'hello',
			toolCalls: [],
			finishReason: 'stop',
			usage: null
		}));
		const run = vi.fn(async () => 'max-steps' as const);
		const unregister = extensions.register({
			id: 'test-server',
			harnesses: [{ id: 'server', complete, run, ownsAuthentication: true }]
		});
		const options = {
			profile: { id: 'server', tools: false, contextTokens: 4000 },
			messages: [],
			tools: [],
			maxSteps: 1,
			complete
		} as unknown as LoopOptions;
		expect(await runExtensionHarness(options)).toBe('max-steps');
		expect(run).toHaveBeenCalledWith(options);
		unregister();
		expect(await runExtensionHarness(options)).toBe('done');
		expect(complete).toHaveBeenCalledTimes(1);
	});
});
