# Stage 4A re-review — the harness tells the agent exactly what it can do

- **Re-reviewed:** 2026-10-27, working tree on `main` (Stage 4A repairs uncommitted; Stage 3 and in-flight Stage 4B changes are in the same tree)
- **Scope:** roadmap Stage 4A — dynamic “Available tools” prompt, permissions/wording, map-linked notes, and the context/policy tests
- **Verdict:** **PASS** — score **97/100** (threshold ≥ 90)
- **Mode:** read-only re-review after repairs. No implementation, roadmap, or `MASCOTS.md` changes made. Only this review file was updated. No repository temp files were created.

The four blocking findings from the first review are resolved. The prompt is now generated from the filtered `Tool` definitions, it distinguishes the attached open note from a detached one, it branches the workflow prose on the tools that actually exist, and the built-in web skills no longer name tools that may be absent. The policy tests now exercise Read-all descriptions, a tool-less provider through `runLoop`, a real parsed canvas file link, positive reads/searches/writes, hidden-note writes, and local providers.

Remaining items are non-blocking: a formatting regression in the new prompt code, `fetch_url` still not following search readiness, the UI “read any note” pill, and the absence of a harness-level wiring test for the Read-all/open-note inputs.

---

## Score breakdown

| Area                                                         | Result                                                                                                                                                        | Points       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Dynamic “Available tools” after skill/web/provider filtering | Generated from filtered definitions; skill allowlist and provider gating tested; web readiness applied; built-in skills capability-phrased                    | 35 / 35      |
| Accurate permissions and boundaries                          | Open-note wording now follows attachment; workflow prose conditional; local-provider branch added; minor qualification wording remains                        | 24 / 25      |
| Map links do not grant access                                | Boundary stated; allowlist test now parses a real canvas file node; real map traversal deferred to Stage 5                                                    | 15 / 15      |
| Policy tests                                                 | Default/restricted/Read-all/web/tool-less/denied-read/positive/map-link/local-provider cases present; harness wiring and current-write guard only unit-tested | 14 / 15      |
| Verification and quality                                     | `check` 0/0; harness 122 tests; policy 14 tests; full suite 461 tests green; `prettier --check` still flags 3 touched harness files                           | 9 / 10       |
| **Total**                                                    |                                                                                                                                                               | **97 / 100** |

---

## Verification performed

Commands run against the current tree:

```text
npm run check
→ svelte-check found 0 errors and 0 warnings

npx vitest run src/renderer/src/lib/harness/
→ 15 test files passed, 122 tests passed

npx vitest run src/renderer/src/lib/harness/policy.test.ts --reporter=verbose
→ 14 tests passed

npm test
→ 54 test files passed, 461 tests passed

npx prettier --check (context, tools, harness, policy, skills)
→ context.ts, tools.ts, harness.svelte.ts flagged; policy.test.ts and skills.ts clean
```

The full suite was green at 05:21:33. During this re-review, Stage 4B additions (`edit_note`, `delete_note`, `proposeEdit`/`proposeDelete` in `tools.ts`/`apply.ts`) appeared in the same working tree. They are outside Stage 4A scope and are not scored here; the focused Stage 4A policy tests passed both before and after those files changed. The tree is still moving, so the full-suite result is a snapshot, not a freeze.

No live desktop/phone run, no AI-provider run, and no e2e run were done. The findings below are code-path verifications, not UI reproductions.

---

## Blocking issues from the first review — all cleared

### 1. Open-note wording now matches the attachment and the write guard — **Resolved**

`buildSystemPrompt` takes `currentNoteAttached` (`context.ts:73`, `:82`) and only claims the open note is readable when it is attached. Detached runs say the open note “is not attached and cannot be read or changed as `"current"`”, and Read-all runs add that it may be read by id but not written as `"current"` (`context.ts:83-84`). `tools.ts:187` now describes `target: "current"` as “only if the open note is attached”. `harness.svelte.ts:866` supplies `tab.useCurrent && !!run.current`, which matches the allowlist construction at `:826`/`:844`, and the write guard at `:852-855` returns the matching rejection. `policy.test.ts:109-120` covers attached/detached prompts, the unmentioned `read_note` rejection, and `canWriteCurrent` for off/absent/current/draft.

### 2. Policy tests now cover Read-all, provider parity and default — **Resolved**

