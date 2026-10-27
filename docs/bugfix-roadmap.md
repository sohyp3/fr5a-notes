# Staged bug-fix and AI harness roadmap

This is an implementation plan, not a record of completed work. Implement and verify one stage at a time. Preserve plain Markdown notes as the source of truth, the optional/lazy-loaded graph and map features, and desktop/mobile behavior.

## Decisions

- The Mind maps entry and Mod+G **reopen the last map**. Back from a map goes to the map chooser; Close leaves the map view.
- Keep synced app data under `.fr5a/`: media in `assets/`, saved AI chats in `chats/`, maps in `maps/`. Do not create new top-level system folders or migrate these paths just to hide them.
- AI edits require approval for every change. Deletions also require an explicit destructive confirmation. A linked note on a map does not automatically become readable by AI.
- Tool guidance shown to the agent must reflect the tools actually enabled for its current run, including skill restrictions.

## Stage 1 — Numbered lists and tag navigation

### 1.1 Nested list numbering

**Files:** `src/renderer/src/lib/editor/ListBehavior.ts`; add `src/renderer/src/lib/editor/ListBehavior.test.ts`.

- On Tab from `1. Item`, indent and start the nested sequence at `1.` rather than retaining the outer number.
- Enter increments within the current indentation level. Shift-Tab returns to the outer level using the next appropriate outer number, rather than copying the inner number. Handle intervening siblings, nested lists, bullets, tasks, and empty items without unexpectedly renumbering unrelated literal Markdown.
- Test Enter → Tab, nested continuation, Shift-Tab, and multiple indent levels.

### 1.2 Tag reveals its filtered list

**Files:** `src/renderer/src/lib/stores/app.svelte.ts`, `src/renderer/src/App.svelte`; relevant layout/store tests including `src/renderer/src/lib/layout.test.ts`.

- `selectTag()` already selects the filter and sets `pane = 'list'`; make sure sidebar 2 (the note list) actually becomes visible on each layout.
- Where both sidebar 1 (navigation) and sidebar 2 fit, show the filtered list alongside navigation. Where only one fits, show sidebar 2 and close/hide sidebar 1, with a clear route back. Preserve the selected tag through the transition.
- Test desktop narrow widths and phone/tablet navigation, including empty results.

**Acceptance:** Numbering follows the list level, and selecting a tag never leaves the filtered notes hidden.

## Stage 2 — Graph color and map navigation

### 2.1 Show actual colors in the map color menu

**Files:** `src/renderer/src/lib/components/maps/MapCanvas.svelte`, `src/renderer/src/lib/components/ActionMenu.svelte`, `src/renderer/src/lib/maps/canvas.ts`.

- The current map menu shows Red/Orange/etc. as text with the same generic icon. Add an optional swatch representation to `MenuItem` and render each preset using the existing theme-aware `colorHex()` mapping. Preserve the text label for accessibility and a visible selected state; show an obvious “No color” option.
- Do not change unrelated action menus or the persisted JSON Canvas color values. Check light/dark themes and keyboard/touch access.

### 2.2 Clarify reopening, Back, and Close

**Files:** `src/renderer/src/lib/stores/app.svelte.ts`, `src/renderer/src/lib/components/MindMaps.svelte`, `src/renderer/src/lib/components/maps/MapCanvas.svelte`, `src/renderer/src/lib/components/maps/MapChooser.svelte`, `src/renderer/src/lib/components/TitleBar.svelte`.

- Preserve `openGraph()` reopening the last valid map; if it was removed, fall back to the chooser. Keep the automatic graph available when linked notes are on.
- Consistently distinguish “Back to maps” (map → chooser) from “Close mind maps” (map view → editor). Check the title bar and Android/phone Back, as well as navigation to a note from a map.
- Retain lazy imports when graph or mind maps are disabled.

**Acceptance:** The last map opens directly, the current location is clear, and Back/Close have predictable destinations.

## Stage 3 — Synced, hidden app data and live map refresh

