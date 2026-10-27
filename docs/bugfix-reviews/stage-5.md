# Stage 5 review — AI map and linked-note tools

- **Reviewed:** 2026-10-27, working tree on `main` (Stages 1–4B and Stage 5 are uncommitted in the same tree)
- **Scope:** roadmap Stage 5 — `list_maps`/`read_map`, `create_map`/`edit_map`/`delete_map`, JSON Canvas validation and approval, stale/pending-save coordination, linked-note privacy, feature gates, and the dynamic tool/skill surface
- **Verdict:** **FAIL** — score **88/100** (threshold ≥ 90)
- **Mode:** read-only review. No implementation, roadmap, or other review file changed. Only this file was written. No repository temp files were created; no Playwright run was made.

The core of Stage 5 is in place and mostly well built: the five map tools are generated from the live registry, names are fenced to `.fr5a/maps/*.canvas`, `mapPatch` uses the real parser/serializer and preserves unknown fields, approval is always required, map deletion has a second destructive dialog, and the write path flushes pending map saves and compares the map text immediately before applying. The two reasons this is not yet a pass are a **linked-note metadata disclosure that is not gated by the chat allowlist** and **the explicitly requested approval/rejection and stale-map tests are absent at the harness level** (and no e2e/manual run covers the five tools). One correctness bug also reports an intact link to an encrypted note as missing, and the map approval card still exposes raw canvas JSON and internal mode tokens.

---

## Score breakdown

| Area | Result | Points |
| --- | --- | --- |
| `list_maps`/`read_map`: structure, path validation, feature gate | Compact node/edge/note-id view, `mapPath()` stops traversal and arbitrary `.fr5a` reads; linked-note metadata is not filtered by the chat allowlist and encrypted links are reported missing | 17 / 20 |
| `create_map`/`edit_map`/`delete_map`, JSON Canvas validation, approval | Parser/serializer validation, unknown-field preservation, no-op rejection, approval and second delete confirmation present; approval shows raw JSON and internal mode tokens, and a case-only name mismatch can fail edits | 20 / 25 |
| Pending saves, changed-on-disk recheck, Stop | Flush + `saved()`, string recheck before write and after the delete dialog; a guard-to-write race and the inherited Stop re-arm remain | 18 / 20 |
| Linked-note privacy and note-id validation | Contents are correctly not reachable from a map; metadata over-disclosure and no test that an unmentioned note's title stays out | 10 / 15 |
| Dynamic tools/skills/context | Registry-driven “Available tools”, map paragraph, no map writes in built-ins, explicit user allowlists respected | 11 / 12 |
| Tests and verification | Map patch/files/policy tests are good; no harness approval/rejection/stale tests, no disabled-gate test, no e2e/manual map run; one Stage 5 lint error | 12 / 13 |
| **Total** | | **88 / 100** |

---

## Verification performed

```text
npm run check
→ svelte-check found 0 errors and 0 warnings

npx vitest run src/renderer/src/lib/harness src/renderer/src/lib/maps
→ 21 test files passed, 157 tests passed

npm test
→ 57 test files passed, 474 tests passed

npx eslint src/renderer/src/lib/harness src/renderer/src/lib/maps \
  src/renderer/src/lib/components/maps
→ 3 errors:
  apply.ts:29 (4B, unused `id`)
  harness.svelte.ts:858 (4A, mutable Set)
  harness.svelte.ts:905 (Stage 5, mutable `new Set` for map metadata)

npx prettier --check (all Stage 5 touched files)
→ all matched files use Prettier code style
```

No desktop/phone run, no live provider run, and no `test:e2e` run were performed; the findings below are code-path verifications. The full suite was green at 05:46 against the moving tree.

---

## What is implemented well

### 1. The map surface is registry-driven and path-safe

