# Stage 4B review — AI note edits and deletion

- **Reviewed:** 2026-10-27, working tree on `main` (Stages 1–4A and in-flight Stage 5 are uncommitted in the same tree)
- **Scope:** roadmap Stage 4B — targeted `edit_note`, `delete_note`, approval/transcript behavior, Stop, stale targets, privacy, and soft delete
- **Verdict:** **PASS** — score **92/100** (threshold ≥ 90)
- **Mode:** read-only review. No implementation, roadmap, or `MASCOTS.md` changes. Only this review file was written. No repository temp files were created; e2e was not run.

Stage 4B meets its acceptance criterion: the agent can propose a precise note edit or a note deletion, and neither happens without an explicit approval — deletion additionally needs a second, destructive confirmation and lands in Trash. The edit is anchored to the exact text the user reviewed and is refused if the note changed; the delete is refused after approval if the note changed, vanished, got locked, or the user stopped the run during the destructive dialog. The remaining findings are two medium Stop/lifecycle races, some editor-path polish, and test gaps around the harness-level approval flow. None of them makes a change happen without a user click.

---

## Score breakdown

| Area                                                                                              | Result                                                                                                                                            | Points       |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Targeted `edit_note` (target validation, one-occurrence rule, live editor, exact-content recheck) | Solid; a draft/`current` edit gets a terse "No saved note is open"; `setContent` resets selection and scroll                                      | 22 / 25      |
| `delete_note` (identity, destructive confirmation, soft delete, privacy, stale/missing)           | Meets the roadmap; two wording/restore-promise nits                                                                                               | 22 / 25      |
| Approval binding and stale detection                                                              | Rechecks before and after the destructive dialog; Stop-before-card race and a small post-check window remain                                      | 18 / 20      |
| Rejection / Stop / failure results and transcript rows                                            | Status and labels are accurate; late applies after Stop can be reported as cancelled                                                              | 12 / 15      |
| Tests                                                                                             | Good apply/tool tests and a phone e2e; no harness-level approval/Stop tests, two over-claiming test names, no built-in delete-allowlist assertion | 10 / 15      |
| Verification and quality                                                                          | `check` 0/0; 474 tests green (Stage 5 included); `eslint` fails on 3 errors (only `apply.ts:29` is 4B; the others are 4A/Stage 5)                 | 8 / 10       |
| **Total**                                                                                         |                                                                                                                                                   | **92 / 100** |

---

## Verification performed

```text
npm run check
→ svelte-check found 0 errors and 0 warnings

npx vitest run src/renderer/src/lib/harness/
→ 18 test files passed, 134 tests passed (Stage 5 map tests included)

npx vitest run apply.test.ts noteTools.test.ts --reporter=verbose
→ 9 tests passed (6 apply, 3 note tools)

npm test
→ 57 test files passed, 474 tests passed (05:45, with Stage 5's in-flight tests)

npx eslint src/renderer/src/lib/harness src/renderer/src/lib/components/harness e2e/aiNoteChanges.spec.ts
→ 3 errors: apply.ts:29 (4B, unused param), harness.svelte.ts:858 (4A `new Set`),
  harness.svelte.ts:905 (Stage 5 `new Set`)

npx prettier --check (4B-touched files)
→ all matched files use Prettier code style (tools.ts was formatted by the
  concurrent Stage 5 work during this review)
```

The tree moved during the review: Stage 5 map tools (`list_maps`/`read_map`/`create_map`/`edit_map`/`delete_map`) were added to `tools.ts` and `harness.svelte.ts` while this was being read, and the maps block was Prettier-formatted mid-review. Harness line numbers may drift by those hunks. The full-suite result is a snapshot against a moving tree. No desktop/phone run, no live provider run, and no e2e run were performed; the findings below are code-path verifications.

---

## What is implemented well

### 1. `edit_note` is targeted and binds approval to the reviewed text