`policy.test.ts:64-92` builds the default set with an empty allowlist, a restricted `summarize` run, a web-enabled run, and a `profile.tools = false` run; it asserts the guard line, `No tools are available`, and every advertised definition. `:94-121` builds `allowedNoteIds: null` and asserts the unrestricted `read_note`/`list_notes`/`search_notes` descriptions plus a positive `read_note`. `:123-140` runs `runLoop` and confirms a tool-less provider is handed `[]` while its prompt says no tools. This closes the previous “sentence-only” gaps.

### 3. Built-in web skills no longer name unavailable tools — **Resolved**

`sources` and `fact-check` now say “if web search is available / unavailable” and “when page fetching is available” (`skills.ts:169`, `:178-180`). No `web_search`/`fetch_url` names remain in those prompts. `policy.test.ts:142-156` builds both skills with and without web deps and asserts the unavailable names are absent in the no-web prompt and `web_search:` is present when configured. The generic guard line (`context.ts:92`) still covers custom skills that hard-code names.

### 4. Map-link test is real and read/write coverage is positive — **Resolved**

`policy.test.ts:226-248` parses an actual JSON Canvas, reads the file node’s note id (`linked.md`), expands only the explicit mention (`public.md`), and asserts the linked id is not in `allowedNoteIds` and is rejected by `read_note`, `write_note` and `search_notes`. `:209-224` now also asserts a successful read, a successful search match and a successful write. `:250-272` covers Read-all + hidden metadata on cloud, hidden writes, and a local provider reading/writing local-only notes. The test name was corrected to “unmentioned notes”.

---

## Remaining actionable findings (non-blocking)

### 5. Formatting regression in the new prompt code (Low)

`npx prettier --check` flags `context.ts`, `tools.ts` and `harness.svelte.ts`. `context.ts` is entirely Stage 4A and its new template strings at `:80-92` are over-long; `tools.ts` has 4A lines at `:60-68` and `:87-98`; `harness.svelte.ts` has 4A lines at `:42`/`:677-700` plus in-flight 4B code. The `HEAD` versions of these files were formatted, so this is a new regression, not a pre-existing condition. Run Prettier on the Stage 4A hunks (not the whole files while Stage 4B is editing them) before commit.

### 6. `fetch_url` still ignores search readiness (Low)

`harness.svelte.ts:857` adds `fetchPage` whenever a search config exists, while `web_search` is gated by `searchReady` at `:824-825`, `:856`. With a key-requiring search kind and no key, the prompt advertises `fetch_url` although web search is unusable. If the intent is “page fetch works independently”, add a test that pins that behavior and note it in the prompt; otherwise gate both on `searchReady`.

### 7. UI permission pill still says “any note” (Low, outside the prompt)

`HarnessPane.svelte:619` still titles the pill “This chat may read any note”, and `:732` says the agent may “read any note in this workspace”. Read all still excludes hidden-from-cloud and unreadable encrypted notes. Stage 4B is editing this component; align both strings with “eligible notes” when that lands.

### 8. No harness-level test that `run()` wires Read-all/current-note into the prompt (Low)

The prompt and tool unit tests are strong, but the decisions at `harness.svelte.ts:826-869` (`tab.readAll ? null : allowedNoteIds`, `currentNoteAttached: tab.useCurrent && !!run.current`, `toolsForRun(...)`, `buildSystemPrompt({ tools })`) are verified only by inspection. A regression there would still pass every policy test. A pure helper such as `runPromptInputs(tab, run, profile)` that returns `{ allowedNoteIds, currentNoteAttached, tools }` would make this testable without standing up the whole Svelte store.

### 9. Current-note write guard is tested at the predicate, not through `proposeWrite` (Low)

`canWriteCurrent` covers the truth table (`policy.test.ts:117-120`), but the harness branch at `harness.svelte.ts:852-855` that returns “Cannot change the current note…” is not exercised. Pair it with the helper above or add a small harness integration test. Locked-note write rejection now lives in `eligible`/`prepareWrite` and belongs with Stage 4B’s apply tests.

### 10. Wording qualifications worth tightening (Low)

- `context.ts:90` says “Local providers may read local-only notes” even in restricted chats where those notes still need a mention. Qualify with “that are otherwise eligible”.
- `context.ts:82` says the attached open note and mentioned/attached notes “are readable” without “eligible”; the following protections sentence covers hidden/encrypted, but “eligible” would match `readableNotes()` exactly.

### 11. Skill prompt is still appended for a provider with no tools (Low)

A tool-less provider with a skill gets “No tools are available for this run.” followed by a `## Task` that may tell it to read or write. The guard line (`context.ts:92`) prevents invention, but a test for `toolsForRun(skill, { profile: { ...remote, tools: false } })` plus the skill prompt would pin the intended behavior.

