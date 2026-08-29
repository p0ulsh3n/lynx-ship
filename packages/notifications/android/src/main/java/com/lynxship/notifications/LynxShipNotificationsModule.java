package com.lynxship.notifications;

import android.Manifest;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.google.firebase.messaging.FirebaseMessaging;
import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxNativeModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;
import com.lynxship.notifications.generated.LynxShipNotificationsSpec;

/** Direct Android FCM bridge for pure Lynx applications. */
@LynxNativeModule(name = "LynxShipNotifications")
public final class LynxShipNotificationsModule extends LynxShipNotificationsSpec {
    private final Context hostContext;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Callback pendingPermission;
    private BroadcastReceiver permissionReceiver;
    private Callback tokenCallback;
    private BroadcastReceiver tokenReceiver;

    public LynxShipNotificationsModule(LynxContext context) {
        super(context);
        hostContext = context.getContext().getApplicationContext();
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
        if (callback == null) return;
        mainHandler.post(() -> requestPermissionOnMain(callback));
    }

    @Override
    public String getToken() {
        return LynxShipNotificationsStore.readToken(hostContext());
    }

    @LynxMethod
    public void getTokenAsync(Callback callback) {
        if (callback == null) return;
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) {
                    callback.invoke("");
                    return;
                }
                String token = task.getResult();
                LynxShipNotificationsStore.saveToken(hostContext(), token);
                callback.invoke(token);
            });
        } catch (RuntimeException ignored) {
            // Firebase is unavailable until the host supplies its application config.
            callback.invoke("");
        }
    }

    @LynxMethod
    public void subscribeTokenChanges(Object callbackValue) {
        if (!(callbackValue instanceof Callback)) return;
        clearTokenChangeListeners();
        tokenCallback = (Callback) callbackValue;
        tokenReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (!LynxShipNotificationsStore.ACTION_TOKEN_CHANGED.equals(intent.getAction())) return;
                String token = intent.getStringExtra(LynxShipNotificationsStore.EXTRA_TOKEN);
                if (token != null && tokenCallback != null)
                    mainHandler.post(() -> tokenCallback.invoke(token));
            }
        };
        IntentFilter filter = new IntentFilter(LynxShipNotificationsStore.ACTION_TOKEN_CHANGED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            hostContext.registerReceiver(tokenReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else hostContext.registerReceiver(tokenReceiver, filter);
    }

    @Override
    public void clearTokenChangeListeners() {
        if (tokenReceiver != null) {
            try { hostContext.unregisterReceiver(tokenReceiver); }
            catch (IllegalArgumentException ignored) { }
            tokenReceiver = null;
        }
        tokenCallback = null;
    }

    @Override
    public void destroy() {
        clearTokenChangeListeners();
        clearPermissionReceiver(true);
        super.destroy();
    }

    private void requestPermissionOnMain(Callback callback) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            callback.invoke(isPermissionGranted());
            return;
        }
        if (isPermissionGranted()) {
            callback.invoke(true);
            return;
        }
        if (pendingPermission != null) {
            callback.invoke(false);
            return;
        }
        String requestId = LynxShipNotificationsStore.newRequestId();
        pendingPermission = callback;
        permissionReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (!LynxShipNotificationsStore.ACTION_PERMISSION_RESULT.equals(intent.getAction())
                        || !requestId.equals(intent.getStringExtra(LynxShipNotificationsStore.EXTRA_REQUEST_ID))) return;
                boolean granted = intent.getBooleanExtra(LynxShipNotificationsStore.EXTRA_GRANTED, false);
                Callback result = pendingPermission;
                clearPermissionReceiver(false);
                if (result != null) result.invoke(granted);
            }
        };
        IntentFilter filter = new IntentFilter(LynxShipNotificationsStore.ACTION_PERMISSION_RESULT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                hostContext.registerReceiver(permissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            else hostContext.registerReceiver(permissionReceiver, filter);
            hostContext.startActivity(new Intent(hostContext, LynxShipNotificationPermissionActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(LynxShipNotificationsStore.EXTRA_REQUEST_ID, requestId));
        } catch (RuntimeException error) {
            clearPermissionReceiver(false);
            callback.invoke(false);
        }
    }

    private boolean isPermissionGranted() {
        Context context = hostContext();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            return manager != null && manager.areNotificationsEnabled();
        }
        return context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
    }

    private void clearPermissionReceiver(boolean invokePending) {
        if (permissionReceiver != null) {
            try { hostContext.unregisterReceiver(permissionReceiver); }
            catch (IllegalArgumentException ignored) { }
            permissionReceiver = null;
        }
        Callback callback = pendingPermission;
        pendingPermission = null;
        if (invokePending && callback != null) callback.invoke(false);
    }
}