**Files:** `src/shared/paths.ts`, `src/main/fileService.ts`, `src/main/metaFiles.ts`, `src/renderer/src/lib/platform/api.capacitor.ts`, `src/renderer/src/lib/stores/app.svelte.ts`, `src/renderer/src/lib/components/maps/MapCanvas.svelte`, `src/renderer/src/lib/components/maps/MapChooser.svelte`; inspect `src/main/gitSync.ts` and `src/renderer/src/lib/platform/git/isoGit.ts`. Tests: `src/main/syncIpc.test.ts`, `src/renderer/src/lib/platform/git/isoGit.test.ts`, `src/renderer/src/lib/maps/files.test.ts`, and platform/file-service tests as needed.

- Keep `.fr5a/assets/`, `.fr5a/chats/`, and `.fr5a/maps/` synced. Centralize path definitions where practical and verify both Git implementations include their files while excluding device-only AI sessions. Keep app storage out of the ordinary folder and note tree; retain the intentional saved **AI chats** entry.
- On sync completion, refresh the chooser’s map list and re-read an open map when its disk contents have changed. Coordinate with pending/debounced writes: do not silently overwrite either a local edit or a remotely changed map. Reuse the map’s changed-on-disk decision where applicable.
- Verify map creation, changes, renames/deletions, media, and saved chats across two devices/repositories, including when the receiving device already has the map screen open. Preserve privacy rules and existing references to assets/chats.

**Acceptance:** Synced data stays hidden from normal browsing, and a remote map change becomes visible without losing unsaved local work.

## Stage 4A — Tell the harness exactly what tools it has

Do this **before** adding AI edit/delete tools. Treat tool definitions as the source of truth for agent-visible descriptions, not a separately maintained hard-coded catalog.

**Files:** `src/renderer/src/lib/harness/context.ts`, `src/renderer/src/lib/harness/tools.ts`, `src/renderer/src/lib/harness/harness.svelte.ts`, `src/renderer/src/lib/harness/skills.ts`; context and policy tests.

- Construct a concise “Available tools” section from the tools remaining **after** `allowedTools()` filters by skill and after optional web tools are resolved. Do not advertise tools unavailable to this provider/chat/skill, and do not duplicate full JSON schemas in the prompt (the provider already receives them).
- Explain each enabled operation in plain terms: discover (`list_notes`, `search_notes`), read (`read_note`), write/edit/delete notes, discover/read/create/edit/delete maps, ask the user, and use web tools where enabled. Introduce map operations in this section only when Stage 5 implements them.
- State the workflow and boundaries: search returns eligible matches, not unrestricted full contents; read a note before editing it; the open/current note and explicitly mentioned/attached notes are readable; without **Read all notes**, other notes cannot be read and the agent should ask the user to mention them or enable that setting. Existing locked/encrypted and local-only protections still apply. Reading a map does not grant permission to read its linked notes. Every AI change waits for approval; deletion needs a destructive confirmation.
- Match enforcement to the wording: check the effective allowlist for every read operation, including searches and map-linked-note traversal. Avoid promising that merely knowing a file path grants access. Keep tool descriptions and system guidance aligned.
- Update built-in skill allowlists deliberately as tools are added. Existing user-created skills with explicit allowlists must not silently acquire deletion or map-write powers. Keep the tool registry extensible for future tools.
- Test prompt/tool parity under default, restricted-skill, Read all notes, and optional-web configurations; test denied reads and map-linked-note access.

**Acceptance:** The agent knows the tools it actually has, what they do, and why a read or write may be rejected; future tools can be added without an outdated second list.

## Stage 4B — AI note edits and deletion

**Files:** `src/renderer/src/lib/harness/tools.ts`, `src/renderer/src/lib/harness/harness.svelte.ts`, `src/renderer/src/lib/harness/apply.ts`, `src/renderer/src/lib/components/harness/HarnessPane.svelte`, `src/renderer/src/lib/harness/skills.ts`; harness edit/policy tests.

