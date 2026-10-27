# Stage 1 review — numbered lists and tag navigation

- **Re-reviewed:** 2026-10-27, working tree on `main` (Stage 1 repairs uncommitted)
- **Scope:** roadmap Stage 1 (§1.1 nested list numbering, §1.2 tag reveals its filtered list)
- **Verdict:** **PASS** — score **94/100** (threshold ≥ 90)
- **Mode:** read-only review of the current tree. Only this review file was written; no code, roadmap, or `MASCOTS.md` changes.

The previous review (`68/100`, FAIL) was against the pre-repair tree. All five blocking issues and the three tag/layout defects from that review are fixed. A concurrent agent is now editing later-stage files (maps, harness, sync paths), so the full-tree working copy is not a stable Stage 1-only baseline; those files were excluded from the score.

---

## Score breakdown

| Area | Result | Points |
| --- | --- | --- |
| §1.1 Numbering follows the list level | Core Enter/Tab/Shift-Tab paths correct, descendants move with their parent, task lines no longer renumber, end-of-item sibling runs advance. One mid-line Enter edge still duplicates an ordinal. | 41 / 45 |
| §1.2 Selecting a tag reveals the filtered list | Works on desktop/tablet/phone; tag + AI at 900 px keeps navigation and list; all three fit at ≥1100 px; empty state is tag-specific; DOM-level e2e added. Extreme narrow widths still yield a very small editor. | 34 / 35 |
| Tests, checks, and regression safety | `check`, lint/format, unit suite, and the Stage 1 e2e specs pass. Coverage is substantially better; mid-line Enter and empty nested-item edges are untested, and the full e2e run was inconclusive under concurrent edits. | 19 / 20 |
| **Total** | | **94 / 100** |

---

## Previous blocking issues — closure

| # | Issue | Status |
| --- | --- | --- |
| 1 | Enter on a task renumbered a following numbered list | **Fixed.** Renumber block is gated on `!task && m[3]`; regression test at `ListBehavior.test.ts:214`. |
| 2 | Tab on a list item orphaned its nested children | **Fixed.** `sink` now moves descendants with the item; tests for numbered, bullet, and task parents at `:162`, `:178`. |
| 3 | Shift-Tab left following siblings nested without renumbering | **Fixed as a deliberate hierarchy.** Lifted item keeps its outer number; former siblings stay under the old parent and restart at 1; test at `:193`. This matches normal outdent semantics. |
| 4 | Enter on a parent inserted before its children / duplicated ordinals | **Fixed at end of line.** New item is inserted after the subtree and a contiguous sibling run advances; tests at `:221`, `:236`, `:243`. A mid-line variant remains (R1 below). |
| 5 | Existing e2e broke on the renamed navigation button | **Fixed.** `TitleBar.svelte:127-129` keeps the stable `aria-label="Toggle sidebar"` while the visible title is stateful. `e2e/mobile.spec.ts:331` and both new tag tests pass. |
| 6 | Tag + AI at ~900 px dropped navigation although it fits after AI yields | **Fixed.** `layout.ts:43-46` hides AI and re-runs the shrink, restoring both sidebars; `layout.test.ts:35-38` and the 900 px e2e case assert it. AI is closed visibly with a notice instead of staying silently open. |
| 7 | Wide tag + AI dropped navigation before shrinking a pane | **Fixed.** Panes shrink in order before the sidebar is dropped; `layout.test.ts:44-50` requires all three visible at 1100/1280 px, and the 1280 px e2e case passes. |
| 8 | `EDITOR_MIN` not an invariant at very narrow desktop widths | **Still present, low severity** (R2 below); behavior is now explicit in the code comment and tests. |
| 9 | Empty tag results showed the generic "No notes here yet" copy | **Fixed.** `NoteList.svelte:149-150` shows "No notes with this tag"; the touch e2e asserts it. |

Coverage gaps called out last time are largely closed: `e2e/tags.spec.ts` selects a tag and checks the rendered `.list-wrap` on phone, tablet, and desktop, including empty results, the nav/list swap at 700 px, and the tag + AI cases. `tagNavigation.test.ts` still asserts store state only, but the call site and DOM are now covered end to end.

---

## Remaining concrete issues

### R1. Mid-line Enter on a numbered item leaves a duplicate ordinal (Medium/Low)

**File/lines:** `src/renderer/src/lib/editor/ListBehavior.ts:113`, `:135`

The repair advances the following sibling run only when Enter was pressed at the very end of the line (`atEnd`). Splitting a numbered item in the middle still creates a new item and leaves the next sibling at the same number.

Reproduction:

```text
before: ["1. One", "2. Two"], caret after "1. O"
Enter
after:  ["1. O", "2. ne", "2. Two"]
```

The same happens inside nested levels (`  1. Child` / `  2. Sibling` → two `  2.` items). The next sibling is part of the same contiguous list, so the existing "stop at blank/prose/custom number" guard would keep this safe: run the sibling advance for any numbered Enter that inserts an item, not only `atEnd`. Add a mid-line test; the current tests only press Enter at line end.

This is the only remaining numbering correctness defect found. It does not affect the roadmap's explicit Tab / Shift-Tab / nested-continuation examples, so it does not block the stage.

### R2. Very narrow desktop still sacrifices the editor minimum for a selected tag (Low)

**File/lines:** `src/renderer/src/lib/layout.ts:47-52`; `layout.test.ts:26-32`

At 390 px with a tag selected the result is `{ side: 0, list: 220 }`, leaving roughly 130 px for the editor (`390 - 220 - 40`). The filtered list is visible, so the literal acceptance passes, and the code now documents that the editor yields at extreme mouse widths. The trade-off is not tested beyond `list > 0`. A list-overlay or a reduced list minimum at these widths would be friendlier, but this is pre-existing and out of the blocking path.

