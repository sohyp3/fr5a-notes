package com.fr5a.notes;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;

/**
 * Sets a file's modified time, which Capacitor's Filesystem plugin can't. Git
 * sync uses it to keep a note's time across a pull (the merge rewrites the
 * file, and the new mtime would sort it to the top of the list). Paths are
 * relative to app-private storage (Filesystem's Directory.Data).
 */
@CapacitorPlugin(name = "FileTimes")
public class FileTimesPlugin extends Plugin {

    @PluginMethod
    public void setMtime(PluginCall call) {
        String path = call.getString("path");
        // Epoch milliseconds arrive as a Long (too big for an int), which getDouble() skips.
        Object mtime = call.getData().opt("mtime");
        if (path == null || !(mtime instanceof Number)) {
            call.reject("path and mtime are required");
            return;
        }
        File base = getContext().getFilesDir();
        File file = new File(base, path);
        try {
            if (!file.getCanonicalPath().startsWith(base.getCanonicalPath() + File.separator)) {
                call.reject("Path is outside app storage");
                return;
            }
        } catch (IOException e) {
            call.reject(e.getMessage());
            return;
        }
        if (!file.isFile()) {
            call.reject("File does not exist");
            return;
        }
        if (!file.setLastModified(((Number) mtime).longValue())) {
            call.reject("Could not set the modified time");
            return;
        }
        call.resolve();
    }
}
