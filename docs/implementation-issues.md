# Implementation notes and open issues

This file records decisions made without interrupting implementation, as requested.

## Scope

- Build extension points for custom modes, tabs, harnesses, tools, file types and Markdown metadata. Do not implement the MT5/trading or investor/publication extensions.
- Treat “in / out” as the mind-map zoom buttons, with immediate viewport changes.
- Keep the existing editor Vim integration unless a compatible editor-native alternative is established. Support single-character replacement and correct linewise delete/paste.

## Feature-specific findings

The implementation branches add detailed notes where needed:

- `docs/extensions.md` — extension authoring and supported integration points.
- `docs/map-implementation-issues.md` — map interaction decisions and verification limits.
- `docs/vim-implementation-issues.md` — Vim behavior and editor integration findings.
- `docs/map-diff-implementation-issues.md` — map comparison decisions and verification limits.

## Verification

Baseline before changes: 497 unit tests pass; Svelte check reports zero errors and warnings.
Final verification results are recorded below after integration.