---

## Edge checklist

| Concern                                                                    | Result                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Available tools generated from `ToolDef`s, not a hard-coded prompt catalog | Pass: `context.ts:63-66`, `:91`; provider receives schemas separately                                                          |
| Skill allowlist applied before the prompt is built                         | Pass: `tools.ts:60-64`; `harness.svelte.ts:838-859`; `policy.test.ts:75-82`                                                    |
| Web tools absent when no search is configured                              | Pass: `createTools`; `policy.test.ts:71-83`, `:142-156`                                                                        |
| Web tools absent when the search profile has no key                        | Pass for `web_search` (`searchReady`); `fetch_url` intentionally remains — see finding 6                                       |
| Provider with tool calling off advertises no tools                         | Pass: `policy.test.ts:84-92`, `:123-140`                                                                                       |
| No JSON schemas duplicated in the prompt                                   | Pass: names and descriptions only                                                                                              |
| Read/list/search respect the allowlist                                     | Pass: `tools.ts:86-122`, `:138-168`; `policy.test.ts:209-248`                                                                  |
| Hidden-from-cloud notes filtered from discovery and reads                  | Pass: `readableNotes`; `policy.test.ts:250-272`                                                                                |
| Read all + hidden note on cloud provider                                   | Pass: `policy.test.ts:250-272`                                                                                                 |
| Read all + local provider may read local-only notes                        | Pass: `policy.test.ts:250-272`                                                                                                 |
| Map link does not become a read permission                                 | Pass at allowlist level with a parsed canvas (`policy.test.ts:226-248`); full traversal from map tools deferred to Stage 5     |
| Open note readable when the “open note” chip is off                        | Pass: prompt says detached and tools reject (`policy.test.ts:109-116`)                                                         |
| Current note writable only when attached                                   | Pass at predicate/guard level (`tools.ts:66-69`, `harness.svelte.ts:852-855`); no harness integration test                     |
| Every write waits for approval                                             | Pass for `write_note`; `reviewWrite`                                                                                           |
| Deletion requires destructive confirmation                                 | Stage 4B; not advertised by the Stage 4A prompt                                                                                |
| Built-in skill allowlists do not silently gain future powers               | Explicit lists remain safe; `tools: null`/`*` still means “all”, so Stage 4B/5 must decide that policy deliberately            |
| Tool registry extensible                                                   | Pass structurally; new 4B `edit_note`/`delete_note` flow through `toolsForRun` and the dynamic prompt without a second catalog |

---

## Remaining manual checks

Code paths are verified; these confirm the live wording and UI:

1. Desktop: turn off the “open note” chip, send a plain message, and ask the agent to read/write the open note. Confirm the prompt, `read_note` and the `write_note` current guard all agree (finding 8/9).
2. Settings → AI: configure a key-requiring search kind without a key, then invoke `/sources`. Confirm `web_search` is absent, decide whether `fetch_url` should also be absent, and confirm the skill explains the limitation (finding 6).
3. Provider with tool calling disabled: inspect the built prompt; confirm it says no tools and does not list note tools (covered at unit level by `policy.test.ts:123-140`).
4. Read all on, with a note in a local-only folder and an encrypted note: confirm the prompt, tool descriptions and actual `read_note`/`list_notes` results agree.
5. Restricted custom skill that allows only `write_note` (or only `read_note`): inspect the prompt for workflow sentences naming unavailable operations.
6. When Stage 5 lands, repeat with a map open: reading a map and its linked note ids must not let `read_note` read an unmentioned, hidden, or local-only note.

---

## Out-of-scope working-tree note

The working tree contains Stages 1–3 and in-flight Stage 4B changes alongside Stage 4A. `MASCOTS.md` remains deleted (` D`) and was not touched. Stage 4A files in this review are `context.ts`, `tools.ts`, `harness.svelte.ts`, `skills.ts` and `policy.test.ts`. `HarnessPane.svelte` was not modified. Stage 4B’s `edit_note`/`delete_note` appeared in `tools.ts`/`apply.ts` during the re-review; they are not scored, and their formatting/test churn should not be read as Stage 4A failures.

## Recommendation

**Pass Stage 4A.** The score is 97/100, above the 90 threshold, and the acceptance criterion is met: the agent is told the tools it actually has, what they do, and why a read or write may be rejected, and new tools flow into the prompt without a second catalog. Before merge, run Prettier over the Stage 4A hunks (finding 5) and decide the `fetch_url` readiness question (finding 6). Findings 7-11 can be folded into Stage 4B or the next harness cleanup.
