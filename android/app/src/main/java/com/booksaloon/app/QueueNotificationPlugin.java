package com.booksaloon.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ApplicationInfo;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.google.firebase.FirebaseApp;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "QueueNotification")
public class QueueNotificationPlugin extends Plugin {
    public static final int NOTIFICATION_ID = 1041;
    private static final int STATUS_NOTIFICATION_ID = 1042;
    public static final String CHANNEL_ID = "booksaloon_queue";
    private static final String PREFS = "booksaloon_queue_notification";
    private static final String PROGRESS_ACTION = "com.booksaloon.app.UPDATE_QUEUE_PROGRESS";
    private static final int APP_UPDATE_REQUEST_CODE = 1043;
    private static final String[][] RIDE_APPS = {
            {"uber", "com.ubercab"},
            {"ola", "com.olacabs.customer"},
            {"rapido", "com.rapido.passenger"}
    };

    @PluginMethod
    public void checkAppUpdate(PluginCall call) {
        AppUpdateManager manager = AppUpdateManagerFactory.create(getContext());
        manager.getAppUpdateInfo()
                .addOnSuccessListener(info -> call.resolve(appUpdateResult(info)))
                .addOnFailureListener(error -> call.reject("Unable to check Google Play for an app update.", error));
    }

    @PluginMethod
    public void startAppUpdate(PluginCall call) {
        AppUpdateManager manager = AppUpdateManagerFactory.create(getContext());
        manager.getAppUpdateInfo()
                .addOnSuccessListener(info -> {
                    if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE
                            || !info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                        call.reject("No Google Play update is currently available.");
                        return;
                    }
                    try {
                        boolean started = manager.startUpdateFlowForResult(
                                info, AppUpdateType.IMMEDIATE, getActivity(), APP_UPDATE_REQUEST_CODE);
                        if (started) {
                            call.resolve();
                        } else {
                            call.reject("Google Play could not start the app update.");
                        }
                    } catch (Exception error) {
                        call.reject("Unable to start the Google Play app update.", error);
                    }
                })
                .addOnFailureListener(error -> call.reject("Unable to check Google Play for an app update.", error));
    }

    private static JSObject appUpdateResult(AppUpdateInfo info) {
        boolean available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE);
        JSObject result = new JSObject();
        result.put("available", available);
        result.put("availableVersionCode", info.availableVersionCode());
        return result;
    }

    @PluginMethod
    public void getRideApps(PluginCall call) {
        PackageManager packageManager = getContext().getPackageManager();
        JSArray apps = new JSArray();
        for (String[] rideApp : RIDE_APPS) {
            try {
                ApplicationInfo info = packageManager.getApplicationInfo(rideApp[1], 0);
                JSObject app = new JSObject();
                app.put("id", rideApp[0]);
                app.put("name", packageManager.getApplicationLabel(info).toString());
                apps.put(app);
            } catch (PackageManager.NameNotFoundException ignored) {
                // Apps that are not installed are intentionally omitted from the native list.
            }
        }
        JSObject result = new JSObject();
        result.put("apps", apps);
        call.resolve(result);
    }

    @PluginMethod
    public void openRideApp(PluginCall call) {
        String appId = call.getString("appId", "");
        double latitude = call.getDouble("latitude", Double.NaN);
        double longitude = call.getDouble("longitude", Double.NaN);
        String address = call.getString("address", "");
        String packageName = packageForRideApp(appId);
        if (packageName == null || !Double.isFinite(latitude) || !Double.isFinite(longitude)) {
            call.reject("A supported ride app and salon location are required.");
            return;
        }

        PackageManager packageManager = getContext().getPackageManager();
        Intent launchIntent = packageManager.getLaunchIntentForPackage(packageName);
        if (launchIntent == null) {
            call.reject("This ride app is no longer installed.");
            return;
        }

        try {
            Intent destinationIntent = new Intent(Intent.ACTION_VIEW, rideAppUri(appId, latitude, longitude, address));
            destinationIntent.setPackage(packageName);
            destinationIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(destinationIntent);
        } catch (Exception linkError) {
            launchIntent.putExtra("destination_latitude", latitude);
            launchIntent.putExtra("destination_longitude", longitude);
            launchIntent.putExtra("destination_address", address);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(launchIntent);
            } catch (Exception launchError) {
                call.reject("Unable to open the selected ride app.", launchError);
                return;
            }
        }
        call.resolve();
    }

    private static String packageForRideApp(String appId) {
        for (String[] rideApp : RIDE_APPS) {
            if (rideApp[0].equals(appId)) return rideApp[1];
        }
        return null;
    }

    private static Uri rideAppUri(String appId, double latitude, double longitude, String address) {
        if ("uber".equals(appId)) {
            return Uri.parse("uber://").buildUpon()
                    .appendQueryParameter("action", "setPickup")
                    .appendQueryParameter("pickup", "my_location")
                    .appendQueryParameter("dropoff[latitude]", String.valueOf(latitude))
                    .appendQueryParameter("dropoff[longitude]", String.valueOf(longitude))
                    .build();
        }
        String url = "ola".equals(appId) ? "https://book.olacabs.com/" : "https://www.rapido.bike/";
        return Uri.parse(url).buildUpon()
                .appendQueryParameter("drop_lat", String.valueOf(latitude))
                .appendQueryParameter("drop_lng", String.valueOf(longitude))
                .appendQueryParameter("drop_name", address)
                .build();
    }

    @PluginMethod
    public void isConfigured(PluginCall call) {
        JSObject result = new JSObject();
        result.put("configured", !FirebaseApp.getApps(getContext()).isEmpty());
        call.resolve(result);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "BOOKSALOON queue");
        String body = call.getString("body", "Your queue status changed.");
        int progress = Math.max(0, Math.min(100, call.getInt("progress", 0)));
        String bookingId = call.getString("bookingId", "");
        long estimatedStartAt = call.getLong("estimatedStartAt", 0L);
        long startedAt = call.getLong("startedAt", 0L);
        postQueueNotification(getContext(), title, body, progress, bookingId, estimatedStartAt, startedAt);
        call.resolve();
    }

    @PluginMethod
    public void showStatus(PluginCall call) {
        Context context = getContext();
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            call.reject("Notification permission is disabled.");
            return;
        }
        String title = call.getString("title", "BOOKSALOON appointment status");
        String body = call.getString("body", "Your appointment status changed.");
        String bookingId = call.getString("bookingId", "");
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "BOOKSALOON queue", NotificationManager.IMPORTANCE_HIGH);
            manager.createNotificationChannel(channel);
        }
        Intent intent = new Intent(context, MainActivity.class);
        intent.putExtra("bookingId", bookingId);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context, STATUS_NOTIFICATION_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(com.booksaloon.app.R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH);
        NotificationManagerCompat.from(context).notify(STATUS_NOTIFICATION_ID, notification.build());
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Context context = getContext();
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
        cancelProgressUpdates(context);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        call.resolve();
    }

    public static void postQueueNotification(Context context, String title, String body, int progress, String bookingId, long estimatedStartAt, long startedAt) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String previousBookingId = preferences.getString("bookingId", "");
        boolean sameBooking = bookingId.equals(previousBookingId);
        long previousStartedAt = sameBooking ? preferences.getLong("startedAt", 0L) : 0L;
        long previousEstimatedStartAt = sameBooking ? preferences.getLong("estimatedStartAt", 0L) : 0L;
        int previousProgress = progressForBooking(
                bookingId, previousBookingId, preferences.getInt("progress", 0));
        long now = System.currentTimeMillis();
        long notificationStartedAt = startedAt > 0 ? startedAt : now;
        if (sameBooking && previousStartedAt > 0) {
            notificationStartedAt = Math.min(notificationStartedAt, previousStartedAt);
        }
        if (estimatedStartAt <= 0) estimatedStartAt = previousEstimatedStartAt;
        preferences.edit()
                .putString("title", title)
                .putString("body", body)
                .putString("bookingId", bookingId)
                .putLong("startedAt", notificationStartedAt)
                .putLong("estimatedStartAt", estimatedStartAt)
                .apply();

        if (estimatedStartAt > notificationStartedAt && now < estimatedStartAt) {
            int timedProgress = (int) Math.min(100, Math.max(0, (now - notificationStartedAt) * 100 / (estimatedStartAt - notificationStartedAt)));
            progress = Math.max(progress, Math.max(previousProgress, timedProgress));
            scheduleProgressUpdate(context);
        } else {
            if (estimatedStartAt > 0 && now >= estimatedStartAt) progress = 100;
            cancelProgressUpdates(context);
        }
        preferences.edit().putInt("progress", progress).apply();

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "BOOKSALOON queue", NotificationManager.IMPORTANCE_HIGH);
            manager.createNotificationChannel(channel);
        }
        Intent intent = new Intent(context, MainActivity.class);
        intent.putExtra("bookingId", bookingId);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context, NOTIFICATION_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(com.booksaloon.app.R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setProgress(100, progress, false);
        if (estimatedStartAt > System.currentTimeMillis()) {
            notification.setWhen(estimatedStartAt)
                    .setUsesChronometer(true)
                    .setChronometerCountDown(true);
        }
        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification.build());
    }

    static void refreshProgressNotification(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String bookingId = preferences.getString("bookingId", "");
        long startedAt = preferences.getLong("startedAt", 0L);
        long estimatedStartAt = preferences.getLong("estimatedStartAt", 0L);
        if (startedAt <= 0 || estimatedStartAt <= 0) return;
        long duration = estimatedStartAt - startedAt;
        int progress = duration <= 0
                ? 100
                : (int) Math.min(100, Math.max(0, (System.currentTimeMillis() - startedAt) * 100 / duration));
        postQueueNotification(
                context,
                preferences.getString("title", "BOOKSALOON queue"),
                preferences.getString("body", "Your queue status changed."),
                progress,
                bookingId,
                estimatedStartAt,
                startedAt
        );
    }

    private static void scheduleProgressUpdate(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        Intent intent = new Intent(context, QueueProgressReceiver.class).setAction(PROGRESS_ACTION);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context, NOTIFICATION_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 60_000, pendingIntent);
    }

    private static void cancelProgressUpdates(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, QueueProgressReceiver.class).setAction(PROGRESS_ACTION);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context, NOTIFICATION_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        if (alarmManager != null) alarmManager.cancel(pendingIntent);
    }

    static int progressForBooking(String bookingId, String previousBookingId, int previousProgress) {
        return bookingId.equals(previousBookingId) ? previousProgress : 0;
    }
}
