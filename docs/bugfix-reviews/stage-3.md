# Stage 3 review — re-review after repairs

- **Reviewed:** 2026-10-27, working tree on `main` (Stage 1, Stage 2 and Stage 3 changes are uncommitted; Stage 4A was being edited concurrently and is outside this review)
- **Scope:** roadmap Stage 3 — hidden/synced `.fr5a/` data, map refresh after sync, pending/debounced edits, chooser updates, and desktop/Android behaviour
- **Verdict:** **PASS** — score **92/100** (threshold ≥ 90)
- **Previous review:** FAIL at 78/100 (`docs/bugfix-reviews/stage-3.md`, before repairs)
- **Mode:** read-only review; no implementation or roadmap changes. Only this review file was edited. The two extra Playwright checks below live in `/tmp/opencode/stage3-rereview/`, not in the repository.

The two blocking issues from the first review are fixed. Back during a save now writes the original map instead of `null.canvas`; a closed map's pending save is awaited before push; read errors are no longer reported as deletions; post-unmount work is guarded; and sync removal/rename is explained. The new fake API sync hook and e2e coverage make the receiving-device path a committed regression test. The remaining findings are narrow follow-ups, not blockers.

---

## Score breakdown

| Area                                                     | Result                                                                                                                                                            | Points       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Hidden synced data and path hygiene                      | Maps/assets/chats still hidden and carried by both Git implementations; `APP_MAPS_DIR` is centralised and map names are validated; no real Android/two-device run | 29 / 30      |
| Chooser and open-map refresh after sync                  | Clean reload, dirty conflict, remote removal, chooser refresh and last-map tracking work; removal is explained; a late-started save can still miss the sync gate  | 24 / 25      |
| Pending/debounced edits and changed-on-disk coordination | Stable map name, awaited closed-map saves, read-error handling, destroyed guards and interaction deferral are in place; a stale save failure can block sync       | 27 / 30      |
| Tests and platform verification                          | Strong unit coverage plus a sync-capable fake API and e2e tests; the committed Back test misses the debounce window, and no real device/two-repo run was done     | 12 / 15      |
| **Total**                                                |                                                                                                                                                                   | **92 / 100** |

---

## Repairs confirmed

1. **Stable map name.** `MapCanvas.svelte:73` freezes `mapName` with `untrack(() => name)` and uses it for load/save/refresh/track/ARIA. `mapPath` now rejects empty, `all`, leading-dot, separator and control-character names (`canvas.ts:14-26`), and `files.test.ts` covers invalid names. A throwaway Playwright run that clicks Back immediately after Enter, inside the 500 ms debounce, saved `Quick` into `maps/Atlas.canvas`, created no `maps/null.canvas`, and showed no dialog.
2. **Closed-map save before push.** `savedAll()` waits for every tracked save and throws on a recorded save failure (`maps/files.ts:47-51`); `app.sync()` awaits it after the note flush and leave hooks (`app.svelte.ts:2215-2223`). The new e2e test holds `writeMeta`, closes the map and asserts the push snapshot is empty until the write is released.
3. **Read errors versus missing files.** Desktop returns `null` only for `ENOENT`/`ENOTDIR` (`metaFiles.ts:22-31`); Android does the same for missing-file codes (`api.capacitor.ts:813-822`). Initial load shows an inline error; a refresh error shows a notice without navigating or discarding edits. `metaFiles.test.ts` and `api.capacitor.test.ts` cover both.
4. **Post-unmount safety.** `destroyed` and `refreshRequest` guard every `await` in load/write/refresh; the in-flight-refresh e2e test unmounts the map, resolves the read, and confirms no navigation or dialog.
5. **Removal/rename explanation.** `removedBySync()` shows a notice, clears the remembered map and returns to the chooser (`MapCanvas.svelte:275-280`).
6. **Interaction during sync.** Dragging, selection-dragging and connecting set `interacting`; a sync during a gesture is deferred until `interactionEnd()` (`MapCanvas.svelte:283-301`, `:418-424`, `:1068-1084`).
7. **Coverage.** The fake API now owns `onSyncDone` listeners and a sync harness (`e2e/fakeApi.ts:60-74`, `:414-450`, `:496-501`). The committed e2e suite covers clean reload, dirty conflict, read-error notice, remote removal, in-flight refresh, Back while a write is in flight, push-after-close and last-map rename.

---

## Verification performed

Against the current tree:

```text
npm run check
→ svelte-check found 0 errors and 0 warnings

npx vitest --run src/renderer/src/lib/maps src/main/metaFiles.test.ts \
  src/main/fileService.test.ts src/main/syncIpc.test.ts \
  src/renderer/src/lib/platform/git/isoGit.test.ts
→ 7 files passed, 74 tests passed

npm test
→ 54 test files passed, 457 tests passed

npx playwright test e2e/maps.spec.ts
→ 18 passed, 18 skipped (skips are intentional per-project gating), 43.2 s
```

