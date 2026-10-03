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
- `bun run test:e2e` — Playwright mobile-layout tests (`e2e/`, phone 390×844 + tablet 800×1280, fake `window.api`).
- `bun run apk` — Android: web bundle (`vite.android.config.ts` → `out/android`), `cap sync android`, `gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`. Gradle needs JDK 21 (`android/gradle/gradle-daemon-jvm.properties` picks it).

## Platform layer (desktop + Android)

The renderer never touches `window.api`; it imports `platform` from `lib/platform` (a `PlatformApi`, `platform/types.ts`), chosen at startup: `desktop.ts` wraps the Electron preload, `api.android.ts` is the Capacitor host. Android keeps notes in `notes/` under app-private storage (Filesystem `Directory.Data`, no SAF / storage permissions), state in Preferences, and an in-memory index rebuilt on launch, resume and after each sync. Android git (`platform/git/isoGit.ts`) is isomorphic-git over a Capacitor fs adapter (`capFs.ts`) and native HTTP (`capHttp.ts`, buffered base64 bodies — no CORS proxy); same contract as `main/gitSync.ts` (commit-then-merge, never force-push). The GitHub token lives only in Keystore-backed secure storage. `isoGit.test.ts` runs it in Node against a bare repo via `git http-backend` as CGI. Conflicts reuse `ConflictWindow.svelte` as an in-app overlay (`conflictsInline`). The oldest target WebView is Chromium 92 (a Huawei tablet): `vite.android.config.ts` lowers syntax to `chrome92` and injects usage-based core-js polyfills (`@vitejs/plugin-legacy`, modern chunk only); avoid CSS newer than that (no `color-mix()` — `accents.ts` mixes colors in JS).

Layout (`lib/layout.ts` `layoutFor`, store `layout`/`touch`): mouse windows are always `desktop`. Touch devices (Android or coarse pointer): `phone` <600px stacks nav → list → editor → harness (`pane`, `back()`, top-bar Back); `tablet` 600–1023px shows list + editor with folders in a drawer (`drawerOpen`); ≥1024px is the three-pane layout. `App.svelte` keeps every pane mounted and switches layouts with CSS only, so rotation keeps the TipTap instance and caret — don't reintroduce per-layout `{#if}` branches around `<Editor />`. Settings and Changes (`view`) are overlays over the still-mounted list + editor, for the same reason. Phone panes slide: each wrapper gets `data-pos` before/current/after and hidden ones are `visibility: hidden` after the transition. Desktop/tablet: the note list toggles (`listOpen`, Mod+Shift+L, also on landscape tablets) and pane edges drag to resize (`Resizer.svelte`, `widths`, persisted in the `sidebar` state's `panes`). The tablet AI pane is a scrim-backed bottom sheet with a drag handle (`sheetExpanded`). `html[data-touch]` enlarges targets (44px); `FormatToolbar.svelte` shows on touch layouts while editing. Vim is off on Android; ghost syntax has no hover reveal when `html[data-hover=none]`. Phones use bottom sheets (`ActionMenu.svelte` `sheet`) for the note menu and overflow menus; menus and sheets are portaled to `<body>` (`lib/portal.ts`) because the sliding panes are transformed. Motion uses the `--dur-fast/--dur-pane/--dur-sheet` + `--ease-out` tokens (app.css), zeroed under `prefers-reduced-motion`; JS transitions multiply by `reducedMotion() ? 0 : 1`.

Touch gotchas (each caused a real bug): `.body` is `overflow: clip`, not `hidden` — off-screen drawers/sheets otherwise make it scrollable and focus/scrollIntoView shifts the whole UI. Note cards swipe with pointer events (`touch-action: pan-y`, direction lock) and reveal one action that commits on a clean `pointerup`, not `click` — Chrome drops the click of a tap made right after a swipe/fling. Anything that opens under the finger on pointerup gets that tap's click: `ConfirmDialog`'s scrim only cancels for a press that started on it.

