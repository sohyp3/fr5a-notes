# Stage 2 review — Graph color and map navigation

**Verdict:** pass (**94 / 100**; pass mark is 90)
**Round:** re-review after repairs. The previous round scored **85 / fail**.
**Reviewed:** working tree with Stage 1, Stage 3 and Stage 4A changes present and in flight
**Scope:** `docs/bugfix-roadmap.md` §2.1 and §2.2 only. Stage 1 edits (`selectTag`, `layout.ts`,
list numbering), Stage 3 sync work (`refresh.ts`, `mapSyncVersion`, `.fr5a/` paths) and Stage 4A
harness edits in the same tree were not scored. `MASCOTS.md` deletion was ignored.

## What was checked

- Every Stage 2 file in the diff: `MapCanvas.svelte`, `MapChooser.svelte`, `MindMaps.svelte`,
  `TitleBar.svelte`, `ActionMenu.svelte`, `App.svelte` (the `TitleBar` caller),
  `stores/app.svelte.ts` (`init`, `openGraph`, `openMindMap`, `renamedMindMap`, `forgotMindMap`,
  `setView`, `back`), `maps/canvas.ts` (`colorHex`, `PRESETS`), `stores/mapNavigation.test.ts`,
  and `e2e/maps.spec.ts`.
- Commands:
  - `npm run check` — **0 errors, 0 warnings**.
  - `npm test` — **54 files, 451 tests passed**.
  - Focused `vitest` on `stores/mapNavigation.test.ts` plus `lib/maps/*` — **4 files, 26 tests
    passed**.
  - `npx prettier --check` on all Stage 2 files — **passes**.
  - `npx eslint` on all Stage 2 files — **clean**.
  - `npx playwright test e2e/maps.spec.ts` — **7/7 passed**, including the two new Stage 2
    scenarios (run on an alternate port because port 5199 was occupied by another reviewer; the
    repo test file was not modified).
- `git diff` of the Stage 2 files, re-read against the roadmap acceptance wording.

## 2.1 Actual colors in the map color menu — met

| Requirement                                    | Status                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Optional swatch on `MenuItem`                  | Yes (`swatch?: string`); icon and swatch are mutually exclusive                                                                |
| Presets rendered with theme-aware `colorHex()` | Yes (`MapCanvas.colorMenu`), same mapping as node rendering                                                                    |
| Text label preserved for accessibility         | Yes; swatch is `aria-hidden`, the label is the accessible name                                                                 |
| Visible selected state                         | Yes — all color rows are `role="menuitemradio"` + `aria-checked`, plus a radio-dot icon                                        |
| Obvious “No color” option                      | Yes; it is the selected row for an uncolored or mixed-to-null selection                                                        |
| Unrelated action menus unchanged               | Yes — `menuitemradio` is only used when `selected` is defined; persisted colors remain `1`–`6`                                 |
| Light/dark, keyboard, touch                    | Theme and keyboard are automated in the new e2e test; the bottom-sheet path is shared code but only manually checkable (below) |

Mixed multi-selection marks no row, and an imported custom `#rrggbb` marks no preset. Both are
reasonable; applying a preset still serializes the preset id. The keyboard selector widening to
`[role^=menuitem]` makes the radio rows reachable with Arrow keys and initial focus.

## 2.2 Reopening, Back, and Close — met

- `init()` restores `lastMindMap` without setting `activeMindMap`, so boot still lands in the
  editor and Mod+G is the entry point.
- `openGraph()` returns immediately when the requested map is already the open view, so the
  sidebar **Mind maps** entry and Mod+G no longer unmount the canvas, flash the chooser, re-read
  the file, or drop undo/selection/pan. This is asserted by the e2e “data-e2e-canvas” marker and
  the Undo button check.
- A saved map is validated with `readMap` before navigation; `saved(target)` still waits for
  pending writes. A missing file clears the remembered name and lands on the chooser. A rejected
  read is now distinguished from a missing file: the user gets an error notice and the remembered
  map is kept.
- `renamedMindMap(from, to)` updates the remembered path and its persisted state after a
  successful rename; `forgotMindMap(name)` clears it only when the deleted map is that map.
- Lazy imports are retained. With mind maps off, Mod+G still opens the automatic graph and does
  not request map persistence. Back/Close labels agree with `back()` for the chooser, the
  automatic graph with mind maps on (`Back to maps`) and with mind maps off (`Close mind maps`).
- Phone title-bar Back and Android hardware Back still share `back()`; opening a note from a map
  keeps `lastMindMap`, so Mod+G returns to the map.