Extra checks outside the repository (`/tmp/opencode/stage3-rereview/`, using the committed fake API):

1. **Back inside the debounce window** (the exact first-review repro, without waiting for `writeStarted`): passed — no `null.canvas`, no dialog, the text was in `Atlas.canvas`.
2. **Stale save failure after deleting the map**: passed, reproducing the residual issue below. A failed map write records a module-level failure; deleting the map does not clear it, so the next Push is refused with `A mind map could not be saved: EIO` and no push snapshot is produced.

The working tree also contains Stage 1 and Stage 2 changes and a `D MASCOTS.md` deletion; those are excluded from this score. The Stage 4A work being edited concurrently was not assessed.

---

## Residual issues

No blocking issues remain. These are follow-ups worth tracking.

### 1. A stale map-save failure can block all future syncs (Medium)

**Files/lines:** `src/renderer/src/lib/maps/files.ts:26-51`; `src/renderer/src/lib/components/maps/MapCanvas.svelte:221-225`; `src/renderer/src/lib/components/maps/MapChooser.svelte:70-76`, `:101-107`

`recordMapSaveFailure` stores the last error per map. `savedAll()` throws while any entry remains. The only clear paths are a later successful write of that same map (`MapCanvas.svelte:237`, `:249`, `:266`); deleting or renaming the map does not clear the entry, and `savedAll()` is consulted for every sync while mind maps are enabled. If a map save fails and the map is then deleted (or renamed and never saved again), every Push/Pull is refused until the app restarts.

This is safer than reporting a false success, which was the original bug, but it is an indefinite block with no recovery in the UI. Clear failures in `removeMap`/`renameMap` (or key the error to the file and drop entries whose map no longer exists), and consider allowing sync when the failing map was deliberately deleted. Add a test for “failed save → delete map → push proceeds”.

Reproduced with the throwaway harness: mark `readMeta` as failing, edit, wait for “Couldn’t save the map: EIO”, Back, delete Atlas, clear the failure flag, Push → the title bar reports the stale map-save error and `pushSnapshot` stays empty.

### 2. The committed Back test does not exercise the debounce-teardown path (Low/Medium)

**Files/lines:** `e2e/maps.spec.ts:142-170`

`checkBackWhileSaving` waits for `__syncHarness.writeStarted` to become true before clicking Back. By then the 500 ms debounce has already fired and `dirty` is false, so the original failure mode — teardown flushing a dirty canvas after the name prop becomes `null` — is not exercised. The test would still pass if `mapName` were live. The throwaway test that clicks Back immediately after Enter passes on the current code, so this is a coverage gap rather than a regression; the committed test should use that timing (and keep the in-flight-write case separately).

### 3. The sync save gate only covers saves that already exist (Low)

**Files/lines:** `src/renderer/src/lib/stores/app.svelte.ts:2215-2223`; `src/renderer/src/lib/maps/files.ts:47-50`

`savedAll()` loops while `saving` is non-empty, but a save that starts after that loop resolves and before `syncPush()` is called is not awaited. In practice the window is tiny (a map must be closed during the same sync), and the same is true if mind maps are switched off while a save is in flight: the `settings.mindMaps` guard skips the gate. A store-level “map writes pending” counter, or keeping the closed canvas's save registered until it settles, would close the window. Not worth blocking the stage for; note it so the guarantee is not over-read.

### 4. Remote rename is still presented as removal (Low)

**Files/lines:** `src/renderer/src/lib/components/maps/MapCanvas.svelte:275-280`

The notice says “was removed or renamed by sync”, which is honest but does not name the replacement. The old map is no longer reopened and `lastMindMap` is cleared, so there is no stale-file resurrection. Naming the new file would need a before/after map listing; optional polish.

### 5. A chooser listing failure looks like “no maps” (Low)

**Files/lines:** `src/renderer/src/lib/maps/files.ts:17-20`; `src/renderer/src/lib/components/maps/MapChooser.svelte:16-28`

`listMaps()` catches every `listMeta` error and returns `[]`. A permission error or transient I/O failure while the chooser refreshes therefore renders an empty map list with no notice, which can read as “my maps were deleted”. The open canvas now distinguishes a read error correctly; the list path should either surface a non-blocking error or keep the previous list. Add a test where `listMeta` rejects and the chooser does not claim the maps are gone.

### 6. Test coverage still has gaps (Low)

