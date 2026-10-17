# iOS native files (staged)

These files are copied into the iOS project after `npx cap add ios` on a Mac:

- `FileTimesPlugin.swift` — `FileTimes.setMtime` (git sync keeps note mtimes).
- `PdfExportPlugin.swift` — `PdfExport.print` (system print / Save as PDF).
- `MyViewController.swift` — registers both with the bridge; point
  `SceneDelegate.swift` at it (`window?.rootViewController = MyViewController()`).
- `PrivacyInfo.xcprivacy` — required-reason API declarations for App Store
  submission (UserDefaults + file timestamps).

Full instructions, test checklist and open questions: `IOS.md` at the repo root.