- Keep the existing `write_note` diff-and-approval behavior. Add a targeted `edit_note` operation for a precise change without replacing the entire note; validate the target and recheck current contents before applying so an approval cannot overwrite a newer edit. Use the live editor path where appropriate to preserve undo/save behavior.
- Add `delete_note` as an explicit tool. Display the note identity and a destructive confirmation popup; on approval use the app’s existing soft-delete/trash operation, not permanent deletion. Respect locked/encrypted and privacy restrictions; reject a stale or missing target.
- Make rejection, Stop, and failures produce accurate tool results and transcript rows. Test approve/reject/stop, changed targets, privacy, and restore-from-trash behavior.

**Acceptance:** AI can propose precise note changes and safe deletion, but cannot silently perform either.

## Stage 5 — AI map and linked-note tools

**Files:** `src/renderer/src/lib/harness/tools.ts`, `src/renderer/src/lib/harness/harness.svelte.ts`, `src/renderer/src/lib/harness/context.ts`, `src/renderer/src/lib/harness/skills.ts`, `src/renderer/src/lib/components/harness/HarnessPane.svelte`, `src/renderer/src/lib/maps/files.ts`, `src/renderer/src/lib/maps/canvas.ts`, `src/renderer/src/lib/components/maps/MapCanvas.svelte`; `src/renderer/src/lib/harness/policy.test.ts` and `src/renderer/src/lib/maps/canvas.test.ts`.

- Add `list_maps` and `read_map` with a compact, structured view of nodes, edges, note IDs, and labels. Respect the mind-map feature setting and map-name/path validation; do not expose arbitrary `.fr5a/` files through these tools.
- Add `create_map`, `edit_map`, and `delete_map` (the edit operation covers node and connection changes). Validate JSON Canvas changes using the existing parser/serializer, preserve unknown fields, and show a readable before/after summary or diff for approval. Require an additional destructive confirmation for deletion.
- Coordinate AI writes with pending editor saves and the map’s changed-on-disk guard. Recheck the source map immediately before applying an approved change; reject or ask to resolve a concurrent edit instead of overwriting it.
- Allow the agent to identify notes linked from map nodes by permitted metadata. `read_note` and note edits still enforce their own chat-level access and privacy gates: a link on a readable map is **not** a new permission. Validate note IDs before creating or relinking file nodes; handle missing notes gracefully.
- Update the dynamic available-tools prompt and built-in skill allowlists to reflect only the new operations each skill may use. Test malformed canvases, missing links, unauthorized note reads, approval/rejection, stale maps, and serialization round trips.

**Acceptance:** AI can understand and propose changes to maps and their links without bypassing note privacy or overwriting user work.

## Verification and release order

After each stage, run `npm run check`, `npm test`, and focused manual desktop/phone checks. Run `npm run test:e2e` before completing the roadmap. Each stage should remain independently reviewable and shippable. Finish Stage 3 before Stage 5 so map editing has reliable persistence/sync beneath it.

## Implementation record

Independent reviews and remaining manual checks are recorded in `docs/bugfix-reviews/`.

| Stage | Status | Review | Summary |
| --- | --- | --- | --- |
| 1 | Implemented, review passed | 94/100 | Nested numbering and tag-list navigation, with regression tests and responsive navigation coverage. |
| 2 | Implemented, review passed | 94/100 | Theme-aware map color swatches and consistent reopen/Back/Close behavior. |
| 3 | Implemented, review passed | 92/100 | Synced hidden app data and conflict-aware live map refresh; save/navigation races repaired. |
| 4A | Implemented, review passed | 97/100 | Dynamic effective-tool guidance and note-read privacy enforcement. |
| 4B | Implemented, review passed | 92/100 | Approved precise note edits and separately confirmed, restorable note deletion. |
| 5 | Implemented; review pending | — | AI map tools with approvals, stale-write guards, validation, and linked-note privacy. |

Automated `npm run check` and `npm test` passed after each implementation. The full `npm run test:e2e` run had 279 passes, 47 intentional skips, and one image-drag failure on tablet landscape; that single test passed when rerun alone. Manual checks on actual desktop and phone devices, including two-device sync, remain outstanding.
