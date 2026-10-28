# Implementation notes and open issues

This file records decisions made without interrupting implementation, as requested.

## Scope

- Build extension points for custom modes, tabs, harnesses, tools, file types and Markdown metadata. Do not implement the MT5/trading or investor/publication extensions.
- Treat “in / out” as the mind-map zoom buttons, with immediate viewport changes.
- Keep the existing editor Vim integration unless a compatible editor-native alternative is established. Support single-character replacement and correct linewise delete/paste.

## Feature-specific findings

The implementation branches add detailed notes where needed:

- `docs/extensions.md` — extension authoring and supported integration points.
- `docs/extensions-implementation-issues.md` — extension limits.
- `docs/review-results.md` — independent reviews and resolution of findings.
- `docs/map-implementation-issues.md` — map interaction decisions and verification limits.
- `docs/vim-implementation-issues.md` — Vim behavior and editor integration findings.
- `docs/map-diff-implementation-issues.md` — map comparison decisions and verification limits.

## Verification

Baseline before changes: 497 unit tests pass; Svelte check reports zero errors and warnings.

## Supported scope and remaining limits

- Extensions are trusted TypeScript/Svelte integrations registered in `extensions/setup.ts`, compiled into the app. There is no installation marketplace or code sandbox.
- Document tabs match existing notes by filename or flat Markdown metadata. Arbitrary non-Markdown file indexing is still a host/platform adapter task.
- Remote harness adapters can supply completion or full orchestration. No server protocol or remote service is deployed.
- Maps can be compared with Mind maps disabled. Nested-repository maps show editing guidance; open their repository folder as the workspace to edit them.
- Map stash/revert is intentionally unavailable; those actions still use note-specific storage. Mixed batches explicitly target notes.
- The magnet means a visible 20 px snapping grid. Enabling it aligns current cards as one undoable operation.
- `r` replaces one character; `R` overwrites until Escape. Replace-mode Backspace does not restore overwritten characters. See the Vim notes for this compact implementation's limits.

## Integration issues resolved

- Lazy-load map comparison code only when actual unsealed map changes exist; note-only Changes and disabled-map startup request no map modules.
- Serialize autosave and sync disk-conflict decisions. Regression checks advance the save timer while the dialog is open and make a newer local edit during the final disk read.
- Prebundle Dagre in development to prevent a first-use Tidy optimizer reload.
- Existing stash/revert checks now assert the stable empty-state heading after copy was updated to include maps.
- Measure composer alignment in one browser frame; retain the original one-pixel tolerance during tablet sheet motion.

## Final verification

- 527 unit tests pass across 64 files.
- Svelte check: zero errors and warnings.
- Electron production build passes.
- ESLint and Prettier pass for changed TypeScript/Svelte files.
- Final integrated map/diff browser suite: 61 pass, 20 intentionally skipped (desktop-only cases run once).
- Existing mobile AI, tabs, note editing and Changes smoke suite: 65 passed; one tablet alignment check had a measurement race, corrected without changing its tolerance. The corrected case passed three repeats in isolation and the final phone/portrait-tablet/landscape-tablet rerun (3/3).
- Browser coverage uses the project's in-memory host API with desktop contexts and emulated phone/tablet inputs. Native device builds and real hardware were not exercised in this environment.
