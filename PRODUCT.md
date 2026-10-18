# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

People who keep a personal library of Markdown notes across desktop, tablet, and phone, and use those notes as durable context for their own thinking and for AI-assisted work.

## Product Purpose

fr5a is a local-first Markdown notes app. It keeps writing fast and direct while making a note library useful as connected memory: people can move between ideas through explicit wiki links and inspect how notes relate without giving up plain files.

## Positioning

Plain Markdown files remain the source of truth. Optional capabilities—including AI, encryption, and linked-note mapping—load only when enabled, so the core editor stays lightweight and understandable.

## Operating Context

- Desktop is used for sustained writing, library-wide exploration, keyboard navigation, and AI-assisted synthesis.
- Tablets are touch-first and favor a focused map with progressive detail rather than a dense desktop workspace.
- Phones are used for quick capture and following nearby links; graph exploration must remain legible, thumb-friendly, and bounded.
- Notes and application state work offline and sync through the existing Git workflow.

## Capabilities and Constraints

- Notes are Markdown files organized in folders and indexed by the host platform.
- Linked notes use wiki-style references and must remain navigable as plain text outside the app.
- The linked-notes feature is optional. While disabled it must mount no UI, run no graph scan or layout work, and register no graph-specific listeners.
- Encrypted and hidden notes retain their existing privacy behavior.
- The feature must preserve the current editor, navigation, theming, accessibility, and platform abstractions.

## Brand Commitments

fr5a uses a quiet, warm, Bear-inspired interface with restrained motion, an accent-tinted palette, and first-class Arabic and English typography.

## Evidence on Hand

- Existing product implementation under `src/renderer/src/`.
- Desktop Electron and Android/iOS Capacitor hosts.
- Representative Markdown content under `sample-notes/`.
- No external claims, testimonials, or benchmark data are available and none should be fabricated.

## Product Principles

- Plain files first: enhancements never trap or obscure the Markdown.
- Quiet by default: optional power should cost nothing while switched off.
- Context over spectacle: connections help people understand and navigate their notes.
- Device-native focus: show the right amount of the network for the screen and input method.
- Private and local by default: existing note visibility and encryption rules are preserved.

## Accessibility & Inclusion

Keyboard navigation, visible focus, reduced motion, 44–48 px touch targets, light/dark themes, and mixed English/Arabic note content are established requirements.
