package com.fr5a.notes;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opens Android's system print UI for the currently rendered note. */
@CapacitorPlugin(name = "PdfExport")
public class PdfExportPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String jobName = call.getString("jobName", "fr5a note");
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager manager =
                    (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) {
                    call.reject("Printing is unavailable on this device");
                    return;
                }
                PrintDocumentAdapter adapter =
                    getBridge().getWebView().createPrintDocumentAdapter(jobName);
                manager.print(jobName, adapter, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "Could not open print dialog");
            }
        });
    }
}
