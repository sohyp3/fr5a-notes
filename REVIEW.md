# Review — uncommitted mind-map + performance work

**Date:** 2026-10-25
**Branch:** `main`
**Scope:** 40 modified files + 9 untracked paths (49 total)

## Verdict

Both changes are real and mostly well built — but the working tree is **not commit-ready**. `lint` fails with 12 errors in the new code, and the mind-map feature adds a full-workspace read loop that can bring back the lag you just had fixed. The 49-file diff is **legitimate ripple, not a random rewrite**: `git diff -w` is identical to `git diff`, so there is zero whitespace or formatting churn.

## Verification

| Command         | Result                                 |
| --------------- | -------------------------------------- |
| `bun run check` | 0 errors, 0 warnings                   |
| `bun run test`  | 46 files, 373 tests pass               |
| `bun run lint`  | **fails: 12 errors**, all in new files |
| Playwright e2e  | not run                                |

`bun test` (Bun's own runner) is not the project script; it times out the isomorphic-git suite here. Use `bun run test`.

## Why there are 49 changed paths

`git status` shows **40 modified + 9 untracked** = 49. The 9 untracked paths add about 3,291 lines and do **not** appear in `git diff --stat` until they are staged.

| Cause                                   | Files               | Why                                                                                                              |
| --------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| New mind-map feature                    | 9 new paths         | core parser, compiler, 2 components, 3 test files, docs                                                          |
| `NoteMeta.mindMapVersion` ripple        | ~14                 | one new **required** field forced edits in SQLite, the Capacitor indexer, the vault overlay and 8 fixtures/tests |
| Rename “Linked notes” → “Mind maps”     | 6–7                 | App, Settings, Sidebar, TitleBar, shortcuts, LinkedNotes, README                                                 |
| Frontmatter / encryption / link support | 6                   | frontmatter, markdown metadata, encrypted, pgp, wrap, link parser                                                |
| Lag fixes                               | ~6                  | Editor, app.css, NoteCard, harness Markdown/render, index.html                                                   |
| Tests                                   | 13 modified + 3 new | 422 of the 807 tracked additions are test/fixture lines                                                          |

Attribution is roughly **43 files for the map agent, 6 for the lag agent**. `NoteCard.svelte` was touched by both (passive wheel from one, map badge from the other), which is part of why the diff looks entangled. There is no lost work: typecheck and tests pass.

## What is good

- The YAML-in-Markdown data model is sound: ordinary notes, Git-friendly, versioned, explicit vs derived nodes, provenance, bounded expansion.
- Validation is unusually good: line/column diagnostics, read-only mode for malformed maps, unsupported-version handling, optimistic source check on save.
- Encryption integration is careful: YAML encrypted, metadata left clear, round-trip tests.
- Cross-platform metadata indexing (desktop SQLite + Capacitor) is covered.
- Frontmatter is excluded from titles, snippets, tags and editor link parsing — a genuine improvement, not just map plumbing.
- Strong tests: CRLF, BOM, comments/extensions, encryption, stream equivalence, 5 e2e scenarios.
- Mobile sheet, accessible outline, reduced motion, focus handling, and a real empty state. The docs are genuinely useful.

## What to change, in priority order

### P0 — before committing

1. **Make `bun run lint` pass.** The 12 errors are all in `CuratedMindMap.svelte` / `mindMaps.ts`: unused `loadedMtime`, `_position`, `MindMapNodeSpec`; three `svelte/prefer-svelte-reactivity` hits on local `Map`/`Set` (some are legitimately non-reactive — add a targeted disable with a reason); six missing `{#each}` keys.

2. **Broken maps disappear from the picker.** `mindMapVersion()` returns `null` when YAML does not parse or `version` is not numeric (`src/shared/mindMap.ts:399`), and `MindMaps.svelte:8` only lists `mindMapVersion !== null`. So the exact case the canvas has a nice diagnostics screen for — invalid YAML — becomes unreachable from Mind maps. You can only find the note in the note list and repair it by hand. The e2e test for this passes only because `e2e/fakeApi.ts` detects the version with a regex even when the YAML is invalid. Fix with a sentinel (`-1` = declared but invalid) or a separate `hasMindMap` flag; make the fake API use the real detector.

3. **Remove the double full-vault read in `CuratedMindMap`.**
   - `load()` reads every visible note's body (`:64–125`).
   - `save()` reads every note again (`:132–165`).
   - `save()` → `app.writeMindMap()` → `refresh()` → `revision()` changes while `saving` is true → `load()` sets `refreshQueued` → the `finally` runs **a second full load after every save**.
   - `reflow()` reads all notes again (`:459–493`).

   On a large vault, dragging one node means thousands of file reads, plus PGP work for encrypted notes. Add a content cache keyed by `id:mtime`, skip the self-write reload, and do not queue a reload after a successful save. This is the main architectural issue.

4. **Update `baseline` in `writeMindMap`.** It sets `activeContent` and bumps `editorReloadToken` but not `baseline` (`app.svelte.ts:977–1001`). If the map note is also open in the editor, the dirty-state bookkeeping is stale. Mirror what `openNote` does.

### P1 — should fix before or soon after merge

5. **YAML dependency.** `yaml@1.10.3` is the latest v1 (published March 2026, so not abandoned) but v2.9.1 is the current line and is ESM/tree-shakeable. More practically: `shared/mindMap.ts` is statically imported by `vault/wrap.ts:6` and `platform/api.capacitor.ts:43`, so the YAML parser ships in the **startup bundle** on desktop and mobile even with mind maps off. The “optional chunk” comment in `App.svelte` only covers the component. Move version detection to a parser-free module (the indexer only needs a rough flag/version) or lazy-load it.

6. **The setting is misleading.** `Editor.svelte:121,187` uses `settings.linkedNotes` to enable note-link suggestions and Mod+click follow. The label now says “Enable mind maps”, so turning maps off silently disables link following in the editor. Either rename the section to “Links & maps”, or split into two toggles (links vs curated maps).

7. **Remap `lastMindMap` on move/rename.** `pathMoved` re-points `activeId`, tabs, folders and hidden folders, but not `activeMindMap` / `lastMindMap`. Renaming an open map kicks you to the chooser and loses the last map on next launch.

8. **Harden `frontmatter.ts`.** The first `---` after line 1 closes the block. A normal note that starts with a horizontal rule `---` and has another `---` later gets everything between stripped from title/snippet/tags. This changes behavior for **all** notes, not just maps. Add tests for that and for `---` inside block scalars; tighten the heuristic or document the limitation.

9. **Fix test hygiene and regression checks.**
   - The five map e2e tests live in `e2e/linkedNotes.spec.ts`; rename/split into `mindMaps.spec.ts`.
   - Verify the passive wheel change on `NoteCard.svelte` does not let horizontal trackpad gestures trigger back/forward navigation. If it does, use one delegated **non-passive** listener on the list instead of one per card.
   - Add a test that a map with invalid YAML is still listed with a read-only/warning state.

10. **Map robustness and UI polish.**
    - No total node/depth cap; recursive `visit` / `span` / `placeBranch` / `descendantOf` can blow the stack on a pathological shared map. Cap total nodes and branch depth during validation.
    - Dedupe derived edges when one note matches both outgoing links and a tag expansion.
    - `save()` silently drops actions while `saving` / `loading`; disable the mutating controls or queue the last action.
    - All canvas node buttons are tab stops; use roving `tabindex` like the outline.
    - A map note shows a badge, but clicking it opens the raw YAML editor. Add “Open mind map” to the note context menu or make the badge actionable.

### P2 — cleanup

- Split the 1,663-line `CuratedMindMap.svelte` into canvas / inspector / outline.
- Clear the Editor scroll and `cameraAnimating` timers on unmount.
- Drop the dead `loadedMtime`, the duplicate `next` icon (reuse `chevron`), and consider making `mindMapVersion` optional to reduce future fixture ripple.
- Bump the version (still `0.1.3`) and fix the Settings section description (“Links between notes…” does not mention curated maps).
- `index.html` changes (theme-color, `interactive-widget`, `color-scheme`) are unrelated to both briefs. Harmless, but confirm they are intentional or move them to a separate commit.

## Suggested commit split

1. `perf(ui)` — streaming reply blocks, scroll hover suppression, passive card wheel, formatter.
2. `fix(notes)` — frontmatter boundaries, metadata edits, link resolution, encrypted map round-trip.
3. `feat(mind-maps)` — parser, compiler, canvas, chooser, store/index plumbing.
4. `docs/chore` — README, docs, YAML dependency, labels.

## Two product decisions

1. **Does “instead of linked notes” mean remove the automatic All-notes graph, or keep it as a fallback?** The agent kept it as “All notes”. That is defensible, but it is extra surface to maintain and the setting still controls the old link feature.
2. **Should note links keep working when mind maps are off?** Right now one toggle controls both. Splitting them is likely better.
