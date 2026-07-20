# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

fr5a is a Bear-style Markdown editor for Linux: **Electron + Svelte 5 + TipTap**, bundled by **electron-vite**, packaged with **Bun**. The filesystem (a user-chosen folder of `.md` files) is the source of truth; SQLite is a disposable index.

## Commands

- `bun install` — deps; `postinstall` rebuilds `better-sqlite3` for Electron's ABI.
- `bun run dev` — electron-vite dev with HMR (launches the app).
- `bun run build` — bundle main/preload/renderer into `out/`.
- `bun run check` — `svelte-check` type check (the real type gate; the build uses esbuild and does **not** type-check).
- `bun run lint` — `prettier --check` + `eslint`. `bun run format` to fix.
- `bun run test` — vitest (`--run`). `bun run test:watch` for watch mode.
- Single test: `bunx vitest run src/main/tags.test.ts` (or `-t "<name>"` to filter by test name).
- `bun run rebuild` — re-run the native `better-sqlite3` build after an Electron upgrade or ABI error.
- `bun run dist` — package a Linux AppImage + `.deb` via electron-builder.

## Native module gotcha

`better-sqlite3` is compiled for Node's ABI by `bun install`, but runs under Electron's ABI. If you see "Could not locate the bindings file" or a `NODE_MODULE_VERSION` mismatch at runtime, run `bun run rebuild`.

## Three-process architecture (electron-vite)

- `src/main/` — Node main process. `index.ts` owns the frameless window, IPC handlers, workspace lifecycle, and config persistence (`userData/fr5a-config.json`, `userData/fr5a-index.db`). `fileService.ts` is the "Local File Service" (recursive scan, chokidar watch, read/write/create/delete). `db.ts` is the SQLite index. `tags.ts` parses/nests tags.
- `src/preload/index.ts` — the **only** bridge to Node. `contextIsolation` is on; the renderer touches the filesystem exclusively through the typed `window.api` (`contextBridge`). `index.d.ts` augments `Window`.
- `src/renderer/` — plain Vite + Svelte 5 (no SvelteKit). Mounted in `src/renderer/src/main.ts`.
- `src/shared/types.ts` — types + the `Channels` map of IPC channel names, shared across all three processes so they can't drift.

Data flow: main scans the folder → indexes into SQLite → renderer pulls `listNotes`/`listTags` over IPC. chokidar changes re-index and push a `notesChanged` event that triggers a renderer `refresh()`.

## electron.vite.config.ts — external deps (critical)

`main` and `preload` use an explicit `external` predicate (NOT `externalizeDepsPlugin`, which silently externalized nothing here). `electron`, node builtins, `better-sqlite3`, and `chokidar` MUST stay external so they resolve from `node_modules` at runtime — bundling them breaks the native binding and pulls in electron's launcher wrapper. If you add a native or Node-only runtime dependency used by main/preload, add it to `runtimeExternals`.

## The editor model — raw Markdown text (most important concept)

The TipTap document is **literally the Markdown file, one paragraph per line** (`markdown.ts` `textToDoc`/`docToText`). There are no semantic heading/bold/list nodes. `#`, `**`, `>`, `-` stay as text; `MarkdownSyntax.ts` (a ProseMirror plugin) paints decorations over the syntax instead of transforming it. Consequences:

- Saving is just `docToText` → newline-join; the buffer _is_ the file.
- "Bold" (`MarkdownShortcuts.ts`) wraps the selection in literal `**…**`; there are no marks.
- List behavior (`ListBehavior.ts`) manipulates the raw text (Tab = 2-space indent, Enter continues the bullet/number, double-Enter clears) rather than sink/lift list nodes.
- **Ghost Syntax**: `.md-syntax` is hidden with `font-size:0` (not `display:none`, to avoid layout jumps) and fades in on line-hover / when the caret enters the token (`md-active`, computed from the selection). Bullet markers are the deliberate exception — never hidden (`.md-bullet-mark`).
- `vim.ts` is a from-scratch ProseMirror Vim plugin (no maintained package exists): modes/motions/operators, block cursor, mode badge. Loaded only when `settings.vim` is on.

The Editor component mounts TipTap via a Svelte **action** keyed on `` `${activeId}:${vim}:${editorReloadToken}` `` so switching notes / toggling vim / external rewrites recreate the instance. Two subtleties that caused past bugs: (1) the store loads note content **before** flipping `activeId` (the editor reads content at mount time); (2) the mount action destroys only its _own_ editor instance (`if (editor === ed)`), since a keyed swap may have already reassigned the shared `editor` ref.

## Per-file metadata (hidden HTML comments)

Direction and pinning live in comment lines at the top of the file: `<!-- dir: rtl -->` and `<!-- pinned: true -->`. They are parsed in both `main/fileService.ts` (stripped from title/snippet; `pinned` indexed) and renderer `markdown.ts` (`detectDir`/`setDir`/`detectPinned`/`setPinned`), and hidden in the editor via the `md-meta` node class in `MarkdownSyntax.ts`. When adding a new metadata key, update all three places.

## Renderer state

`lib/stores/app.svelte.ts` is a single `$state` class instance (via `getAppState()`) — workspace, notes/tags, active note, filters (`selectedTag`/`selectedFolder`), view (`editor`|`settings`), zen, and `settings`. Auto-save is debounced 500ms and flushed on note switch. Settings persist to `localStorage` and drive global CSS variables (`--font-ui`, `--font-editor`, `data-ghost`, `data-theme` on `<html>`).

Mixed-script fonts (`lib/fonts.ts` `editorStack`): the editor uses one stack — English family first, Arabic family second — so Latin uses the English face and Arabic code points fall back to the Arabic face in LTR _and_ RTL. Don't reorder to Arabic-first (most Arabic faces include Latin glyphs and would capture Latin text).

## Tests

Pure logic only (node env, `vitest.config.ts` includes `src/**/*.test.ts`): `tags.ts`, `folders.ts`, `markdown.ts` helpers. The TipTap plugins and Svelte components are not unit-tested (they need a DOM + ProseMirror); validate those by running the app.
