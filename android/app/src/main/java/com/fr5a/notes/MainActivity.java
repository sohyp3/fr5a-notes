package com.fr5a.notes;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins register before the bridge starts.
        registerPlugin(FileTimesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
