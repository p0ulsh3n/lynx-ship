package com.lynxship.notifications;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.google.firebase.messaging.FirebaseMessaging;
import com.lynx.jsbridge.LynxNativeModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;
import com.lynxship.notifications.generated.LynxShipNotificationsSpec;

import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;

/** Direct Android FCM bridge for pure Lynx applications. */
@LynxNativeModule(name = "LynxShipNotifications")
public final class LynxShipNotificationsModule extends LynxShipNotificationsSpec {
    private final Context hostContext;
    private static final AtomicReference<Callback> pendingPermission = new AtomicReference<>();
    private static final CopyOnWriteArrayList<Callback> tokenListeners = new CopyOnWriteArrayList<>();
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());

    public LynxShipNotificationsModule(LynxContext context) {
        super(context);
        hostContext = context.getContext();
    }

    private Context hostContext() {
        return hostContext;
    }

    @Override
    public boolean requestPermission() {
        return isPermissionGranted();
    }

    @LynxMethod
    public void requestPermissionAsync(Callback callback) {
        Context context = hostContext();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            callback.invoke(manager == null || manager.areNotificationsEnabled());
            return;
        }
        if (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) {
            callback.invoke(true);
            return;
        }
        if (!(context instanceof Activity)) {
            callback.invoke(false);
            return;
        }
        pendingPermission.set(callback);
        context.startActivity(
            new Intent(context, LynxShipNotificationPermissionActivity.class));
    }

    @Override
    public String getToken() {
        return "";
    }

    @LynxMethod
    public void getTokenAsync(Callback callback) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) {
                    callback.invoke("");
                    return;
                }
                callback.invoke(task.getResult());
            });
        } catch (RuntimeException ignored) {
            // Firebase is unavailable until the host supplies its application config.
            callback.invoke("");
        }
    }

    @LynxMethod
    public void subscribeTokenChanges(Object callbackValue) {
        Callback callback = (Callback) callbackValue;
        tokenListeners.addIfAbsent(callback);
    }

    @Override
    public void clearTokenChangeListeners() {
        tokenListeners.clear();
    }

    private boolean isPermissionGranted() {
        Context context = hostContext();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            return manager == null || manager.areNotificationsEnabled();
        }
        return context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
    }

    static void dispatchPermissionResult(boolean granted) {
        Callback callback = pendingPermission.getAndSet(null);
        if (callback != null) {
            MAIN_HANDLER.post(() -> callback.invoke(granted));
        }
    }

    static void dispatchTokenChanged(String token) {
        if (token == null || token.trim().isEmpty()) return;
        MAIN_HANDLER.post(() -> {
            for (Callback callback : tokenListeners) callback.invoke(token);
        });
    }
}