View / edit mode: `app.editing` (setting `openIn`: `auto` = view on touch, edit with a mouse; new notes always edit). Toggled with `editor.setEditable()` — no remount — via the editor header's Edit/Done, double-tap, or Mod+Shift+E. In view mode the editor never autofocuses, so the Android keyboard stays down. The editor header (`.editor-head`) is a strip in normal flow above the scroll area, not an overlay.

## Native module gotcha

`better-sqlite3` is compiled for Node's ABI by `bun install`, but runs under Electron's ABI. If you see "Could not locate the bindings file" or a `NODE_MODULE_VERSION` mismatch at runtime, run `bun run rebuild`.

## Three-process architecture (electron-vite)

- `src/main/` — Node main process. `index.ts` owns the frameless window, IPC handlers, workspace lifecycle, and persistence: `electron-store` (`userData/fr5a.json` — workspace, last open file, sidebar layout, settings; renderer reads/writes it via the `state:get`/`state:set` channels with a key whitelist) plus the SQLite index (`userData/fr5a-index.db`). `fileService.ts` is the "Local File Service" (recursive scan, chokidar watch, read/write/create/delete). `db.ts` is the SQLite index. `tags.ts` parses/nests tags.
- `src/preload/index.ts` — the **only** bridge to Node. `contextIsolation` is on; the renderer touches the filesystem exclusively through the typed `window.api` (`contextBridge`). `index.d.ts` augments `Window`.
- `src/renderer/` — plain Vite + Svelte 5 (no SvelteKit). Mounted in `src/renderer/src/main.ts`.
- `src/shared/types.ts` — types + the `Channels` map of IPC channel names, shared across all three processes so they can't drift.

Data flow: main scans the folder → indexes into SQLite → renderer pulls `listNotes`/`listTags` over IPC. chokidar changes re-index and push a `notesChanged` event that triggers a renderer `refresh()`.

## electron.vite.config.ts — external deps (critical)

`main` and `preload` use an explicit `external` predicate (NOT `externalizeDepsPlugin`, which silently externalized nothing here). `electron`, node builtins, `better-sqlite3`, `chokidar`, and `electron-store` MUST stay external so they resolve from `node_modules` at runtime — bundling them breaks the native binding and pulls in electron's launcher wrapper. If you add a native or Node-only runtime dependency used by main/preload, add it to `runtimeExternals`.

## The editor model — raw Markdown text (most important concept)

The TipTap document is **literally the Markdown file, one paragraph per line** (`markdown.ts` `textToDoc`/`docToText`). There are no semantic heading/bold/list nodes. `#`, `**`, `>`, `-` stay as text; `MarkdownSyntax.ts` (a ProseMirror plugin) paints decorations over the syntax instead of transforming it. Consequences:

- Saving is just `docToText` → newline-join; the buffer _is_ the file.
- "Bold" (`MarkdownShortcuts.ts`) wraps the selection in literal `**…**`; there are no marks.
- List behavior (`ListBehavior.ts`) manipulates the raw text (Tab = 2-space indent, Enter continues the bullet/number, double-Enter clears) rather than sink/lift list nodes.
- **Ghost Syntax**: `.md-syntax` is hidden with `font-size:0` (not `display:none`, to avoid layout jumps) and fades in on line-hover / when the caret enters the token (`md-active`, computed from the selection). Bullet markers are the deliberate exception — never hidden (`.md-bullet-mark`).
- `vim.ts` is a from-scratch ProseMirror Vim plugin (no maintained package exists): modes/motions/operators, block cursor, mode badge. Loaded only when `settings.vim` is on.

