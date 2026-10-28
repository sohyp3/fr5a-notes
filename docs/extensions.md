# Extending fr5a

The extension API is for **trusted, bundled TypeScript/Svelte code**, registered before the app mounts in `src/renderer/src/lib/extensions/setup.ts`. It is not a marketplace, executable Markdown loader, sandbox or installation UI. No extensions are shipped by default.

`AppExtension` and `ExtensionRegistry` live in `extensions/registry.ts`. Import your extension and call `extensions.register(extension)` in `setupExtensions()`. Keep the returned function to unregister it; it removes contributions and calls the activation cleanup once. Activation must clean up its own work if it throws. Contribution IDs must be unique within their category across all registered extensions; tool names cannot shadow built-in tools. Treat registered contribution objects as immutable.

## Document views and flags

A document type supplies a predicate over `{ id, content, frontmatter }`. Frontmatter uses the existing flat Markdown parser: strings and simple lists only, not general YAML. For example:

```ts
import Summary from './Summary.svelte';
import type { AppExtension } from './registry';

export const example: AppExtension = {
	id: 'example',
	documentTypes: [
		{
			id: 'example.report',
			matches: (document) => document.frontmatter.kind === 'report'
		}
	],
	tabs: [
		{
			id: 'example.summary',
			label: 'Summary',
			documentTypes: ['example.report'],
			component: Summary
		}
	]
};
```

The Svelte component receives a reactive `document` prop. Tabs appear beside the built-in Note view only for matching open notes. A tab with no `documentTypes` appears for every saved note. Components can implement charts, controls or further views; component render failures have a retry boundary. Switching notes returns to Note. The original editor remains mounted to retain undo state. These view props are read-only; writes must deliberately use the app's existing save/review APIs rather than altering the prop.

Predicates can recognize another filename suffix, but the host currently indexes Markdown notes. Recognizing an extension does **not** add arbitrary file formats to the filesystem index. A binary or external account format needs a dedicated platform/indexer adapter and an explicit storage design.

## Modes, tasks and tools

`modes` contributes existing `Skill` objects: slash-command name, description, prompt, allowed tool names, provider ID and output mode. They appear in the existing skill picker after startup loading. A contributed mode takes precedence over a disk skill of the same name; duplicate contributed names are rejected.

`tools(hostTools)` contributes `Tool` objects (`def` JSON schema and async `run`). Tools run through the existing loop and the chosen skill's tool allowlist. A profile with tools disabled receives none. `hostTools` contains the host's existing guarded tools; calling those retains note permission checks and write-review behavior. Do not implement writes by reaching around those tools. Extension factories should be pure and should not retain per-run tools across chats.

```ts
tools: (host) => [
	{
		def: {
			name: 'example_task',
			description: 'Run an example task',
			parameters: { type: 'object', properties: {} }
		},
		run: async () => 'Task complete'
	}
];
```

## Completion providers and full harnesses

`harnesses` maps an exact configured provider ID to a completion adapter. Add the corresponding provider through Settings → AI; the existing picker and model/profile settings continue to work. No default traffic is redirected. `complete(request)` receives messages, tool definitions, streaming callback and abort signal and returns the same `CompletionResult` used by built-in transports. An extension may call its own server or SDK. Use the platform HTTP transport if mobile support is required. Credentials belong in secure storage or the adapter, never Markdown/frontmatter.

`ownsAuthentication: true` allows an adapter with its own authentication to run without a built-in API key. This does not mark it local: keep the configured provider's `local` flag false for a remote service so the host's existing encrypted-note and local-only-folder privacy checks still apply.

For a full server-side orchestrator, optionally supply `run(options)`. It receives the existing `LoopOptions` and must return `done` or `max-steps`. It must append assistant/tool messages to `options.messages`, deliver the UI callbacks, propagate abort and honor max steps and tool restrictions. It must invoke guarded host tools for any host-side changes. The adapter's `complete` remains available to that runner. Unregistering restores the built-in loop. The host does not define a server protocol or deploy a service.

## Storage and publication invariants

Extensions own their domain schema and migrations. Namespaced metadata avoids collisions with existing Markdown flags. Account credentials and unpublished private data must not leak into synced notes. Future immutable publication should use separate immutable snapshots with stable IDs and content hashes, plus append-only revisions linking to previous snapshots; a UI read-only flag alone cannot enforce immutability. Enforcement belongs at every writer and the authoritative storage service. This foundation does not claim immutable storage or implement publishing, trading, account integration or investment features.
