# Stage 5 review — AI map and linked-note tools

- **Reviewed:** 2026-10-27, third independent pass over the current working tree (Stage 5 is still uncommitted, together with earlier stages)
- **Scope:** roadmap Stage 5 — `list_maps`/`read_map`, `create_map`/`edit_map`/`delete_map`, JSON Canvas validation and approval, pending-save/stale-write coordination, linked-note privacy, feature gates, and the dynamic tool/skill/context surface; this pass re-checked the three narrow follow-up fixes only
- **Verdict:** **PASS — 97/100** (threshold ≥ 90)
- **Mode:** read-only review. No implementation, roadmap, or other review file changed. Only this file was written. No repository temp files were created and no Playwright/e2e run was made.

This pass supersedes the 93/100 second pass, which superseded the earlier 88/100 review. The history stands as 88 → 93 → 97. The earlier blockers remain fixed: linked-note titles are gated by the chat allowlist, local-only paths are omitted, intact encrypted links are not reported as missing, Stop is carried through the approval flow, map approval cards have readable change summaries, map rows have proper labels/failure prefixes, case-only map names resolve to the file on disk, `fr5a: null` no longer erases node extras, the Stage 5 lint error is gone, and a failed map save no longer blocks `read_map`.

This pass verified that the three narrow follow-up fixes are real, correctly placed, and covered by tests:

1. **Delete-then-Stop is closed.** `mapReview.ts:87-89` now throws `AbortError` after the second guard and after the final disk read, immediately before `deps.remove(target)`, with no `await` between that check and the delete. `mapReview.test.ts:140-186` gates both the final guard and the final read, aborts, releases the gate, and asserts no `remove`/`write` and the map still on disk.
2. **An invalid `fr5a.exclude` no longer erases prior exclusions.** `mapPatch` (`mapTools.ts:83-109`) merges `fr5a` explicitly, keeps prior valid extras when the incoming value is not an object, and when `exclude` is present but not a string list it restores the prior valid list (or drops the key) instead of letting `parseCanvas` repair it to `[]`. `mapTools.test.ts:79-108` covers a string, a mixed array, a valid replacement list, a merge with prior `tag`/`from`, and a serialize→parse round trip.
3. **`read_map` resolves case-only names and reports a disabled read as a failure.** `harness.svelte.ts:895-915` resolves through `findMapName(await listMaps(), name)` (the same helper `prepareMapReview` uses), guards and reads the on-disk name, and returns `Map operation failed: Mind maps are disabled.` when the feature is off — a prefix `ToolRow.svelte:63` marks failed.

