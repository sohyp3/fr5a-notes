import Foundation
import Capacitor

/**
 * Swift twin of `android/app/src/main/java/com/fr5a/notes/FileTimesPlugin.java`.
 *
 * Sets a file's modified time, which Capacitor's Filesystem plugin can't. Git
 * sync uses it to keep a note's time across a pull: the merge rewrites the
 * file, and the new mtime would otherwise sort it to the top of the list.
 * (`capFs.ts` calls this through `fs.promises.utimes`; a failure is
 * non-fatal — times are just not preserved.)
 *
 * Paths are relative to app storage: iOS's `Directory.Data` is the app's
 * Documents directory (`Library/NoCloud` is `Directory.LibraryNoCloud`).
 *
 * Register with the bridge in `MyViewController.swift`.
 */
@objc(FileTimesPlugin)
public class FileTimesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FileTimesPlugin"
    public let jsName = "FileTimes"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setMtime", returnType: CAPPluginReturnPromise)
    ]

    /// Filesystem's `Directory.Data` on iOS: the app's own Documents directory.
    private var dataDir: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    @objc func setMtime(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let mtime = call.getDouble("mtime") else {
            call.reject("path and mtime are required")
            return
        }
        // `standardized` folds `..` away before the containment check; never
        // touch anything outside the app's own storage.
        let base = dataDir.standardizedFileURL
        let file = base.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(base.path + "/") else {
            call.reject("Path is outside app storage")
            return
        }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir),
              !isDir.boolValue
        else {
            call.reject("File does not exist")
            return
        }
        do {
            // JS sends epoch milliseconds (a Double); Date wants seconds.
            try FileManager.default.setAttributes(
                [.modificationDate: Date(timeIntervalSince1970: mtime / 1000)],
                ofItemAtPath: file.path
            )
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }
}
