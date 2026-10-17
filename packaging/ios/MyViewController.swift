import UIKit
import Capacitor

/**
 * The bridge's view controller, with the app-local plugins registered.
 *
 * npm plugins (Filesystem, Preferences, App, SecureStorage) are registered
 * automatically from `packageClassList` in the generated
 * `capacitor.config.json`; classes that live in the app target are not, so
 * they must be registered here. This is the iOS counterpart of
 * `MainActivity.onCreate()` registering them on Android.
 *
 * Then point `SceneDelegate.swift` at this class:
 *
 *     window?.rootViewController = MyViewController()
 */
class MyViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(FileTimesPlugin())
        bridge?.registerPluginInstance(PdfExportPlugin())
    }
}
