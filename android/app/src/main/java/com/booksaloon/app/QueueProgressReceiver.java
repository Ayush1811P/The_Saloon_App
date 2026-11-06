package com.booksaloon.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class QueueProgressReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        QueueNotificationPlugin.refreshProgressNotification(context);
    }
}
