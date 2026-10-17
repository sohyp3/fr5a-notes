# fr5a on iOS

Status: the **web/JS side is done** (committed on Linux, works on Android and desktop
unchanged). The **native side is staged** in `packaging/ios/` and needs a Mac + Xcode
to wire up. This file is the handoff: what was implemented here, how to test it, and
exactly what is left for the Mac.

Written 2026-10-17, Capacitor 8.5.2, `@capacitor/ios@8.5.2`.

---

## 1. What was implemented here (Linux)

### Platform plumbing

- `src/renderer/src/lib/platform/api.android.ts` → renamed **`api.capacitor.ts`**,
  `createAndroidPlatform` → **`createCapacitorPlatform`**. It was already
  platform-neutral (Filesystem, Preferences, CapacitorHttp, secure-storage, the
  git shims) — it now reports `platform: Capacitor.getPlatform()` (`'android'`
  or `'ios'`) instead of a hard-coded `'android'`.
- `src/renderer/src/lib/platform/index.ts` now selects that host for **both**
  `'android'` and `'ios'` (before, iOS threw _"no platform implementation
  available"_), and exports **`isMobile`** (true on Android/iOS, derived from the
  chosen host, never true in Electron).
- Every former `platform.platform === 'android'` check now uses `isMobile`, so
  iOS gets the touch UI on day one: touch layout (`App.svelte`), 5 s save
  debounce + no-hover ghost syntax (`stores/app.svelte.ts`), Vim off in the
  editor and hidden in Settings, mobile sync UI in `SyncRepos.svelte`.
- `EncryptionSettings.svelte` names the store per host ("iOS keychain" on iOS,
  "Android Keystore" on Android, "system keyring" on desktop).

### PDF export

- `exportPdf` in `api.capacitor.ts` first calls the native `PdfExport` plugin
  (Android print service / iOS `UIPrintInteractionController`). Until the Swift
  twin is registered, on iOS it falls back to `window.print()` (best effort —
  see §5) instead of failing.

### Packaging

- `@capacitor/ios@^8.5.2` added to `dependencies` (lockfile updated).
- New scripts: `bun run build:ios` (web bundle → `cap sync ios`) and
  `bun run ios` (build + `cap open ios`). The web bundle output `out/android`
  (the `webDir` in `capacitor.config.ts`) is **shared** by both mobile
  platforms — the name is historical, it is not Android-only.
- Staged Mac-only files (see §3):
  `packaging/ios/FileTimesPlugin.swift`, `PdfExportPlugin.swift`,
  `MyViewController.swift`, `PrivacyInfo.xcprivacy`.

### Tests

- `api.capacitor.test.ts` (renamed) mocks `Capacitor.getPlatform()` and asserts
  the host reports `'android'` by default and `'ios'` when Capacitor says so.
- `bun run check`, `bun run test` and the Android web build pass after these
  changes.

### What already worked with zero changes (verified by reading the platform code)

- **Git sync** — isomorphic-git over `@capacitor/filesystem` + `CapacitorHttp`;
  both support iOS. Auth token lives in secure storage → iOS Keychain.
- **Notes on disk** — `Directory.Data` on iOS is the app's **Documents**
  directory, so notes land in `Documents/notes/`. No permissions, no SAF
  equivalent. (Documents is iCloud-backed; see §5.)
- **State** — `Preferences` → `UserDefaults`; **resume** listener fires on iOS
  (`willEnterForegroundNotification`), so the index rebuild on resume works.
- Back-button handler: Android-only, simply never fires on iOS (`App.exitApp`
  is unreachable there — no App Store concern).
- `viewport-fit=cover` + top `env(safe-area-inset-top)` are already in place.
- The `chrome92` + core-js bundle is harmless on modern WKWebView.

---

## 2. Two custom native plugins need Swift twins (staged, not wired)

These are app-local classes registered manually on Android in
`MainActivity.onCreate()`; on iOS the same registration must happen in a custom
view controller:

| Plugin                   | Used by                                                                                         | Swift twin (staged)                   |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------- |
| `FileTimes` (`setMtime`) | git sync (`capFs.ts` `utimes`) — keeps note mtimes across a pull so list order doesn't scramble | `packaging/ios/FileTimesPlugin.swift` |
| `PdfExport` (`print`)    | `exportPdf` — system print UI ("Save as PDF")                                                   | `packaging/ios/PdfExportPlugin.swift` |

Without `FileTimes`, git sync still works (failures are swallowed) but pulled
notes will re-sort to the top. Without `PdfExport`, export falls back to
`window.print()` (unverified — §5).

Why a view controller: Capacitor auto-registers **npm** plugins on iOS from
`packageClassList` in the generated `capacitor.config.json`. Classes that live in
the app target are not in that list, hence
`MyViewController: CAPBridgeViewController` overriding `capacitorDidLoad()` with
`bridge?.registerPluginInstance(…)` — the iOS counterpart of
`MainActivity.registerPlugin(…)`.

---

## 3. Mac checklist (only what needs macOS)

Prereqs: Xcode, CocoaPods (`brew install cocoapods`), bun. Deployment target is
iOS 15 (Capacitor 8 minimum).