`tools.ts:280-361` adds the five tools only when the harness supplies `maps`, and `harness.svelte.ts:889-921` supplies them only while `settings.mindMaps` is on. Every operation goes through `checked()` (`tools.ts:282-288`), which calls `validMapName()` (`mapTools.ts:13-17`) → `mapPath()`. `mapPath` rejects empty, trimmed-different, leading-dot, `all`, separator, control-character and drive-like names (`canvas.ts:15-26`), so `../notes/x`, `dir/name`, `.fr5a/...` and `.hidden` cannot become meta-file paths. `listMaps()` re-validates every directory entry (`files.ts:17-28`). `files.test.ts:58-64` covers the traversal cases.

### 2. `edit_map` validates real canvas structure and preserves unknown fields

`mapPatch` (`mapTools.ts:42-108`) requires only `nodes`/`edges`/`removeNodes`/`removeEdges`, rejects duplicate and empty ids, forbids update-and-remove of one id, forbids removing ids that are not on the map, and merges entries by id so unspecified node/edge fields survive (`:63-86`). It re-parses the proposed document with the app parser and rejects any skipped node/edge, which also catches dangling edge endpoints (`:92-98`). Only file nodes are link-checked (`:99-106`), and only against existing note ids. `mapTools.test.ts:17-30` proves top-level `custom`, node `custom` and edge `extra` round-trip, and `:31-44` covers a missing link, a dangling edge, duplicate ids, an unknown patch key, invalid names and a blank map.

### 3. Every map write is reviewed; deletion needs a second, destructive step

`reviewMap` (`harness.svelte.ts:1095-1172`) never writes directly. It prepares a before/after, builds an `Approval` with a compact diff and added/removed counts (`:1186-1193`), and `apply()` re-checks `settings.mindMaps`, runs `guardMapWrite(name)`, re-reads the map and rejects when the text differs from the reviewed `before` (`:1128-1138`). `create_map` additionally re-checks the name against `listMaps()` before writing (`:1132-1136`). `delete_map` awaits the normal approval card first, then `app.confirm({ danger: true, confirm: 'Delete map' })` with the map name and a “linked notes remain” line (`:1140-1166`), and re-reads once more after confirmation. The approval button says “Continue to confirmation” for `delete-map` (`HarnessPane.svelte:990-993`).

### 4. Pending map saves and open editors are respected

`guardMapWrite` (`files.ts:44-51`) asks the registered canvas guard whether the map is safe to touch (refusing while a field/drag/selection interaction is active and flushing a dirty canvas), waits for the latest tracked save (`saved()`), and refuses if the last save failed. `files.test.ts:39-57` proves a queued save is awaited and an active editor blocks the write; `:66-79` proves a closed canvas's in-flight save is still awaited. `MapCanvas.svelte:204-208` returns false for a non-ready, dirty, editing or interacting canvas. After an AI apply, `app.mapSyncVersion++` (`harness.svelte.ts:1167`) makes the open canvas and the chooser re-read (`MapCanvas.svelte:350-352`, `MapChooser.svelte:26`), and `MapCanvas`'s refresh path already refuses to replace dirty local work (`MapCanvas.svelte:289-349`).

### 5. The prompt and skill filtering follow the live tool set

`availableTools()` (`context.ts:63-66`) is fed the same filtered array the loop receives (`harness.svelte.ts:862-925`, `:926-935`), so map tools appear with their real descriptions only when enabled and allowed by the skill. The map boundary paragraph (`context.ts:96-99`) says a link reveals only metadata, that a map must be read before editing, that every change needs approval, and that map deletion needs a separate destructive confirmation. `skills.ts:116-126` adds only `list_maps`/`read_map` to `clarify`; no built-in skill gets map writes. User skills with explicit allowlists are still filtered by `allowedTools` (`skills.ts:110-114`), and `policy.test.ts:236-260` proves a `summarize` run gets neither map tools nor map prompt lines.

### 6. Linked notes do not grant content access

`read_map` returns note ids/titles/metadata (`mapTools.ts:110-147`), while `read_note`, `edit_note` and `delete_note` still call the chat allowlist (`tools.ts:95-110`, `:124-135`, `:245-254`, `:271-275`). `policy.test.ts:278-300` uses a real parsed canvas file node and proves the linked id is not added to `allowedNoteIds`, so `read_note`/`write_note`/`search_notes` reject it. This is the roadmap's central privacy rule and it holds for note contents.