`tools.ts:228-256` adds the tool only when `proposeEdit` exists; the target is checked with the shared `eligible()` gate (`tools.ts:101-109`), and empty `oldText`/non-string `newText` gets an explicit "Not edited" result. `apply.ts:55-91` resolves `current` to the run's note, flushes the open note, requires the old text to occur **exactly once**, rejects a no-op, and returns before/after for the diff card. Before writing it re-reads the live editor/disk and compares both the text and the pre-review disk contents (`apply.ts:78-81`), so `apply.test.ts:70-79` and `:110-127` (typing during approval) are both covered. The active note goes through `setEditorText` (`apply.ts:150-154`), so it lands in the editor's update/save path.

### 2. `delete_note` is explicit, shows identity, and uses the app's trash

The tool is separate from `write_note` (`tools.ts:258-278`), refuses `"current"`, and the shared `eligible()` gate blocks unmentioned, missing, locked, encrypted, and cloud-hidden notes (`tools.ts:101-109`; `noteTools.test.ts:55-96`). The approval card labels the target `Title (id)` (`apply.ts:99-101`), its primary button says **Continue to confirmation** (`HarnessPane.svelte:990-992`), and the second step is the app's existing `app.confirm({ danger: true, confirm: 'Move to Trash' })` (`apply.ts:111-116`) before `app.deleteNote` (`apply.ts:136`), which is the soft-delete/trash path on desktop (`fileService.ts:413-439`), Android (`api.capacitor.ts:303-321`), and the store (`app.svelte.ts:886-906`). Locked/encrypted protection is rechecked in `assertSafe` (`apply.ts:41-52`) before both steps.

### 3. Rejection, failure, and the second confirmation all produce readable results

`reviewChange` (`harness.svelte.ts:1174-1213`) keeps the reviewed diff on the tool row, returns "The user rejected this change…" on the first Reject, "Not applied: …" on a throw, and "The user rejected deletion; note kept." on the destructive dialog's Cancel. `ToolRow.svelte:17-20`, `:51-64` maps the new tools and results to `Edit note` / `Move to Trash` and to running/ok/failed/rejected/cancelled states; the tag distinguishes `applied` / `rejected` / `not applied`. The abort listener in `prepareDelete` (`apply.ts:117-129`) makes Stop during the destructive dialog safe, and `apply.test.ts:129-139` proves no delete happens afterward.

### 4. Built-in skills do not silently gain deletion

`clarify` and `draft` explicitly add `edit_note` (`skills.ts:123`, `:146`); no built-in skill adds `delete_note`. Explicit user skill allowlists continue to be filtered by `allowedTools` (`skills.ts:110-114`), which is exercised in `policy.test.ts:276-283`. The dynamic prompt keeps tool descriptions as the only catalog (`context.ts:64-65`), so both new tools appear with their descriptions without a second list.

---

## Findings

### 1. A change card can be armed after Stop, and the abort check then has no signal (Medium)

**Where:** `harness.svelte.ts:1174-1213` (`reviewChange`), `:220-227` (`stop`), `:1023-1026` (finally), `apply.ts:93-139`; mechanism in `loop.ts:42-50` (`abortable` rejects but leaves `tool.run` running).

`abortable(tool.run(...), signal)` rejects the moment Stop is pressed, but the tool body keeps running. If Stop lands while `prepare()` is awaiting a platform read or `app.flush()`, the run unwinds, the finally nulls `tab.ctl`, and then the still-running `reviewChange` sets `row.write` and calls `tab.confirm(approval)` — re-arming the approval card **after** "Stopped.". When the user presses Apply, `tab.ctl?.signal` is `null`, so the check at `:1205` passes and `prepared.apply(undefined)` runs with no signal. For `delete_note`, the second destructive dialog still stands between this and the Trash, but a stopped run can still complete a write/edit or reach the delete confirmation.

**Fix:** pass the run's local `signal` into `reviewChange` instead of consulting `tab.ctl`, and check `signal.aborted` immediately before `tab.confirm`, immediately after it, and before `prepared.apply`; clear the card and return/throw `AbortError` if the run was stopped. A `runAborted` flag on the tab (set in `stop()`) would also stop a late `prepare()` from re-arming state.

