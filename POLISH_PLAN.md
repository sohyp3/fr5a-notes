# Cross-Platform Polish Pass

## Summary and audit

The visual foundation is already strong. The main gaps are:

- Android swiping is currently nonfunctional because note cards only process horizontal wheel/trackpad events.
- Phone navigation, settings, and harness changes happen abruptly through `display: none`.
- Many controls have hover styling but little touch/pressed feedback.
- Phone title and editor action bars become crowded.
- The context menu is desktop-shaped even when opened by long-press.
- The harness is capable but too dense on phones and tablets.
- Motion lacks shared timing tokens and `prefers-reduced-motion` handling.

Target all desktop, phone, and tablet layouts with a quiet, native-feeling motion language.

## Core UI polish

- Introduce shared motion tokens: 120 ms feedback, 180 ms pane/list transitions, 240 ms drawers/sheets, using a restrained ease-out curve. Disable nonessential transforms under reduced-motion preferences.
- Animate phone navigation forward and backward horizontally while keeping every pane mounted, preserving editor content, caret, scroll position, and harness sessions.
- Add subtle list insertion/removal and reordering motion, settings transitions, drawer scrim fades, button press states, and toggle feedback.
- Implement real pointer-based card swiping with vertical/horizontal direction locking, pointer capture, rubber-band resistance, and `touch-action: pan-y`.
  - Right reveals Pin/Unpin or Restore.
  - Left reveals Move to Trash, Locked, or Delete Forever.
  - Releasing snaps the card open; the revealed 44 px action must be tapped to commit.
  - Permanent deletion opens a confirmation sheet/dialog.
  - Tapping elsewhere, scrolling, or swiping back closes the action.
  - Use brief Android haptics when an action locks open and when it commits.
- Convert long-press menus into a bottom action sheet on phones; retain the anchored context menu on pointer-driven desktop.
- Simplify compact chrome:
  - Phone titlebar shows Back, the current note/scope title, and an overflow menu containing Pull, Push, Theme, and secondary actions.
  - Phone editor shows AI, Pin, and More; direction, lock, and delete move into More.
  - Tablet and desktop retain visible controls with consistent active/pressed states.
- Make settings responsive: sticky compact header, stacked narrow rows, full-width form fields where needed, 44 px controls, and safe-area/keyboard-aware spacing.

## Mascot usage

- Keep mascots limited to emotionally useful zero states: no workspace, no open note, empty list/trash, and no search results.
- Add the existing search/investigator mascot at a restrained size to the empty harness welcome state.
- Do not use mascots for loading, errors, confirmations, normal editing, or every harness response.
- Add only a small fade/scale entrance that respects reduced motion; no new mascot artwork is required.

## Full harness UX pass

- Rebuild the header hierarchy around session title/switching, New Session, History, and Close, with 44 px touch targets.
- Collapse provider, attached notes, skill, token estimate, and privacy information into a compact context summary that expands on demand.
- Improve transcript presentation:
  - Safely render common Markdown structures without accepting raw HTML.
  - Present tools as compact status rows with running/success/failure states and expandable details.
  - Add a “Jump to latest” control when automatic scrolling pauses.
  - Keep only the recommended output action prominent; place secondary actions in an overflow menu on narrow screens.
- Redesign question and approval cards with clear hierarchy, readable diffs, persistent Apply/Reject controls, target-note labeling, and disabled/running feedback.
- Make session history a popover/side panel on desktop and a full-height sheet on phones, including empty, loading, deletion-confirmation, and failure states.
- Make the prompt keyboard- and safe-area-aware, use at least 16 px input text on phones, preserve multiline drafting, and clearly switch between Send and Stop.
- Tablet harness becomes a scrim-backed bottom sheet with collapsed and expanded snap states; phone harness remains a full pane; desktop remains a spring-open side panel.
- Provide polished zero, missing-key, offline, retry, streaming, stopped, and provider-error states without allowing failures to erase the draft prompt or transcript.

## Interfaces, tests, and acceptance

- Keep `PlatformApi` note mutation signatures unchanged; swipe actions call the existing pin, trash, restore, and permanent-delete operations only after the revealed action is tapped.
- Add internal UI state for open swipe card, phone navigation direction, compact overflow/action sheets, harness context disclosure, tablet sheet position, and reduced-motion behavior. Do not persist transient state.
- Expand Playwright coverage across 390×844 phone, 800×1280 tablet portrait, 1280×800 tablet landscape, and mouse desktop:
  - Swipe direction locking, reveal-without-commit, pin, trash, locked note, restore, and permanent-delete confirmation.
  - Forward/back pane animation without editor remount or caret loss.
  - Long-press action sheet, overflow menus, safe areas, rotation, dark mode, and RTL.
  - Harness history, long responses, tool failures, paused auto-scroll, approval flows, keyboard resizing, session preservation, and reduced motion.
- Add visual checks for light/dark themes and empty/populated states, then run type checks, unit tests, mobile E2E tests, Android Chrome 92 build compatibility, and desktop regression checks.
- Preserve the current in-progress harness logic and data flow while reorganizing its presentation; avoid unrelated sync/provider refactors.