---

## Findings

### 1. `read_map` sends linked-note titles outside the chat's read allowlist (Medium, privacy)

**Where:** `mapTools.ts:124-132` (`noteTitle`), `harness.svelte.ts:901-915` (`metadataIds`); the only allowlist is the content path at `tools.ts:95-110`.

The harness builds `metadataIds` from **every** `run.notes` entry that is not locked/encrypted/hidden from cloud AI. It does not consult `tab.readAll` or `allowedNoteIds`. `mapSummary` then returns `noteTitle` for any id in that set and `noteId` for every file node. Concretely: with **Read all notes off** and only one note attached, `list_notes`/`search_notes` return nothing for an unrelated `ideas/launch.md`, but asking the agent to read a map that contains that node returns:

```json
{"id":"n1","type":"file","noteId":"ideas/launch.md","noteTitle":"Launch plan"}
```

The roadmap's Stage 4A rule says to “check the effective allowlist for every read operation, including searches and map-linked-note traversal”, and Stage 5 permits “permitted metadata”. Titles of notes this chat was never allowed to discover are not obviously permitted metadata. The same result discloses the path of a **local-only** note to a cloud provider (the title is nulled at `:127-130`, but `noteId` is not), which is the kind of metadata the app otherwise hides from cloud AI. The code deliberately includes note IDs (`tools.ts:302`), so the right fix is to gate the **title lookup** on `allowedNoteIds` (and keep the id only as an opaque link token, or omit it for hidden/encrypted notes), not to remove ids wholesale.

**Test/manual:** a harness-level test with `readAll: false`, one unrelated note in `notes()`, and a map containing it; assert `read_map` does not return its title. Manual: cloud provider, empty chat, read a map with a note in a local-only folder; the tool result must not expose the title (and ideally not the path).

### 2. An intact link to an encrypted note is reported as `"missing": true` (Medium, correctness)

**Where:** `harness.svelte.ts:904` passes `run.notes` (= `app.aiNotes`), `app.svelte.ts:414-415` excludes encrypted notes unless `aiReadsEncrypted`; `mapTools.ts:131` derives `missing` from that same list.

With encryption enabled and `aiReadsEncrypted` off (the safe default), `aiNotes` excludes the note, so `byId.has(file)` is false for a perfectly valid file node. `edit_map` meanwhile validates against `app.notes` (`harness.svelte.ts:1121`, `:1138`), which still contains the encrypted note, so the same link is accepted as existing. The agent can read a map, see `"missing": true` for an encrypted note, and propose “fixing” a link that is not broken (or removing the node). The app's own `NoteNode` shows the encrypted note as present (`MapCanvas.svelte:595`, `NoteNode.svelte:14-18`). This is a false negative rather than a content leak, but it makes the map view unreliable exactly where privacy matters.

**Fix:** build the summary from the full index for existence, and pass a separate eligible-metadata set for titles (also covering finding 1), or add `encrypted: true` / `accessible: false` rather than `missing`.

**Test/manual:** unlock the vault, mark a note encrypted, keep `aiReadsEncrypted` off, put it on a map, call `read_map`; expect the node not to be “missing”.

### 3. Map approval/rejection and stale-map paths have no harness-level test (Medium, required coverage)

**Where:** `harness.svelte.ts:1095-1213`; `policy.test.ts:211-261`; `noteTools.test.ts`; no AI map-tool case in `e2e/maps.spec.ts` or `e2e/aiNoteChanges.spec.ts`.

The roadmap explicitly requires testing “approval/rejection, stale maps” for this stage. Today the unit tests cover `mapPatch` (`mapTools.test.ts`), the guard (`files.test.ts`), and the tool/prompt surface (`policy.test.ts`), but **nothing** executes `reviewMap`/`reviewChange` for a map:

- no test asserts that an `edit_map` approval card is built, that Reject writes nothing and marks the row `rejected`;
- no test asserts that a map changed on disk between prepare and apply returns “The map changed since review” and leaves the disk untouched;
- no test asserts that `delete_map` requires the second confirmation, or that Cancel keeps the map;
- no test asserts the map tools are absent when `settings.mindMaps` is off (the test name at `policy.test.ts:211` over-claims: it only supplies `maps` and checks a skill's filtering);
- no e2e/manual run exercises any of the five tools end to end.

These are the safety-critical paths the stage exists to add. The absence of a regression test for the stale recheck is the most important gap, because that check is the only thing standing between an approved card and overwriting a synced edit.

**Fix:** a small harness test with a fake tab/session, deferred `confirm`, and a mocked `files` module (or injected map deps) covering approve, reject, stale, disabled, and delete-confirm-cancel; plus one Playwright case that approves an `edit_map` and asserts the saved canvas changed only after the click. Add a test that `toolsForRun` has no `*_map` entry when `mindMaps` is false.

### 4. Stop can re-arm a map approval card, and the late apply has no abort signal (Medium)

**Where:** `harness.svelte.ts:1174-1213`, `:220-227` (`stop`), and the deferred `prepare()` in `reviewMap` (`:1104-1123`, which awaits `guardMapWrite`, `listMaps`, `readMap`).

This is the Stage 4B issue carried into the new map path. `abortable(tool.run(...), signal)` rejects on Stop, but the tool body keeps running. If Stop lands while `reviewMap` is waiting on a map read/list, the run unwinds and `tab.ctl` becomes null; when `prepare()` resolves, `reviewChange` still sets `row.write` and calls `tab.confirm(approval)`, re-arming a “Review change” card **after** “Stopped.”. If the user then presses Apply, `prepared.apply(tab.ctl?.signal)` receives `undefined`, so the abort check at `:1205` passes and a `create_map`/`edit_map`/`delete_map` can proceed with no signal. For map deletion the second destructive dialog still stands, so nothing destructive is silent; for create/edit the map can be written after the run was stopped. This is a correctness/transcript issue, not an approval bypass (the user still clicks), but it undermines Stop.

**Fix:** pass the run's local `signal` into `reviewChange` and check it before and after `card.confirm` and before `prepared.apply`; ignore a late `prepare()` when the run was aborted (the same `runAborted` flag suggested in the 4B review).

**Test/manual:** stop while a map tool is starting; no approval card should appear afterward, and no map write should occur.

### 5. The approval card shows raw canvas JSON and internal mode tokens (Low, requirement is a “readable” summary)

**Where:** `harness.svelte.ts:1124-1127`, `:1186-1193`; `HarnessPane.svelte:982`.

The roadmap asks for a “readable before/after summary or diff”. The card does have a real diff with `+`/`−` counts, and for a one-node/one-edge change the raw lines are followable. But it renders tab-indented canvas JSON with `edit-map`, `create-map` or `delete-map` as the mode, e.g. `edit-map → mind map “Atlas”`. `create_map` shows the entire blank file as added, and a label/colour change shows canvas property names rather than “Node ‘Design’ moved” or “Edge A–B relabelled”. A user can approve it, but it is the least readable approval in the app. Note diffs already have a human label; maps should too.

**Fix:** render mode labels (“Create map”, “Edit map”, “Delete map”), and add a short structured summary of the patch (node labels/ids added, updated and removed; edges added/removed) above or instead of the raw JSON. Keep the raw diff available in the expandable tool row (`ToolRow.svelte:99-103`).

### 6. Map tool failures and names are misreported in the transcript (Low)

**Where:** `ToolRow.svelte:11-21` (no map labels), `:57-63` (failure prefixes).

`Map operation failed: Invalid map name` (from `tools.ts:286`) and `No map called “x”.` (`harness.svelte.ts:899-900`) do not match the fixed `failed` prefixes (`Error:`, `Not written`, `Not applied`, …). A failed `read_map` or an invalid `create_map`/`delete_map` name therefore renders with a green check and `ok` in the transcript, while the result text says it failed. The map tools also fall back to the raw names (`read_map`, `edit_map`) instead of `Read map` / `Edit map`, and an invalid-name call has no `entry.write`, so the row gives no clue that it failed. This is the same transcript-accuracy class as Stage 4B finding 5, now on the map side.

**Fix:** add map labels to `LABEL`, treat `Map operation failed` and `No map called` as failures (or have the tools throw instead of returning those strings), and show `name` as the row summary.

### 7. A case-only map-name mismatch finds a map but then reads a different path (Low)

**Where:** `harness.svelte.ts:1107-1113`, `:1166`.

`reviewMap` resolves `existing` with `toLowerCase()`, so `edit_map("atlas")` sees `Atlas` as existing on a case-sensitive filesystem, but then calls `readMap(name)` / `writeMap(name, …)` with the request's casing. `readMap("atlas")` is null, so the call returns “No map called ‘atlas’” even though the map exists; `create_map("atlas")` is rejected as a duplicate. `forgotMindMap` is also case-sensitive (`app.svelte.ts:1073-1078`). The result is safe (nothing is written), but confusing for an agent that got the name from `list_maps` with different casing than it echoes. Use the resolved `existing` name for read/write and for `forgotMindMap`.

### 8. A recorded save failure keeps blocking AI map writes (Low)

**Where:** `files.ts:44-51`, `:53-59`.

`guardMapWrite` throws whenever `failures` has an entry for the map. `recordMapSaveFailure` is only cleared by a successful canvas write or `saveRecovery`; closing the canvas leaves the entry in the module-level map. A one-off “disk full” or permission failure therefore makes every later `read_map`/`edit_map` fail with “The map could not be saved” until the user reopens the map and performs a successful save. Erring safe is good, but the message and the permanent block are not obvious, and `read_map` is blocked by a *write* failure. Clear the failure when the map is closed successfully, or restrict the failure check to write paths and offer a “retry save” hint.

### 9. `fr5a` extras can be dropped by a non-object patch (Low, unknown-field promise)

**Where:** `mapTools.ts:69-82`; `canvas.ts:157`.

`mapPatch` merges prior/incoming `fr5a` only when the incoming value is a non-array object. If the agent sends `fr5a: null` (or a string) for an existing node, the spread replaces the prior `fr5a` with the invalid value and `parseCanvas` then deletes it, so the node's tag/from/exclude extras are lost even though the tool description says existing unknown fields remain. A structured patch schema that requires `fr5a` to be an object, or an explicit merge that keeps the prior `fr5a` on a non-object input, would close it. (The approval diff does show the removal, so this is not silent.)

### 10. One Stage 5 lint error and no disabled-gate test (Low)

`npx eslint` reports `harness.svelte.ts:905` (`new Set` for `metadataIds`) under `svelte/prefer-svelte-reactivity`; the two other errors are inherited (`apply.ts:29`, `harness.svelte.ts:858`). `npm run check` and the full unit suite pass, and formatting is clean. Also, the only map test that mentions the feature setting (`policy.test.ts:211`) does not create a run with `mindMaps: false`; the gate lives only in `harness.svelte.ts:889`, so a future refactor can silently expose map tools with no test.

---

## Acceptance checklist

| Requirement | Result |
| --- | --- |
| `list_maps` and `read_map` expose a compact structured view of nodes, edges, note IDs and labels | Pass (`mapTools.ts:110-147`), with metadata-scope issue finding 1 and encrypted-missing finding 2 |
| Respect the mind-map setting | Pass in code (`harness.svelte.ts:889-921`, per-call checks); no test for the off state |
| Map-name/path validation; no arbitrary `.fr5a` files | Pass: `validMapName`/`mapPath` and `listMaps` filtering; traversal tested |
| `create_map`, `edit_map`, `delete_map`; edit covers nodes and connections | Pass |
| Validate JSON Canvas via the existing parser/serializer | Pass (`mapTools.ts:92-107`); malformed maps are refused for edits (`harness.svelte.ts:1116-1120`) |
| Preserve unknown fields | Pass for top-level/node/edge fields and round-trip test; `fr5a` non-object edge case finding 9 |
| Readable before/after summary or diff | Partial: real diff, but raw JSON and internal mode token (finding 5) |
| Additional destructive confirmation for deletion | Pass (`harness.svelte.ts:1140-1166`; “Continue to confirmation”) |
| Coordinate with pending saves and changed-on-disk guard | Pass: `guardMapWrite`, string recheck before write and after the delete dialog; residual Stop/guard windows (finding 4) |
| Recheck immediately before applying; reject concurrent edits | Pass for create/edit/delete; no harness regression test (finding 3) |
| Agent can identify linked notes by permitted metadata | Partial: ids always, titles regardless of the chat allowlist; local-only paths exposed (finding 1) |
| `read_note` / note edits keep chat access and privacy gates | Pass: `policy.test.ts:278-300`; no content leak through a map |
| Validate note IDs when creating/relinking file nodes; handle missing notes | Pass for edit (`mapTools.ts:99-106`, `harness.svelte.ts:1121`); read misreports encrypted links (finding 2) |
| Update dynamic prompt and built-in allowlists | Pass: `context.ts:96-106`, `skills.ts:116-126`; no built-in map writes |
| Tests: malformed, missing links, unauthorized reads, approval/rejection, stale, round trips | Partial: malformed, missing links, unauthorized reads and round trips covered; approval/rejection and stale maps are not (finding 3); no e2e |

---

## Remaining manual checks

1. **Desktop, approve/reject:** create and edit a map through the assistant; reject the card, confirm nothing changed, then approve and confirm only the reviewed nodes/edges changed. Check the open canvas reloads and the chooser updates.
2. **Desktop, stale:** read a map, change the same node in the map editor (or another window) while the approval card is open, then approve; expect “Not applied: The map changed since review; nothing applied. Read it again.” and the user's version intact.
3. **Desktop, delete:** approve `delete_map`, verify the first card says “Continue to confirmation”, Cancel/Stop leaves the map, and the second red dialog names the map; confirm, then verify the `.canvas` is gone and the linked notes remain.
4. **Phone:** run the same create/edit/delete flow from the AI sheet; check the approval card fits, the destructive dialog is reachable, and Back/Escape do not leave a pending approval card behind.
5. **Stop:** press Stop while a map tool is preparing (slow disk/sync); no approval card should appear after “Stopped.”, and no map should be written (finding 4).
6. **Open/dirty map:** with unsaved node edits, ask the assistant to edit that map; expect a refusal (“unsaved or active editor changes”) rather than a flush-and-overwrite. With a clean open map, approve and confirm the canvas reloads without losing selection/viewport.
7. **Privacy:** cloud provider, Read all off, no attachments; ask it to read a map containing a note in a local-only folder and an encrypted note. Confirm it cannot read the note contents, that the local-only title is null (and check whether the path is exposed, finding 1), and that the encrypted node is not labeled “missing” (finding 2).
8. **Feature gate:** turn Mind maps off (with linked notes still on) while the AI pane is open; the five map tools must disappear from the next run and any pending map approval must refuse to apply.
9. **Name validation:** ask the agent to read/edit/delete `../notes/x`, `.hidden`, `all`, `dir/name` and a 200-character name; expect “Invalid map name”/“Map operation failed” with a failed row, no file access.
10. **Unknown fields:** hand-edit a `.canvas` with extra top-level, node and edge fields, approve a one-field AI edit, and diff the file; extras must survive. Repeat with `fr5a: null` to confirm finding 9.

---

## Recommendation

**Do not pass Stage 5 yet.** The implementation is close: the tool surface, path safety, canvas validation, approval, destructive confirmation and pending-save coordination are all present. Before calling it done:

1. Gate linked-note **titles** (and decide about ids of local-only/encrypted notes) by the chat's effective allowlist, and stop reporting intact encrypted links as missing (findings 1–2).
2. Add the missing harness tests for approve/reject, stale maps, delete confirmation, and the disabled feature gate (finding 3).
3. Fix the Stop re-arm so a stopped run cannot re-open a map approval card, and make map failures readable in the transcript (findings 4, 6).
4. Replace the raw `edit-map`/JSON approval presentation with a readable map summary and user-facing mode labels (finding 5).

The remaining findings (case-only names, persistent save-failure block, `fr5a: null`, lint) are quick cleanups and can follow.
