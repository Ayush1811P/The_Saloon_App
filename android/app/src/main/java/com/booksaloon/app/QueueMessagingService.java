package com.booksaloon.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class QueueMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        String title = message.getData().getOrDefault("title", "BOOKSALOON queue update");
        String body = message.getData().getOrDefault("body", "Your queue status changed.");
        int progress = 0;
        try {
            progress = Integer.parseInt(message.getData().getOrDefault("progress", "0"));
        } catch (NumberFormatException ignored) {
            // Invalid progress is safely represented as zero.
        }
        long estimatedStartAt = 0;
        try {
            estimatedStartAt = Long.parseLong(message.getData().getOrDefault("estimatedStartAt", "0"));
        } catch (NumberFormatException ignored) {
            // Invalid timestamps do not enable the notification countdown.
        }
        long startedAt = 0;
        try {
            startedAt = Long.parseLong(message.getData().getOrDefault("startedAt", "0"));
        } catch (NumberFormatException ignored) {
            // Invalid timestamps leave the notification timer anchored to receipt time.
        }
        String bookingId = message.getData().getOrDefault("bookingId", "");
        QueueNotificationPlugin.postQueueNotification(this, title, body, progress, bookingId, estimatedStartAt, startedAt);
    }
}
