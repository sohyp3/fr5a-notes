# fr5a

A highly polished, Bear-inspired Markdown editor for Linux. Your notes are plain
Markdown files in a folder you choose — the filesystem is always the source of
truth. fr5a indexes tags and metadata for a fast sidebar, and edits Markdown
_in place_ so the syntax symbols stay in your text while looking beautifully
formatted.

Built with **Electron + Svelte 5 + TipTap**, bundled by **electron-vite**,
packaged with **Bun**.

## Highlights

- **Filesystem is truth.** Notes are `.md` files in a user-picked folder. Nothing
  is locked in a proprietary store.
- **Live-syntax editor.** A custom TipTap `MarkdownSyntax` extension keeps the raw
  Markdown symbols (`#`, `**`, `>`, …) in the document but decorates them: opacity
  `0` by default, `0.3` on line-hover, and `1.0` when the caret is inside that
  token — so the page reads clean but every symbol is one glance away.
- **Recursive folders.** The scanner walks sub-directories to any depth. The
  sidebar shows a **folder tree**; clicking a folder filters the note list to
  that folder and its children, while "All Notes" shows the whole workspace.
- **Nested tags.** `#work/project1` is parsed into a collapsible tree in the
  sidebar, with per-branch note counts. Unicode/Arabic tags work too.
- **Pinning.** A `<!-- pinned: true -->` marker keeps a note at the top of the
  list; pinned notes reorder with a smooth `animate:flip`. Pin from the editor,
  or **swipe a note card right to pin / left to delete** (horizontal trackpad
  scroll), with the action colour tracking under the card.
- **Mixed-script typography.** The editor font is one stack — English first,
  Arabic second — so Latin text uses your English face and any Arabic glyph
  falls back to your Arabic face, **even inside an LTR paragraph**.
- **Smart lists.** `Tab` / `Shift-Tab` indent and outdent list lines; `Enter`
  continues the bullet or number; a second `Enter` on an empty item clears it.
- **Instant index.** `chokidar` watches the folder and `better-sqlite3` indexes
  titles, snippets and tags so the list/sidebar render without re-scanning disk.
- **Auto-save.** Edits are debounced and written to disk 500ms after you stop
  typing; switching notes flushes immediately.
- **Frameless, three-column, themed.** Sidebar (tags) · note list (search +
  snippets) · editor. Warm off-white light mode, deep-charcoal dark mode, no
  internal borders. Inter for UI, JetBrains Mono for Markdown syntax. Spring-
  animated sidebar toggle.
- **Settings view.** A dedicated in-window page (gear at the sidebar bottom, or
  `Mod+,`): change the default folder, pick UI / English / Arabic fonts, and
  toggle Vim motions and Ghost Syntax. Preferences persist across launches.
- **Per-file direction (RTL/LTR).** A hidden `<!-- dir: rtl -->` comment at the
  top of the file drives the editor direction. The comment is auto-detected and
  hidden from view; the `LTR`/`RTL` button writes it. Arabic notes get their
  Arabic face, `text-align: justify`, and a roomier `1.8` line-height.
- **Ghost Syntax.** Markdown symbols collapse with `font-size: 0` (not
  `display:none`, so nothing "jumps"), fading in on line-hover and lighting up
  when the caret enters them. Bullet markers are the deliberate exception —
  never hidden, styled as a coloured, evenly-spaced glyph.
- **Zen mode** (`Mod+\`): the sidebar and note list spring out of view and the
  editor centres itself. A `fly` transition plays when you switch notes.
- **Vim motions** (optional): a built-in modal editor — normal · insert · visual,
  `hjkl w b e 0 $ gg G`, `i a I A o O`, `x dd dw yy p u Ctrl-r`, and a block
  cursor. A mode badge shows the current state.
- **Cross-platform keys.** Shortcuts use `Mod`, so `Ctrl+B` on Linux/Windows and
  `⌘B` on macOS both wrap the selection in `**bold**` (`Mod+I`, `` Mod+` ``,
  `Mod+Shift+X` likewise).

## Architecture

```
src/
  main/          Electron main process (Node)
    index.ts       window, IPC, workspace lifecycle, config persistence
    fileService.ts the "Local File Service": scan / read / write / watch
    db.ts          better-sqlite3 index (disposable cache over the folder)
    tags.ts        tag parsing + nested-tree builder
  preload/       contextBridge — the single typed IPC surface (window.api)
  shared/        types + IPC channel names shared across processes
  renderer/      Svelte 5 app (plain Vite, no SvelteKit)
    src/lib/components/  TitleBar · Sidebar · TagTree · FolderTree · NoteList ·
                         NoteCard · NoteContextMenu · Editor · Settings ·
                         CheatSheet · EmptyState
    src/lib/stores/      app.svelte.ts — runes-based app state + auto-save
    src/lib/editor/      markdown.ts (text↔doc) · MarkdownSyntax.ts (decorations) ·
                         MarkdownShortcuts.ts (bold/italic) · ListBehavior.ts
                         (Tab/Enter) · vim.ts (from-scratch modal editor)
    src/lib/             fonts.ts · folders.ts · accents.ts · shortcuts.ts
```

The renderer never touches Node directly — `contextIsolation` is on and every
filesystem action funnels through the typed `window.api` bridge.

## Developing

```sh
bun install      # postinstall rebuilds better-sqlite3 for Electron's ABI
bun run dev       # electron-vite dev with HMR
```

If the native module ever complains about its ABI (e.g. after an Electron
upgrade), rebuild it:

```sh
bun run rebuild
```

## Quality gates

```sh
bun run check     # svelte-check (types)
bun run lint      # prettier + eslint
bun run test      # vitest — tag tree + Markdown round-trip
```

## Building a distributable

```sh
bun run build     # bundle main/preload/renderer into out/
bun run dist      # package a Linux AppImage + .deb via electron-builder
```

## Using it

On first launch fr5a asks for a folder. Point it at any directory of Markdown
files (a `sample-notes/` folder is included to try it out). Add `#tags` — including
nested ones like `#work/project1` — anywhere in a note to see them appear in the
sidebar tree.