**Test/manual:** a harness-level test with a deferred `prepare()` that calls `tab.stop()`, then resolves — assert no `tab.approval` and no apply. Manual: on a phone, press Stop the instant a change tool appears; no review card should appear afterward.

### 2. Stop can be too late for the final mutation, while the row says cancelled (Medium)

**Where:** `apply.ts:131-137` (`delete`), `apply.ts:78-88` (`edit`), `harness.svelte.ts:1023-1024`, `:1207`.

The last abort check is immediately before `app.deleteNote(id)` / the write, but those calls are asynchronous (`app.deleteNote` flushes, settles, then does an IPC delete). A Stop during that call cannot cancel it; the run's finally marks the tool row `(cancelled)` and the transcript says "Stopped." even though the note is in Trash or the edit landed. On Retry, the recorded pending call is re-run and now fails with "no longer exists", which reads like a bug to the user.

**Fix:** either make the final mutation non-abortable once the user has confirmed (and record its actual result on the row even when the run was stopped), or have the apply return a "completed after Stop" result that the harness records before unwinding. At minimum, set the row result from the real outcome rather than only "(cancelled)".

**Test/manual:** a test with a `deleteNote` that resolves after an abort, asserting the row says the note was trashed (or the deletion is rolled back). Manual: slow-filesystem phone, Stop immediately after clicking "Move to Trash".

### 3. The "targeted" edit resets the editor selection and scroll (Low)

**Where:** `apply.ts:150-154` (`setEditorText` uses `commands.setContent(textToDoc(after))`).

The file content is preserved, but the entire ProseMirror document is replaced, so the caret, selection, and scroll position are lost on a note the user is working in, and the whole note is re-serialized for a one-line change. `replaceLines` in `editor/markdown.ts:36-61` already does a line-range transaction (it is deliberately out of undo, which is wrong for an AI edit), so the right shape exists: dispatch a `replaceWith` transaction for the changed range with normal undo behavior. Undo itself still works (one step), which is why this is Low.

**Test/manual:** desktop, place the caret mid-note, approve an edit elsewhere; the caret should stay in place and one undo should restore the exact prior text.

### 4. `liveText(id)` ignores its argument, and 4B has one lint error (Low)

**Where:** `apply.ts:29-32` (`id` unused). `npx eslint` fails on it. (`harness.svelte.ts:858` also fails with `svelte/prefer-svelte-reactivity` for `new Set`, introduced in 4A; `:905` is Stage 5. The unused `EditProposal` import that failed earlier was removed by Stage 5 while this was being reviewed.)

`liveText` returns the open editor's text and relies on callers checking `activeId === id`. That is true today, but a future caller would silently read the wrong note. Drop the parameter, or assert `app.activeId === id`.

**Fix:** remove the unused parameter; run `npm run lint` on the 4B hunks.

### 5. Delete denials say "Cannot change" (Low)

**Where:** `tools.ts:101-109`, used by `delete_note` at `:271-275`.

A delete of an unmentioned, missing, locked, encrypted, or hidden note returns `Cannot change "x": …`. The agent is being refused a deletion, and `ToolRow` classifies it as a failed edit. Say "Cannot delete" (or parameterize the verb), while keeping the same reasons.

**Test/manual:** unit: `delete_note` on a locked note in a Read-all chat should read "Cannot delete … it is locked or encrypted."

### 6. The confirmation promises restorability that the platform cannot always honor (Low)

**Where:** `apply.ts:113` ("You can restore it later."), `:137` ("restorable"), `fileService.ts:432-438`, `api.capacitor.ts:313-318`.

Both platform implementations fall back to a hard delete when the rename into `.fr5a_trash` fails (cross-device/symlinked note on desktop; any rename failure on Android). The tool description (`tools.ts:264`) and the dialog promise Trash. The soft-delete path is the existing app operation, so this is inherited, but an AI-driven destructive flow should not state a guarantee the platform can break.

