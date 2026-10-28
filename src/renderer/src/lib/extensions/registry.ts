import type { Component } from 'svelte';
import type { Skill } from '../harness/skills';
import type { Tool } from '../harness/tools';
import type { LoopOptions } from '../harness/loop';
import { parseFrontmatter, type FrontValue } from '../harness/frontmatter';

export interface DocumentContext {
	id: string;
	content: string;
	frontmatter: Readonly<Record<string, FrontValue>>;
}
export interface DocumentType {
	id: string;
	/** A matcher may inspect the filename, source or flat Markdown flags. */
	matches(document: DocumentContext): boolean;
}
export interface ExtensionTab {
	id: string;
	label: string;
	/** Optional document type IDs; omitted means all open notes. */
	documentTypes?: readonly string[];
	component: Component<{ document: DocumentContext }>;
}
export interface HarnessAdapter {
	/** Matches an explicitly configured provider ID, never silently reroutes defaults. */
	id: string;
	complete: LoopOptions['complete'];
	/** Adapter owns authentication; provider.local still controls data privacy. */
	ownsAuthentication?: boolean;
	/** Optional full orchestrator. Must obey abort, events and in-place history contract. */
	run?(options: LoopOptions): Promise<'done' | 'max-steps'>;
}
export interface AppExtension {
	id: string;
	documentTypes?: readonly DocumentType[];
	tabs?: readonly ExtensionTab[];
	/** Slash-command modes/tasks reuse the existing skill picker and permissions. */
	modes?: readonly Skill[];
	harnesses?: readonly HarnessAdapter[];
	/** Only guarded host tools are supplied. Names must not shadow built-ins. */
	tools?(hostTools: readonly Tool[]): readonly Tool[];
	/** Register resources here and release them when unregistered. */
	activate?(): void | (() => void);
}

/** Trusted, bundled code only. Workspace notes never execute extension code. */
export class ExtensionRegistry {
	private entries = new Map<string, { extension: AppExtension; dispose?: () => void }>();
	private listeners = new Set<() => void>();
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	private changed(): void {
		for (const listener of this.listeners) listener();
	}
	all(): readonly AppExtension[] {
		return [...this.entries.values()].map((x) => x.extension);
	}
	register(extension: AppExtension): () => void {
		if (!/^[a-z][a-z0-9.-]*$/.test(extension.id) || this.entries.has(extension.id))
			throw new Error(`Invalid or duplicate extension ID: ${extension.id}`);
		for (const key of ['documentTypes', 'tabs', 'modes', 'harnesses'] as const) {
			const ids = new Set(
				this.all().flatMap((x) =>
					(x[key] ?? []).map((item) => ('id' in item ? item.id : item.name))
				)
			);
			for (const item of extension[key] ?? []) {
				const id = 'id' in item ? item.id : item.name;
				if (!id.trim() || ids.has(id)) throw new Error(`Duplicate ${key} contribution: ${id}`);
				ids.add(id);
			}
		}
		const dispose = extension.activate?.() || undefined;
		this.entries.set(extension.id, { extension, dispose });
		this.changed();
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.entries.delete(extension.id);
			try {
				dispose?.();
			} finally {
				this.changed();
			}
		};
	}
	document(id: string, content: string): DocumentContext {
		return { id, content, frontmatter: parseFrontmatter(content).data };
	}
	tabs(document: DocumentContext): ExtensionTab[] {
		const types = new Set(
			this.all()
				.flatMap((e) => e.documentTypes ?? [])
				.filter((t) => t.matches(document))
				.map((t) => t.id)
		);
		return this.all()
			.flatMap((e) => e.tabs ?? [])
			.filter((t) => !t.documentTypes || t.documentTypes.some((id) => types.has(id)));
	}
	modes(): Skill[] {
		return this.all().flatMap((e) => e.modes ?? []);
	}
	adapter(providerId: string): HarnessAdapter | undefined {
		return this.all()
			.flatMap((e) => e.harnesses ?? [])
			.find((h) => h.id === providerId);
	}
	tools(hostTools: Tool[]): Tool[] {
		const result = [...hostTools];
		const names = new Set(result.map((t) => t.def.name));
		for (const extension of this.all()) {
			for (const tool of extension.tools?.(Object.freeze([...hostTools])) ?? []) {
				if (!tool.def.name.trim() || names.has(tool.def.name))
					throw new Error(`Duplicate tool: ${tool.def.name}`);
				names.add(tool.def.name);
				result.push(tool);
			}
		}
		return result;
	}
}

export const extensions = new ExtensionRegistry();

/** A full server harness can replace orchestration using the same UI event contract. */
export async function runExtensionHarness(options: LoopOptions): Promise<'done' | 'max-steps'> {
	const adapter = extensions.adapter(options.profile.id);
	if (adapter?.run) return adapter.run(options);
	const { runLoop } = await import('../harness/loop');
	return runLoop(options);
}