The Editor component mounts TipTap via a Svelte **action** keyed on `` `${editorSession}:${vim}:${editorReloadToken}` `` so opening a note / toggling vim / external rewrites recreate the instance. Three subtleties that caused past bugs: (1) the store loads note content **before** bumping `editorSession` (the editor reads content at mount time); (2) the mount action destroys only its _own_ editor instance (`if (editor === ed)`), since a keyed swap may have already reassigned the shared `editor` ref; (3) the key is the session counter — NOT `activeId` — because a **draft note** (created in-memory with an empty `# ` H1, no file yet) gains its `activeId` on first save (the typed H1 becomes the filename, see `materializeDraft`), and that must not remount the editor mid-typing.

Tag autocomplete (`TagSuggest.ts`): a `@tiptap/suggestion` plugin on `#` showing a floating dropdown (plain DOM, `.tag-suggest` in app.css) of tags from the index; Tab/Enter completes. It has `priority: 1000` so its Tab handling beats `ListBehavior`'s Tab-indent while open.

## AI harness (`lib/harness/`, `components/harness/`)

On-device agent loop over OpenAI-compatible providers; only the HTTP request leaves the device. The renderer CSP blocks `fetch`, so network goes through `platform.httpFetch`/`httpStream` (desktop: `main/http.ts` via `net.fetch`, streamed over `http:chunk`; Android: buffered `CapacitorHttp`, the SSE body is parsed whole). Pure, Node-tested modules: `openai.ts` (client + delta accumulator), `sse.ts`, `loop.ts` (model → tools → model, `maxSteps`), `tools.ts` (read/list/search notes, `ask_user`, `write_note`, `web_search`, `fetch_url`), `context.ts` (system prompt, token budget), `privacy.ts`, `session.ts`, `skills.ts`, `web.ts`, `diff.ts`, `edits.ts`. Runtime: `harness.svelte.ts` (tabs, streaming batched per rAF, question/approval promises) and `apply.ts` (writes to the open note go through `app.editor.commands.setContent` so undo + auto-save apply). `write_note` never writes without the diff card's Apply.

- Config (`ai` state key, `config.svelte.ts`) holds provider profiles, search provider (DuckDuckGo needs no key; SearXNG / Brave / Tavily), local-only folders; API keys go to `platform.getSecret/setSecret` (desktop `safeStorage`, Android Keystore) — never into state or notes. Search keys are per provider (`search:<kind>`, legacy `search` read as fallback); Settings saves a typed key on Enter / blur / Test.
- Transcript: AI replies render through `render.ts` (`renderReply`: escapes every character, emits only its own tags, http(s)/mailto links; a bare JSON reply becomes a highlighted block) — only `render.ts` output (`renderReply`, `highlightJson`) may go through `{@html}`. `ask_user` takes up to 4 questions per call (`questions.ts`, shown as one stepped `QuestionPanel`); `write_note` keeps its reviewed diff on the tool row. `errors.ts` classifies failures; `retry()` rewinds history to the `you` entry's `mark` and resends.
- Sessions (`.fr5a/sessions/*.md`, `<!-- turn: … -->` separators) and skills (`.fr5a/skills/*.md`, frontmatter + prompt; built-ins seeded into an empty folder) are read/written via `platform.readMeta/writeMeta/listMeta` (paths relative to `.fr5a/`, can't escape it). Dot-folders aren't indexed as notes.
- The pane is lazy-loaded (`app.harnessLoaded`) and then always mounted: desktop side split (Mod+J), tablet bottom sheet, phone `pane='harness'`.

## Multi-repo sync

`shared/multiSync.ts` runs pull/push over the root repo plus nested repos (folders with their own `.git`, e.g. `private/`, `.fr5a/`), stops at the first conflict (paths prefixed with the repo folder), and routes resolve/abort to the repo mid-merge. Nested folders are added to the root `.gitignore` (`withNestedIgnored`) before any commit, so their files never reach the root remote. Desktop discovers nested repos on disk (`main/repos.ts`); Android keeps a list + per-repo token (`syncAddRepo`). `syncAddRepo` clones into a new/empty folder or turns a folder that has notes into a repo in place (first pull merges unrelated histories), and the parent repo untracks the folder (`git rm --cached` / isoGit `untrack`) — `.gitignore` alone doesn't stop tracked files from being committed. Desktop copies the notes repo's local `credential.*`/`user.*` config into the new repo (a repo-local `credential.helper store` is otherwise invisible to it). `repoOf`/`byRepo` route workspace paths to their repo.

## Changes (git status + diff)

`platform.gitChanges()` returns notes that differ from the last commit with their committed text (`GitChange`), root + nested repos, `.md/.markdown/.txt` outside dot-folders only (`isTrackedNote`). Desktop: `main/gitChanges.ts` (read-only `git status --porcelain -z` + `git show HEAD:`); Android: `isoGit.ts` `changes()` (statusMatrix). The store refreshes it (debounced) after file changes and syncs; `Changes.svelte` lists files with `DiffView.svelte` diffs (shared with the AI approval card). Without git it shows the open note's diff since it was opened (`baseline`).

Stash / revert (`gitStash`, `gitStashes`, `gitStashApply`, `gitStashDrop`, `gitRevert`; share the sync lock): desktop `main/gitStash.ts` uses real `git stash push -u -- <notes>` (terminal stashes show up too; stashes are addressed by commit sha, not index); Android keeps JSON snapshots in each repo's `.git/fr5a-stash/` (isomorphic-git's stash skips untracked files). Apply refuses when a stashed note has edits since; desktop may report merge conflicts (markers left, stash kept). Revert restores HEAD; notes HEAD lacks go to the trash. The store's `gitOp` flushes the auto-save first and `reloadFromDisk`s after.

