package com.booksaloon.app;

import android.content.Intent;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(QueueNotificationPlugin.class);
        super.onCreate(savedInstanceState);
        handleNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge().getWebView();
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        String bookingId = intent.getStringExtra("bookingId");
        if (bookingId == null || !bookingId.matches("[0-9a-fA-F-]{36}")) {
            return;
        }
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }
        String route = "/customer/queue/" + bookingId;
        webView.postDelayed(() -> webView.evaluateJavascript(
                "window.history.pushState({}, '', '" + route + "');" +
                        "window.dispatchEvent(new PopStateEvent('popstate'));",
                null), 500);
    }
}
