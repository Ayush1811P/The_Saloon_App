package com.booksaloon.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(QueueNotificationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
