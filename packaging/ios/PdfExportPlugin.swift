import UIKit
import Capacitor
import WebKit

/**
 * Swift twin of `android/app/src/main/java/com/fr5a/notes/PdfExportPlugin.java`.
 *
 * Opens iOS's print UI for the currently rendered note. iOS's print sheet
 * doubles as "Save as PDF" (share sheet) and AirPrint, so nothing is written
 * to disk here — same contract as Android: JS gets `'opened'` back and tells
 * the user to pick "Save as PDF".
 *
 * Register with the bridge in `MyViewController.swift`.
 */
@objc(PdfExportPlugin)
public class PdfExportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PdfExportPlugin"
    public let jsName = "PdfExport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise)
    ]

    @objc func print(_ call: CAPPluginCall) {
        let jobName = call.getString("jobName") ?? "fr5a note"
        DispatchQueue.main.async {
            guard let webView = self.webView else {
                call.reject("No web view")
                return
            }
            let printInfo = UIPrintInfo(dictionary: nil)
            printInfo.jobName = jobName
            printInfo.outputType = .general
            let controller = UIPrintInteractionController.shared
            controller.printInfo = printInfo
            // WKWebView's formatter paginates the whole document, not only
            // the visible part.
            controller.printFormatter = webView.viewPrintFormatter()
            let done: (UIPrintInteractionController, Bool, Error?) -> Void = { _, _, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve()
                }
            }
            if let view = self.bridge?.viewController?.view {
                // The rect form works on iPhone too (the rect is ignored there)
                // and is the only reliable one on iPad.
                controller.present(from: view.bounds, in: view, animated: true, completionHandler: done)
            } else {
                controller.present(animated: true, completionHandler: done)
            }
        }
    }
}