## Per-file metadata (hidden HTML comments)

Direction and pinning live in comment lines at the top of the file: `<!-- dir: rtl -->` and `<!-- pinned: true -->` (also `<!-- locked: true -->`, and `<!-- ai: local -->` = only local AI providers may read the note, see `harness/privacy.ts`). They are parsed in both `main/fileService.ts` (stripped from title/snippet; `pinned` indexed) and renderer `markdown.ts` (`detectDir`/`setDir`/`detectPinned`/`setPinned`), and hidden in the editor via the `md-meta` node class in `MarkdownSyntax.ts`. When adding a new metadata key, update all three places.

## Renderer state

`lib/stores/app.svelte.ts` is a single `$state` class instance (via `getAppState()`) — workspace, notes/tags, active note, draft state, filters (`selectedTag`/`selectedFolder`), view (`editor`|`settings`), zen, `settings`, and `sidebar` (section visibility + per-path folder/tag expansion). Auto-save is debounced 500ms and flushed on note switch. Settings/theme/sidebar/last-open-file persist to `electron-store` via `window.api.getState`/`setState` (localStorage is kept as a legacy fallback read); `init()` restores them, re-opens the last note, then flips `booted` which fades the UI in. The accent drives full theming: `applyPalette` (accents.ts) sets `--accent` plus accent-tinted `--bg-primary`/`--bg-secondary`/`--text-main` inline on `<html>`, which app.css feeds into every surface — keep its base colors in sync with app.css.

Mixed-script fonts (`lib/fonts.ts` `editorStack`): the editor uses one stack — English family first, Arabic family second — so Latin uses the English face and Arabic code points fall back to the Arabic face in LTR _and_ RTL. Don't reorder to Arabic-first (most Arabic faces include Latin glyphs and would capture Latin text).

## Tests

Unit tests are pure logic in Node (`vitest.config.ts` includes `src/**/*.test.ts`), plus git integration tests against temp repos (`gitSync`, `gitChanges`, `isoGit`). The TipTap plugins and Svelte components are covered by the Playwright suite instead (`e2e/mobile.spec.ts` over `e2e/fakeApi.ts`: phone, tablet portrait/landscape, and mouse-desktop contexts — swipe, sheets, view/edit mode, settings, changes, harness flows). The fake model is scripted by keywords in the message (`multi?`, `md?`, `flaky?`, `long?`, `context?`). Gesture tests must wait for slides/drawers to settle before measuring touch points.