### R3. AI-pane closure notice is reported as an error (Low / polish)

**File/lines:** `src/renderer/src/App.svelte:97-102`

Widening/closing logic correctly avoids an invisible AI pane and gives the user a reason, but the notice is sent with `'error'` severity for a normal resize outcome. An informational/warning tone would match the message; no functional impact.

### R4. Other list scopes still do not reveal the note list (Out of Stage 1 scope)

**File/lines:** `src/renderer/src/lib/stores/app.svelte.ts:961-971` vs `selectFolder`/`openTrash`/`openChats`/`showAllNotes`

`selectTag` now opens the list, exits Zen, persists the pane, and clears the drawer. The other scopes still do not. Not required by §1.2, but centralizing "reveal the list" would prevent the same hidden-list class of bug elsewhere.

---

## Edge concerns checklist

| Concern | Result |
| --- | --- |
| Tag selection while list hidden / Zen on | Pass: `selectTag` opens/persists the list and exits Zen; unit + e2e |
| Tag selection on phone | Pass: pane becomes `list`; Back returns to nav with the tag intact; e2e |
| Tablet drawer | Pass: drawer closes; list filters beside the editor; e2e |
| Empty tag results | Pass: tag-specific empty copy and breadcrumb; e2e |
| Narrow desktop where nav + list do not fit | Pass: nav hides, list stays, title bar swaps back; 700 px e2e |
| Tag + AI at ~900 px | Pass: AI yields, nav + list both remain; notice explains why AI closed |
| Wide desktop with tag + AI (1100/1280 px) | Pass: all three panes visible; editor keeps ≥ 320 px |
| Tag survives nav/list swaps | Pass: swapping only toggles list/sidebar state; e2e keeps `#focus` |
| Enter on task followed by numbered list | Pass: no renumbering; regression test |
| Tab / Shift-Tab with nested children | Pass: descendants move with the item; bullet/task/numbered tests |
| Shift-Tab with following siblings | Pass: siblings stay with the old parent and restart at 1; test |
| Enter at end of a parent with children | Pass: inserts after the subtree and advances the sibling run; test |
| Enter in the middle of a numbered item | **Fails to advance the following sibling** (R1) |
| Unrelated literal Markdown | Pass for tasks, bullets, prose, blank lines, and custom ordinals in the covered paths |
| Existing e2e behavior | Pass: stable accessible name; focused desktop-mouse test green |

---

## Verification performed

Against the current tree:

```text
npm run check
→ svelte-check found 0 errors and 0 warnings

npm test
→ 53 test files passed, 446 tests passed

npx vitest run ListBehavior.test.ts layout.test.ts tagNavigation.test.ts mapNavigation.test.ts
→ 4 files passed, 28 tests passed

npx prettier --check <Stage 1 files>
→ All matched files use Prettier code style

npx eslint <Stage 1 files>
→ clean (no output)

npx playwright test e2e/tags.spec.ts
→ 9 passed (phone, tablet portrait/landscape, desktop viewports)

npx playwright test e2e/mobile.spec.ts -g "desktop mouse windows keep the side-by-side layout"
→ 3 passed

npx playwright test e2e/tasks.spec.ts
→ 2 passed, 4 skipped (skips are project-specific by design)
```

A throwaway read-only harness (deleted after use) reproduced R1 and confirmed the repaired cases for Tab with descendants, Shift-Tab with descendants and following siblings, nested Enter after a subtree, mid-line split placement, and multi-line selection Enter without a crash.

A full `e2e/mobile.spec.ts` run gave 239 passed / 19 skipped / 6 failed on tablet projects (AI harness and model-picker cases). The failures are not reproducible in isolation and the harness/maps/sync files are being edited concurrently, so they are not attributable to Stage 1 and were not counted. They do mean a clean full-suite run is still pending.

---

## Remaining manual checks

These still require a live desktop/phone shell and were not exercised here:

1. Desktop widths 1180, 900, 800, 760, 700, 640, 500: select a tag, swap nav/list with the title-bar button, confirm the tag breadcrumb persists and the list is never left hidden.
2. Same widths with AI already open (especially 900 and 1280): confirm the notice/tone, that Mod+J reopens AI once there is room, and that closing AI never leaves an invisible `harnessOpen` state.
3. Phone tag → note → Back → list → Back → nav; tablet drawer tag → drawer closes → list filters → rotate and confirm the tag survives.
4. Empty tag and tag + active search query: confirm the empty state and breadcrumb are understandable.
5. Real editor: mid-line Enter on `1.`/`2.` and on a nested pair (R1); Tab/Shift-Tab with children; double-Enter on an empty nested item; check undo granularity and that unrelated literal Markdown never renumbers.
6. Run `npm run test:e2e` once the concurrent Stage 2+ changes settle; the Stage 1 specs (`tags`, `tasks`, desktop-mouse) must stay green.

---

## Out-of-scope working-tree note

`MASCOTS.md` is still deleted in the working tree with no replacement, and later-stage files (maps, harness context/tools, sync paths) are modified by concurrent work. None of this belongs to Stage 1; confirm the `MASCOTS.md` deletion is intentional before merging the stage.

## Recommendation

**Pass Stage 1 at 94/100.** The roadmap acceptance ("numbering follows the list level, and selecting a tag never leaves the filtered notes hidden") is met on desktop, tablet, and phone, and the previously blocking defects have regression coverage.

Optional follow-ups, not gating: fix the mid-line Enter ordinal (R1) with one test, decide whether extreme narrow desktop should use a list overlay (R2), and downgrade the AI-closure notice tone (R3).