**Fix:** either remove the platform's hard-delete fallback for user notes (report the failure instead), or soften the AI wording to "moves to Trash" without promising restore.

### 7. The harness-level approval flow is untested; two test names over-claim (Low)

**Where:** `apply.test.ts`, `noteTools.test.ts`, `e2e/aiNoteChanges.spec.ts`.

`reviewChange` is the part that binds the diff to the row, returns the rejection strings, sets `row.write.applied`, and handles Stop; only its `prepare`/`apply` half is unit-tested. Missing cases:

- Reject at the **diff card** (not just at the destructive dialog) leaves the note untouched and the row `rejected` — currently only e2e, phone-only.
- Stop at the diff card aborts the run and marks the row `(cancelled)`; Stop before the card is the race in finding 1.
- A failure inside `prepare` (`Not applied`) is not asserted at the harness level.
- `apply.test.ts:81` is named "…preserving restore eligibility", but its `app.deleteNote` mock only deletes from a map; nothing is restored. Restore is covered by the e2e (`aiNoteChanges.spec.ts:28-64`) and the platform tests, not by this unit test.
- `noteTools.test.ts:56` says "including map-linked paths" but passes plain `private/x.md` / `missing.md`; the real parsed-canvas link test covers read/write only (`policy.test.ts:226-248`), not `edit_note`/`delete_note`.
- No test asserts that no `BUILTIN_SKILLS` entry contains `delete_note` (the roadmap's "must not silently acquire deletion" rule). `policy.test.ts:79` only covers `summarize`.

**Fix:** rename the two tests or make them honest, add a tiny harness test around `reviewChange` (a fake tab with a deferred `confirm`), and add the built-in allowlist assertion.

### 8. Delete's first card reuses the generic change vocabulary (Low, UI)

**Where:** `HarnessPane.svelte:975-992`.

The card heading is "Review change", the body renders `<strong>delete</strong> → Title (id)`, and the mode string is the internal `edit`/`delete` token. Identity is present, and the dangerous step is clearly the second dialog, so this is polish: title the card "Move note to Trash" for `mode === 'delete'` and show "Edit note" rather than `edit`, so the user knows what they are approving before the red dialog.

Also note: Escape stops a run only from the composer textarea (`HarnessPane.svelte:282-284`); with the card focused, Escape does nothing (Stop is a visible button). Fine for now, but the card is the moment Stop matters most.

### 9. An edit can empty a note without the destructive confirmation (Low, policy decision)

**Where:** `tools.ts:251` (allows `newText: ''`), `edits.ts` / `apply.ts:72`.

`edit_note` accepts an empty `newText`, and `write_note` replace has always been able to pass empty content. That can clear a whole note with one diff approval, bypassing the "deletions also require a destructive confirmation" decision in the roadmap (which Stage 4B reads as deleting the note itself). The diff card shows the removals, so it is visible, not silent. Decide whether clearing a note should be treated as a destructive edit (extra confirm) or whether the diff is sufficient; if the latter, say so in the prompt/tool description.

### 10. `CLAUDE.md`'s tool list is now stale (Low, docs)

**Where:** `CLAUDE.md:88` still lists `tools.ts` as "read/list/search notes, ask_user, write_note, web_search, fetch_url"; `:92` says only `write_note` keeps its diff on the row. Stage 4B adds two tools and Stage 5 is adding five more. Update after both stages land so the architecture doc matches the registry.

---

## Acceptance checklist

| Requirement                                            | Result                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Existing `write_note` diff-and-approval behavior kept  | Pass: `reviewWrite` → `reviewChange` (`harness.svelte.ts:1087-1093`); same card and apply path                   |
| Targeted edit without replacing the whole note         | Pass at content level; editor-path selection reset — finding 3                                                   |
| Validate the edit target                               | Pass: `eligible` (`tools.ts:101-109`), missing/empty args, `current` resolution                                  |
| Recheck current contents before applying               | Pass: text + disk snapshot before and after the multi-step confirm (`apply.ts:62`, `:80`, `:98`, `:107`, `:133`) |
| Live editor path, undo and auto-save                   | Pass for the open note (`apply.ts:150-154`); `replaceLines`-style transaction would be better                    |
| `delete_note` is explicit and not "current"            | Pass (`tools.ts:258-278`)                                                                                        |
| Note identity on the approval                          | Pass: `Title (id)` (`apply.ts:99-101`)                                                                           |
| Destructive confirmation popup                         | Pass: `app.confirm({ danger: true, confirm: 'Move to Trash' })` (`apply.ts:111-116`), rendered as an alertdialog |
| Uses soft delete/Trash, not permanent delete           | Pass: `app.deleteNote` (`app.svelte.ts:886`) → `platform.deleteNote` → trash on both platforms; restore e2e      |
| Locked/encrypted/privacy restrictions                  | Pass: `eligible`, `assertSafe`, tool tests; hidden local-only refused for cloud                                  |
| Reject stale or missing target                         | Pass: `not exists` / `changed since review`; small final-call window — finding 2                                 |
| Rejection / Stop / failure results and transcript rows | Pass for rejection and failures; Stop races — findings 1–2                                                       |
| Approve/reject/stop/changed/privacy/restore tests      | Partial: apply/tool/e2e present; harness-level gaps — finding 7                                                  |
| Built-in skills do not silently gain deletion          | Pass at code level; no regression test                                                                           |

---

## Remaining manual checks

1. **Desktop, edit:** approve a precise edit on the open note; confirm the rest of the note is byte-identical, the caret/scroll survive (finding 3), and one undo restores exactly the prior text.
2. **Desktop, stale:** have the agent read a note, edit the same passage in another window, then approve the card; expect "Not applied: The note changed since review; nothing edited." with the user's version intact.
3. **Phone, Stop:** press Stop the instant an `edit_note`/`delete_note` row appears (and on a slow/synced folder); expect "Stopped.", no review card afterward (finding 1), and no change.
4. **Phone, delete:** verify `Title (id)` on the first card, the red **Move to Trash** dialog, Cancel/Stop leaving the note, then approve → Trash → restore from Trash to the original folder (e2e path, not run here).
5. **Read all + privacy:** with Read all on, ask the agent to delete a note in a local-only folder and an encrypted note on a cloud provider; expect "Cannot delete/change … hidden from cloud AI" / "locked or encrypted". Repeat with a local provider and a local-only note (should succeed after both confirmations).
6. **Stop during the destructive dialog:** press Stop while the red dialog is open; the note must stay (unit-tested at `apply.test.ts:129`; confirm live).
7. **Open note deleted:** ask the agent to delete the note currently open in the editor; confirm the editor closes to the list, the next tab is sane, and Trash restore brings it back.
8. **Skill allowlists:** `/summarize` must offer neither `edit_note` nor `delete_note`; a custom skill with an explicit allowlist must not gain delete; a user skill with no `tools` field still gets every tool (decide if that is intended for destructive tools).
9. **Two devices:** change the note on device B between the destructive dialog appearing and confirming on device A; the apply must refuse, not overwrite.

---

## Out-of-scope working-tree notes

- Stage 5's map tools are now present in `tools.ts` and `harness.svelte.ts` (including `reviewMap` in the harness). They are not scored here; formatting has since been applied by that work.
- Carryovers from 4A that touch this area but are not 4B failures: the `new Set` lint at `harness.svelte.ts:858`, the "This chat may read any note" pill in `HarnessPane.svelte:619`/`:732`, and `fetch_url` readiness (`harness.svelte.ts:924`).
- `MASCOTS.md` remains deleted in the working tree and was not touched.

## Recommendation

**Pass Stage 4B.** The score is 92/100 and the acceptance criterion holds: precise edits and deletion can be proposed but never happen silently, deletion is a soft delete with a separate destructive confirmation, and stale/locked/privacy targets are refused. Before merge, fix the Stop re-arm (finding 1) and decide the post-Stop write semantics (finding 2); findings 4–7 are quick cleanups (finding 4 is the only 4B lint failure), and 8–10 can follow.