The remaining issues are three narrow items: the one-shot editor guard (the roadmap's active-editor vs AI-write window), the encrypted-path metadata policy, and stale save-failure bookkeeping, plus the still-missing harness-level/e2e coverage. There is no remaining approval bypass, no Stop window that writes or deletes a map, no silent loss of tag exclusions from an AI patch, and no note-content disclosure through map tools.

---

## Score breakdown

| Area                                                                   | Result                                                                                                                                                                                                                                                                                                                                                                            | Points       |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `list_maps`/`read_map`: structure, path validation, feature gate       | Compact node/edge/note-id view; `mapPath()` still fences names to `.fr5a/maps/*.canvas`; titles are chat-gated, local-only paths omitted, case-only names resolved through `findMapName`, and a disabled read returns a failed-prefixed result. Residual: encrypted paths remain visible                                                                                          | 19 / 20      |
| `create_map`/`edit_map`/`delete_map`, JSON Canvas validation, approval | Parser/serializer validation, unknown-field preservation, no-op rejection, approval and second delete confirmation; readable map summary and mode labels; an invalid `fr5a.exclude` now keeps the reviewed exclusions and round-trips. Residual: no integrated harness approval test                                                                                              | 23 / 25      |
| Pending saves, changed-on-disk recheck, Stop                           | Flush + `saved()`, disk-text recheck before write and after the delete dialog, Stop checked around prepare/confirm/apply, and now checked again after the final delete guard and read (unit-tested both ways). Residual: the one-shot editor guard is still not rechecked/held across the final read→write span, and `prepare` guards the requested rather than the resolved name | 18 / 20      |
| Linked-note privacy and note-id validation                             | Contents are correctly not reachable from a map; titles are allowlist-gated; local-only ids/titles are withheld; encrypted links are found and marked `accessible:false`. Residual: encrypted note paths and the `encrypted` flag still reach a cloud provider when encrypted reads are off                                                                                       | 14 / 15      |
| Dynamic tools/skills/context                                           | Registry-driven “Available tools”, map paragraph, no map writes in built-in skills, explicit user allowlists respected                                                                                                                                                                                                                                                            | 12 / 12      |
| Tests and verification                                                 | Unit tests now cover prepare/reject/approve/stale/delete/disable, Stop re-arm, Stop during the final delete guard and final delete read, and `fr5a`/`exclude` round trips; full suite and checks pass. Still no harness-level integration test for `reviewMap`, no feature-off harness test, no disabled-read row test, and no e2e/manual map-tool run                            | 11 / 13      |
| **Total**                                                              |                                                                                                                                                                                                                                                                                                                                                                                   | **97 / 100** |

---

## Verification performed

```text
npm run check
→ svelte-check found 0 errors and 0 warnings

npx vitest run src/renderer/src/lib/harness src/renderer/src/lib/maps
→ 23 test files passed, 177 tests passed

npm test
→ 59 test files passed, 494 tests passed

npx eslint src/renderer/src/lib/harness src/renderer/src/lib/maps \
  src/renderer/src/lib/components/harness src/renderer/src/lib/components/maps
→ clean

npx prettier --check (all Stage 5 touched files, including mapReview/approval)
→ all matched files use Prettier code style
```

No desktop/phone run, no live provider run, and no `npm run test:e2e` run were performed. The findings below are code-path verifications and unit-test runs against the current tree. This pass specifically re-read `mapReview.ts`, `mapTools.ts`, the `read_map` wiring in `harness.svelte.ts`, `files.ts`, and the matching test files (`mapReview.test.ts`, `mapTools.test.ts`, `files.test.ts`).

---

## What is implemented well

### 1. The map surface is registry-driven and path-safe

`tools.ts:280-361` adds the five tools only when the harness supplies `maps`, and `harness.svelte.ts:889-920` supplies them only while `settings.mindMaps` is on. Every named operation goes through `checked()` (`tools.ts:282-288`), which calls `validMapName()` (`mapTools.ts:22-25`) → `mapPath()`. `mapPath` rejects empty, trimmed-different, leading-dot, `all`, separator, control-character and drive-like names (`canvas.ts:15-26`), so `../notes/x`, `dir/name`, `.fr5a/...` and `.hidden` cannot become meta-file paths. `listMaps()` re-validates every directory entry (`files.ts:17-28`), and `files.test.ts:59-64` covers the traversal cases.

### 2. `edit_map` validates real canvas structure and preserves unknown fields

`mapPatch` (`mapTools.ts:53-136`) requires only `nodes`/`edges`/`removeNodes`/`removeEdges`, rejects duplicate and empty ids, forbids update-and-remove of one id, forbids removing ids that are not on the map, and merges entries by id so unspecified node/edge fields survive. Its explicit `fr5a` merge (`:83-109`) preserves prior extras when the incoming value is null or not an object, and keeps a valid prior `exclude` when the incoming one is malformed, so the parser can no longer normalize real exclusions to `[]`. It re-parses the proposed document with the app parser and rejects any skipped node/edge, which also catches dangling edge endpoints. Only file nodes are link-checked, and only against existing note ids. `mapTools.test.ts:30-43` proves top-level `custom`, node `custom` and edge `extra` round-trip. `mapTools.test.ts:44-48` covers the `fr5a: null` regression, `:49-77` the invalid-`fr5a` merge and round trip, `:79-108` the invalid/valid `exclude` cases, and `:110-121` malformed changes, unknown keys, missing links, invalid names and a blank map.

### 3. Every map write is reviewed; deletion needs a second, destructive step

`reviewProposal` (`approval.ts:42-89`) never writes directly. `prepareMapReview` (`mapReview.ts:33-96`) prepares a before/after, resolves the case-correct map name, builds a compact diff plus readable `summary` lines, and `apply()` re-checks `settings.mindMaps`, runs `guardMapWrite`, re-reads the map and rejects when the text differs from the reviewed `before`. `create_map` additionally re-checks the name against `listMaps()` before writing. `delete_map` awaits the normal approval card first, then `app.confirm({ danger: true, confirm: 'Delete map' })` with the map name and a “linked notes remain” line, re-reads once more after confirmation, and checks Stop immediately before `remove()` (`:87-89`); a stopped run can now only keep the map. The approval button says “Continue to confirmation” for `delete-map` (`HarnessPane.svelte:1012-1014`), the mode is rendered as “Delete map”, and the card shows the readable summary rather than raw JSON (`HarnessPane.svelte:52-61`, `:995-1006`).

### 4. Pending map saves and open editors are respected in the normal path

`guardMapRead` (`files.ts:43-49`) asks the registered canvas guard whether the map is safe to touch (refusing while a field/drag/selection interaction is active and flushing a dirty canvas), then waits for the latest tracked save. `guardMapWrite` adds the save-failure check only for writes. `files.test.ts:40-58` proves a queued save is awaited and an active editor blocks the write; `:67-80` proves a closed canvas's in-flight save is still awaited; `:82-90` proves a past save failure blocks a write but not a read. Reads and writes share the same guard, so `read_map` cannot read past an active editor either. After an AI apply, `app.mapSyncVersion++` (`harness.svelte.ts:1133`) makes the open canvas and the chooser re-read (`MapCanvas.svelte:350-352`), and `MapCanvas`'s refresh path already refuses to replace dirty local work (`MapCanvas.svelte:288-349`).

### 5. The prompt and skill filtering follow the live tool set

`availableTools()` (`context.ts:63-66`) is fed the same filtered array the loop receives (`harness.svelte.ts:857-921`), so map tools appear with their real descriptions only when enabled and allowed by the skill. The map boundary paragraph (`context.ts:96-99`) says a link reveals only metadata, that a map must be read before editing, that every change needs approval, and that map deletion needs a separate destructive confirmation. `skills.ts:116-126` adds only `list_maps`/`read_map` to `clarify`; no built-in skill gets map writes. User-created skills with explicit allowlists are still filtered by `allowedTools` (`skills.ts:110-114`), and `policy.test.ts:211-270` proves a `summarize` run gets neither map tools nor map prompt lines.

### 6. Linked-note privacy is now enforced at the metadata boundary

`mapSummary` (`mapTools.ts:151-197`) takes the full vault index for existence, then applies a separate chat allowlist and provider/hidden predicate. Callers pass `allowedIds: tab.readAll ? null : allowedNoteIds`, `hidden` via `isHidden`/`isLocalOnly`, and `encryptedReadable: app.aiReadsEncrypted` (`harness.svelte.ts:895-915`). Titles are returned only when the note is allowed and not hidden/locked/encrypted-without-permission; local-only ids are omitted entirely; a missing encrypted link is marked `accessible:false`/`encrypted:true` rather than `missing`. `mapTools.test.ts:126-176` covers allowed, hidden, encrypted, unmentioned, missing and hidden-missing links. `policy.test.ts:293-315` proves a real canvas file link does not add its note to the chat read/write allowlist.

---

## Findings

### Resolved since the 93/100 pass

These were findings 1, 4 and 5 of the previous review. Verified fixed in this pass:

1. **Stop during the final delete guard/read** — `mapReview.ts:87-89` checks `signal` after the second guard and after the final read, immediately before `remove()`. `mapReview.test.ts:140-186` covers a stopped final guard and a stopped final read; both assert `AbortError`, the map on disk, and zero `write`/`remove` calls. Stop can no longer delete a map after the destructive confirmation.
2. **Invalid `fr5a.exclude` data loss** — `mapPatch` (`mapTools.ts:83-109`) restores the prior valid exclusion list (or removes the key) when the incoming `exclude` is not a string list, and `mapTools.test.ts:79-108` proves `'done.md'` and `['done.md', 3]` both keep the reviewed exclusions and survive serialize→parse. A deliberate `exclude: []` still clears them.
3. **`read_map` case and disabled presentation** — `harness.svelte.ts:895-915` resolves through `findMapName(await listMaps(), name)`, guards/reads/returns the on-disk name, and returns `Map operation failed: Mind maps are disabled.` for the disabled case; `ToolRow.svelte:63` marks that prefix failed. `mapReview.test.ts:188-191` covers `findMapName`; the harness wrapper itself remains untested (see finding 3).

### 1. The editor guard is one-shot, so a save can land between the guard and the AI write (Medium/Low, lost update)

**Where:** `mapReview.ts:67-91`, `MapCanvas.svelte:204-208`, `:218-233`.

`apply()` runs `guardMapWrite` once, then reads the disk and writes. The guard checks `status`, `editingId` and `interacting`, flushes, and waits for `saved()`, but it is not rechecked immediately before `deps.write`. If the user starts editing after the guard returns, the final disk read cannot see the open editor's unsaved buffer. A debounced save that lands between the read and the write can be overwritten; a save that lands after the AI write is detected by `MapCanvas`'s conflict path, but only after the fact and with an extra prompt.

This is narrow, but it is the exact “active editor vs AI write” window the roadmap asks the stage to close. The conflict dialog in `MapCanvas` reduces silent loss; it does not remove the lost-update window.

A smaller variant of the same guard gap: `prepareMapReview` guards the **requested** name (`mapReview.ts:40`) before it resolves the on-disk casing. With an open dirty `Atlas` and an agent call for `edit_map("atlas")`, the prepare-time guard finds no registered editor, so the card is prepared from the last disk text. `apply()` then guards `Atlas`, flushes, and the disk recheck rejects with “The map changed since review” — safe, but the user sees a card that cannot apply. Resolve the name before the first guard.

**Fix:** take a short-lived map write lease (the guard registered by `MapCanvas`) for the whole read→write span, or re-run the editor guard immediately before `writeMap` and compare a canvas version. Refusing with “finish editing and try again” is safer than writing. Move the prepare-time guard after `findMapName`.

**Test/manual:** with a clean open map, start dragging a node immediately after the approval card's Apply click; the AI write must not overwrite the pending user save, or the user must be asked which version to keep. Hard to automate reliably; include in the manual matrix.

### 2. Encrypted paths remain visible to a cloud provider; local-only paths are fixed (Low, privacy)

**Where:** `mapTools.ts:159-175`; call site `harness.svelte.ts:895-915`.

Local-only handling is correct: for a cloud provider, a local-only note (folder or `<!-- ai: local -->`) yields no `noteId`, a null title, and `accessible:false`; even a missing local-only link omits its path. Encrypted links are correctly **not** reported missing, and their title stays hidden while `app.aiReadsEncrypted` is false. However, the encrypted note's `noteId` (its workspace path) and `encrypted:true` are still emitted, while the provider is not allowed to read that note. The map itself contains the path, so this is not a content leak, but paths can be sensitive and the policy should be explicit.

Unmentioned, non-hidden notes also retain their real path as `noteId` with `noteTitle:null`. That is consistent with Stage 5's “note IDs” contract and “a link is not a new permission”, but it is metadata the chat could not discover through `list_notes`/`search_notes`.

**Decision needed:** if encrypted note paths are treated as private, omit `noteId` for encrypted links too (keep the canvas node id as the handle) or return an opaque link token. Otherwise document that paths are permitted map metadata while titles/contents are gated.

**Test/manual:** cloud provider, Read all off, `aiReadsEncrypted` off, a map containing a local-only note and an encrypted note. Confirm no local-only path/title, no encrypted title, and decide whether the encrypted path is acceptable.

### 3. Required end-to-end coverage is still missing (Low, verification)

The unit tests are now strong: `approval.test.ts` covers the late-prepare Stop race, approve-after-Stop, rejection text/summary and signal forwarding; `mapReview.test.ts` covers prepare-without-write, feature-off prepare/apply, stale disk text, case-only names, delete cancel/confirm, create, and Stop during the final delete guard and final delete read; `mapTools.test.ts` covers local-only/encrypted metadata, readable change lines, and the `fr5a`/`exclude` merges; `files.test.ts` covers guard/save behavior and read-vs-write failure handling.

What is still absent:

- no test runs the real `reviewMap`/`reviewProposal` wiring with a fake `HarnessTab`, deferred `confirm`, and the injected map deps — so the `read_map` case/disabled wrapper and the `confirmDelete` abort listener are only verified by inspection;
- no test proves the map tools disappear at the `toolsForRun` level when `settings.mindMaps` is false (the existing no-deps test is not the same gate);
- no test proves the disabled `read_map` string renders as a failed `ToolRow`, and no test covers an editor save racing the write (finding 1);
- no Playwright case approves an `edit_map`/`delete_map` and asserts the `.canvas` changes only after the click; `e2e/aiNoteChanges.spec.ts` covers note edits/deletion only, and `e2e/maps.spec.ts` does not exercise the AI map tools.

**Fix:** add the harness-level map approval test (including a deferred `guard` during a map write and an `edit_map("atlas")` against `Atlas`) and one phone/desktop e2e map-tool case. The stale and delete tests should assert both the disk file and the transcript row.

### 4. A recorded save failure still blocks all later map writes until a successful save (Low, availability)

**Where:** `files.ts:51-63`.

A one-off “disk full” or permission failure is remembered in the module-level `failures` map. `guardMapRead` correctly ignores it, so `read_map` works, but every later `create_map`/`edit_map`/`delete_map` for that name is refused with “The map could not be saved” until the canvas performs a successful write or `clearMapSaveFailure` is called. Closing the canvas does not clear it, and a renamed/reused map name can inherit the stale entry.

**Fix:** clear the failure when the canvas closes successfully, or limit the check to the specific pending write and expose a “retry save” path. At minimum, explain how to clear it in the error.

---

## Acceptance checklist

| Requirement                                                                                      | Result                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_maps` and `read_map` expose a compact structured view of nodes, edges, note IDs and labels | Pass (`mapTools.ts:151-197`); names resolve case-insensitively and a disabled read now shows a failed row, with the metadata-policy note in finding 2                                            |
| Respect the mind-map setting                                                                     | Pass in code (`harness.svelte.ts:889-920`, per-call checks); no harness-level feature-off test                                                                                                   |
| Map-name/path validation; no arbitrary `.fr5a` files                                             | Pass: `validMapName`/`mapPath` and `listMaps` filtering; traversal tested                                                                                                                        |
| `create_map`, `edit_map`, `delete_map`; edit covers nodes and connections                        | Pass                                                                                                                                                                                             |
| Validate JSON Canvas via the existing parser/serializer                                          | Pass (`mapTools.ts:120-126`); malformed maps are refused for edits (`mapReview.ts:50-54`)                                                                                                        |
| Preserve unknown fields                                                                          | Pass for top-level/node/edge fields and round trips; an invalid `fr5a.exclude` now keeps the prior exclusions (tests at `mapTools.test.ts:79-108`)                                               |
| Readable before/after summary or diff                                                            | Pass: readable `summary` plus mode labels; raw diff remains on the tool row. Note: an `fr5a`-only change still reads as “Updated node …”, so the diff is the only place that shows it            |
| Additional destructive confirmation for deletion                                                 | Pass (`mapReview.ts:79-90`, `HarnessPane.svelte:1012-1014`); Stop before `remove()` is checked and unit-tested                                                                                   |
| Coordinate with pending saves and changed-on-disk guard                                          | Pass in the normal path: `guardMapWrite`, disk-text recheck before write and after the delete dialog; narrow guard race in finding 1                                                             |
| Recheck immediately before applying; reject concurrent edits                                     | Pass for create/edit/delete in the normal path; no harness regression test, and the one-shot editor guard remains (finding 1)                                                                    |
| Agent can identify linked notes by permitted metadata                                            | Pass for titles/local-only/encrypted existence; encrypted path policy in finding 2                                                                                                               |
| `read_note` / note edits keep chat access and privacy gates                                      | Pass: `policy.test.ts:293-315`; no content leak through a map                                                                                                                                    |
| Validate note IDs when creating/relinking file nodes; handle missing notes                       | Pass for edits (`mapTools.ts:127-134`); encrypted links are no longer “missing”                                                                                                                  |
| Update dynamic prompt and built-in allowlists                                                    | Pass: `context.ts:96-99`, `skills.ts:116-126`; no built-in map writes                                                                                                                            |
| Tests: malformed, missing links, unauthorized reads, approval/rejection, stale, round trips      | Partial: malformed, missing links, unauthorized reads, round trips, unit approval/stale/delete/Stop cases and the `fr5a`/`exclude` cases are covered; no integrated harness/e2e case (finding 3) |

---

## Remaining manual and e2e checks

1. **Desktop approve/reject:** create and edit a map through the assistant; reject the card, confirm nothing changed, then approve and confirm only the reviewed nodes/edges changed. Check the open canvas reloads and the chooser updates.
2. **Desktop stale:** read a map, change the same node in the map editor (or another window) while the approval card is open, then approve; expect “Not applied: The map changed since review; nothing applied. Read it again.” and the user's version intact.
3. **Desktop delete:** approve `delete_map`, verify the first card says “Continue to confirmation”, Cancel/Stop leaves the map, and the second red dialog names the map; confirm, then verify the `.canvas` is gone and the linked notes remain.
4. **Phone:** run the same create/edit/delete flow from the AI sheet; check the approval card fits, the destructive dialog is reachable, and Back/Escape do not leave a pending approval card behind.
5. **Stop:** press Stop while a map tool is preparing (slow disk/sync), while the approval card is open, and during the final delete guard/read; no approval card should appear after “Stopped.”, and no map should be written or deleted. The two final-delete windows are unit-tested; the manual pass should still confirm the dialog closes and the run settles.
6. **Open/dirty map:** with unsaved node edits, ask the assistant to edit that map; confirm pending edits are flushed or the tool refuses, and that the user's edited version is not overwritten. With a clean open map, approve and confirm the canvas reloads without losing selection/viewport.
7. **Privacy:** cloud provider, Read all off, no attachments; ask it to read a map containing a note in a local-only folder and an encrypted note. Confirm it cannot read either note's contents, the local-only path/title are absent, the encrypted title is absent, and decide whether the encrypted path is acceptable (finding 2).
8. **Feature gate:** turn Mind maps off (with linked notes still on) while the AI pane is open; the five map tools must disappear from the next run and any pending map approval must refuse to apply.
9. **Name validation:** ask the agent to read/edit/delete `../notes/x`, `.hidden`, `all`, `dir/name` and a 200-character name; expect “Invalid map name”/“Map operation failed” with a failed row, no file access.
10. **Case-only names:** browse to `Atlas`, ask the agent to read and edit `atlas`; both must resolve to `Atlas`. With `Atlas` open and dirty, also check that `edit_map("atlas")` either waits for the save or rejects cleanly instead of showing a card that cannot apply (finding 1).
11. **Unknown fields:** hand-edit a `.canvas` with extra top-level, node and edge fields, approve a one-field AI edit, and diff the file; extras must survive. Repeat with `fr5a: null` and `fr5a: { exclude: 'bad' }`; the file must still keep its earlier `exclude` entries.
12. **Two devices:** create/edit/rename/delete a map on device A while device B has the map screen open; confirm sync, the chooser refresh, and the dirty-map conflict prompt from Stage 3 still apply with the AI edits.
13. **E2E:** add and run a map-tool Playwright case (approve/reject, delete confirmation, stale) before completing the roadmap; run the full `npm run test:e2e` on desktop and phone projects.

---

## Recommendation

**Pass Stage 5 at 97/100.** All three follow-up fixes are real and unit-tested: a stopped run can no longer delete a map after the destructive confirmation, an invalid `fr5a.exclude` can no longer silently re-enable excluded notes, and `read_map` now resolves case-only names and reports a disabled read as a failure. The approval card is usable and the map tools have meaningful unit coverage.

Before calling the stage fully closed:

1. Close the last guard window: hold the canvas guard/lease across the final read→write span (or re-run it immediately before `writeMap`), and resolve the map name before the prepare-time guard (finding 1).
2. Decide the encrypted-path policy, then either omit `noteId` for encrypted links or document that paths are permitted map metadata (finding 2).
3. Add the harness-level map-approval test and one e2e map-tool case, plus a test for the disabled `read_map` row (finding 3).

Finding 4 (stale save-failure entry) is a cleanup item for the same pass. The roadmap implementation record was intentionally not changed because this review was scoped to this file only.