1. `bun install` — picks up `@capacitor/ios` (already in `package.json`/lock).
2. `bunx cap add ios` — creates `ios/App` (CocoaPods template; the SPM variant is
   also generated by Cap 8 if you prefer `--packagemanager SPM`).
3. Copy the staged files:
   ```sh
   cp packaging/ios/*.swift packaging/ios/PrivacyInfo.xcprivacy ios/App/App/
   ```
4. `bun run ios` (= web build + `cap sync ios` + `cap open ios`).
5. **In Xcode:**
   - Add the four files just copied to the **App** target: drag them from Finder
     into the `App` group (or File → Add Files…), target membership = App. The
     project is not a folder-synced one, so copying them in is not enough.
   - Edit `ios/App/App/SceneDelegate.swift` (the Cap 8 template sets the root
     controller there, not in `Main.storyboard`):
     ```swift
     window?.rootViewController = MyViewController()
     ```
     (was `CAPBridgeViewController()`).
   - Signing & Capabilities → select your Team. A free Apple ID runs on a
     simulator with no signing, and on your own device with a 7-day profile;
     TestFlight/App Store needs the paid account.
   - Run: pick a simulator → ⌘R; then on your iPhone (iOS 16+: enable
     Settings → Privacy & Security → **Developer Mode** first).
6. Dev loop afterwards: change web code → `bun run build:ios` → re-run in Xcode.
   (`cap sync` copies `out/android` into `ios/App/App/public`.)

### Device smoke test

- Launch empty → create a note → type → force-quit → reopen: note and UI state
  survive.
- Git sync: Settings → Sync → HTTPS clone URL + GitHub PAT token → Pull/Push;
  add a nested repo; "Changes" view; resolve a conflict; check pulled notes
  **keep their list position** (proves `FileTimes` works).
- PDF export from the editor menu: print sheet opens on the rendered note;
  "Save as PDF" through the share sheet works (proves `PdfExport` works).
- Encryption: set up a key, encrypt a note, auto-lock, "Remember passphrase"
  (Keychain), reopen.
- Layout: phone/tablet layout, rotation, top safe area. **Check the bottom
  home-indicator area** (§5).
- Keyboard: typing works, Vim section absent in Settings on the phone, save
  lands ~5 s after typing stops and immediately when switching notes.
- Background the app, change something, foreground: list rebuild on resume.
- Harness/AI (if you use it): API key stored in Keychain, request goes through
  `CapacitorHttp`.

---

## 4. Files touched

```
src/renderer/src/lib/platform/index.ts            (iOS selection + isMobile)
src/renderer/src/lib/platform/api.capacitor.ts    (renamed from api.android.ts)
src/renderer/src/lib/platform/api.capacitor.test.ts (renamed + iOS test)
src/renderer/src/lib/platform/types.ts            (doc)
src/renderer/src/lib/platform/git/capFs.ts        (doc)
src/renderer/src/lib/stores/app.svelte.ts         (isMobile checks)
src/renderer/src/lib/components/Editor.svelte     (isMobile: vim)
src/renderer/src/lib/components/Settings.svelte   (isMobile: vim section)
src/renderer/src/lib/components/SyncRepos.svelte  (isMobile: mobile sync UI)
src/renderer/src/lib/components/EncryptionSettings.svelte (keychain naming)
src/renderer/src/App.svelte                       (isMobile: touch layout)
package.json                                      (+@capacitor/ios, +build:ios, +ios)
packaging/ios/*                                   (new: staged native files)
IOS.md                                            (this file)
```

---

## 5. Known gaps / decisions to revisit (not blockers)

- **`window.print()` fallback is unverified.** Works in modern WKWebView per
  general knowledge, but if export does nothing on iOS before the Swift plugin
  is added, that's this. Once `PdfExportPlugin.swift` is registered, remove or
  keep the fallback as a safety net — or surface an error instead of silently
  doing nothing.
- **Bottom safe area.** Only `padding-top: env(safe-area-inset-top)` exists
  (`App.svelte`). If the bottom bar sits under the home indicator, add
  `padding-bottom: env(safe-area-inset-bottom)` similarly.
- **iCloud backup.** `Directory.Data` = Documents, which **is** backed up to
  iCloud (good for notes, but a change from Android where app data is private).
  If that's not desired, switch the constants in `api.capacitor.ts` to
  `Directory.LibraryNoCloud` (iOS-only mapping; needs a platform branch in
  `DIR`). Decided on purpose? Document it.
- **Keychain survives app uninstall** on iOS (the secure-storage plugin notes
  this). GitHub token / remembered passphrase would remain on the device after
  delete+reinstall. Android's Keystore does not. Consider clearing secrets on
  first run if that bothers you.
- **Privacy manifest.** `packaging/ios/PrivacyInfo.xcprivacy` covers
  `UserDefaults` (CA92.1, `@capacitor/preferences`) and `FileTimestamp`
  (C617.1, `@capacitor/filesystem` + our `FileTimes`). Apple may request more
  categories at submission; the Ionic VS Code extension audits the installed
  plugins.
- **iPad/multitasking, orientation-locked states, print from iPad** (the Swift
  file uses the rect presentation for iPad) — untested until you have the
  device/simulator running.
- The web bundle for iOS still uses the old-WebView target `chrome92`
  (`vite.android.config.ts`). Harmless; a dedicated modern target is optional
  polish.