## Previous issues — status

| #   | Previous issue                                            | Status                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Mod+G remounted an already-open map (medium)              | **Fixed** — early return in `openGraph()`; unit + e2e coverage                                                                                                                                                                    |
| 2   | Renaming the last map lost the remembered map (medium)    | **Fixed** — `renamedMindMap()` called after rename; `forgotMindMap()` on delete; unit + e2e coverage                                                                                                                              |
| 3   | A transient read failure permanently forgot the map (low) | **Fixed** — only a `null` read clears it; a rejection notifies and keeps it; unit coverage                                                                                                                                        |
| 4   | Prettier failed on six Stage 2 files (medium)             | **Fixed** — all Stage 2 files pass Prettier                                                                                                                                                                                       |
| 5   | Test gaps for the two behaviours (medium)                 | **Largely closed** — `mapNavigation.test.ts` now has 7 focused tests; the maps e2e covers swatches, selected state, theme switch, keyboard selection, persistence, no-remount reopen, and rename. Remaining gaps are listed below |

## Remaining issues

### 1. Reopening a saved map has no loading affordance (low)

`openGraph()` now waits for `saved()` and `readMap()` before setting `view = 'graph'`. That removes
the chooser flash, but on a slow or stalled disk the editor simply stays put with no busy state,
so Mod+G can look inert. A cheap fix would be to set a small “opening map” flag and show it in the
title bar or canvas shell; no correctness problem.

### 2. A few paths still rely on manual checks (low)

Automated coverage does not reach:

- the phone/tablet bottom-sheet rendering of the color menu (swatches, radio dot, drag-to-dismiss),
- the rendered `TitleBar` Back/Close label itself (the e2e finds buttons by that name, so it would
  catch a missing control, but not a wrong label on every surface),
- deleting the last map through the chooser UI (`forgotMindMap` is unit-tested directly; the
  delete button path is not).

These are verification gaps, not known defects.

### 3. Selected radio dot is 15px in the touch sheet (low)

`ActionMenu.svelte` draws menu icons at 18px in sheet mode but the selected `on` icon is fixed at
15px. On the phone sheet the check dot is slightly smaller than the swatch/icon column. Cosmetic.

### 4. Not Stage 2 — Svelte Flow attribution warning (informational)

The working tree adds `proOptions={{ hideAttribution: true }}` to `MapCanvas`. Every e2e run logs
“Please only do this when you are subscribed to Svelte Flow Pro”. This is unrelated to the Stage 2
requirements; confirm the Pro licence or restore the attribution before release.

### 5. Not Stage 2 — repo-wide lint is still red (informational)

Stage 2 files are clean, but `npx prettier --check .` still reports review docs and Stage 3/4A
files (`harness/*`, `shared/paths.test.ts`), and `npx eslint .` reports one
`svelte/prefer-svelte-reactivity` error in `harness.svelte.ts`. Those belong to other stages.

## Manual checks still pending

Desktop (1440×900):

- [ ] Slow/locked disk: Mod+G from the editor — no chooser flash, and note whether the missing
      loading cue is acceptable.
- [ ] Select two differently colored nodes → no row marked (mixed); applying one color affects
      both.
- [ ] Imported canvas with a custom `#rrggbb` node → no preset marked; applying a preset stores
      the preset id.
- [ ] Delete the last map through the chooser, then Mod+G — chooser appears without an error
      banner.

Phone (390×844) and tablet:

- [ ] Touch color menu opens as a bottom sheet; swatches and the selected dot are legible; drag to
      dismiss still works.
- [ ] Map → Back to maps; Back again leaves; both title-bar label and Android hardware Back agree.
- [ ] Graph (automatic) with mind maps on: title says “Graph”, Back says “Back to maps” and
      reaches the chooser.
- [ ] Map → open a note → Mod+G returns to the map.

## Verification summary

| Check                      | Result                                       |
| -------------------------- | -------------------------------------------- |
| `npm run check`            | 0 errors, 0 warnings                         |
| `npm test`                 | 54 files, 451 tests passed                   |
| Focused Stage 2 unit tests | 4 files, 26 tests passed                     |
| Stage 2 Prettier           | passes                                       |
| Stage 2 ESLint             | clean                                        |
| `e2e/maps.spec.ts`         | 7/7 passed (both new Stage 2 tests included) |
| Roadmap acceptance §2.1    | met                                          |
| Roadmap acceptance §2.2    | met                                          |

**Threshold result:** **pass** — 94 ≥ 90. No medium or high issue from the previous round remains.