- No e2e assertion that the **chooser list** gains a remotely added map or loses a deleted one; `MapChooser.svelte:25-28` is only covered indirectly.
- No test for a sync during a node drag/connection (issue 6's new `interacting` path).
- No test for the initial `load()` read error (only the refresh read error).
- No test for a second sync while the conflict dialog is open; `app.confirm()` cancels the previous dialog, so this is worth locking down.
- No component-level `MapCanvas` test with an injected sync callback; the e2e suite covers the important flows, but drag/dialog races are expensive to cover only through the browser.

### 7. Platform verification is still simulated (Low)

The fake `onSyncDone` event and the two-repo Git tests cover the file semantics, but no real Android device, desktop shell or pair of clones was run. The roadmap explicitly asks for verification across two devices/repositories with the receiving screen open. The committed sync e2e narrows that gap substantially, but a manual run remains part of acceptance.

---

## Edge checklist

| Concern                                                               | Result                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `.fr5a/maps`, `.fr5a/assets`, `.fr5a/chats` hidden from the note tree | Pass: existing path/file-service tests                                      |
| Both Git implementations carry hidden maps/assets/chats               | Pass: `gitSync.test.ts`, `isoGit.test.ts`                                   |
| Device-only AI sessions stay out of sync                              | Pass in both repo tests via `sessions/.gitignore`                           |
| Clean open map reloads a remote change                                | Pass: committed e2e plus `refresh.test.ts`                                  |
| Local dirty edit + remote change                                      | Pass: conflict dialog, Reload/Keep mine e2e                                 |
| Remote delete while clean                                             | Pass: chooser plus “removed or renamed” notice                              |
| Remote delete while dirty                                             | Pass at the pure-decision level; no dedicated e2e for delete-with-dirty     |
| Chooser list refreshes after sync                                     | Code path present (`MapChooser.svelte:25-28`); not directly asserted in e2e |
| Open dirty map save waits before sync push                            | Pass: leave hook plus `savedAll`                                            |
| Map closed, then push immediately                                     | Pass: committed e2e holds the write and asserts the push waits              |
| Back while a save is debounced                                        | Pass: throwaway Playwright repro; committed test uses a later timing        |
| Phone/Android Back from a dirty map                                   | Pass on the phone e2e viewport; real Android not run                        |
| Transient read error / permission error                               | Pass: inline load error / refresh notice; desktop and Android unit tests    |
| Sync during a node drag / connection                                  | Code defers the refresh; no automated test                                  |
| Remote rename while open                                              | Treated as removal with a notice; no stale last-map fallback                |
| Media and saved chats survive rename/delete across repos              | Pass at file level in repo tests; no in-app asset-reference check           |
| Two real devices/repositories                                         | Not run                                                                     |
| Android map sync end-to-end                                           | Not run; unit tests cover `readMeta`/`writeMeta`/`listMeta`                 |

---

## Remaining manual checks

1. Two real clones: with B's map screen open, pull an edit, a rename and a deletion from A. Confirm B reloads cleanly, the dirty case shows one dialog, the chooser updates and no deleted file is resurrected.
2. Desktop: edit then press **Back to maps** immediately (inside 500 ms), and repeat with **Close mind maps**. Confirm the original file contains the edit, no `null.canvas` appears, and an immediate Push includes it.
3. Phone/Android: repeat the debounce Back test with hardware Back and after backgrounding/foregrounding during the save. Confirm no lost text, no `null.canvas` and no dialog after leaving the map.
4. Put `.fr5a/maps` on a read-only mount, open and sync a map, then restore access. Confirm the UI reports a read/save error rather than a deletion, and that sync can recover without a restart.
5. Sync while dragging a node, while drawing a connection and while the conflict dialog is open. Confirm the refresh is deferred or asks once, and no dialog appears after leaving the map.
6. Verify a failed map save followed by deleting the map: Push should either proceed or offer a way to clear the stale failure (residual issue 1).
7. Sync a note with an image and a saved AI chat across both repos; confirm `.fr5a/assets` and `.fr5a/chats` resolve and remain out of ordinary note browsing.

---

## Out-of-scope working-tree note

`MASCOTS.md` is still deleted (` D`). `MapCanvas.svelte` also contains `proOptions={{ hideAttribution: true }}` (`:1114`), which produced Svelte Flow's “only when subscribed to Svelte Flow Pro” warning throughout the e2e run. That change belongs to the Stage 2 map polish, not Stage 3, and should be confirmed or reverted before merge.

## Recommendation

**Pass Stage 3 at 92/100.** The stage now meets its acceptance criterion: synced data stays hidden, remote changes become visible, and unsaved local work is protected in the paths that previously failed. Before merge, add the immediate-Back e2e timing and clear stale save failures on delete/rename; then complete the two-device/Android run. Those are follow-ups, not reasons to hold Stage 4A.
