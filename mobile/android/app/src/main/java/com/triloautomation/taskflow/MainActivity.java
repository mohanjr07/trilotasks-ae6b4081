package com.triloautomation.taskflow;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);   // in-app updates (see AppUpdaterPlugin)
        super.onCreate(savedInstanceState);
    }
}
