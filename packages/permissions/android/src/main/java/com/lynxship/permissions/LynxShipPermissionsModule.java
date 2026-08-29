package com.lynxship.permissions;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

/** Android permission bridge; the operating system remains the authority. */
public final class LynxShipPermissionsModule extends LynxModule {
    private final Context moduleContext;
    private final Context applicationContext;
    private Callback pendingCallback;
    private BroadcastReceiver resultReceiver;

    public LynxShipPermissionsModule(LynxContext lynxContext) {
        super(lynxContext);
        moduleContext = lynxContext.getContext();
        applicationContext = moduleContext.getApplicationContext();
    }

    private String androidPermission(String name) {
        if (name == null) return null;
        if ("camera".equals(name)) return android.Manifest.permission.CAMERA;
        if ("microphone".equals(name) || "audio".equals(name)) return android.Manifest.permission.RECORD_AUDIO;
        if ("notifications".equals(name)) return Build.VERSION.SDK_INT >= 33 ? android.Manifest.permission.POST_NOTIFICATIONS : null;
        return name.startsWith("android.permission.") ? name : null;
    }

    private boolean wasRequested(String permission) {
        return applicationContext.getSharedPreferences("lynxship.permissions", Context.MODE_PRIVATE)
                .getBoolean("requested." + permission, false);
    }

    private String deniedState(String permission) {
        if (moduleContext instanceof Activity
                && wasRequested(permission)
                && !((Activity) moduleContext).shouldShowRequestPermissionRationale(permission)) {
            return "blocked";
        }
        return "denied";
    }

    @LynxMethod
    public void checkPermission(String name, Callback callback) {
        String permission = androidPermission(name);
        if (permission == null) { callback.invoke("notifications".equals(name) ? "granted" : "unavailable"); return; }
        callback.invoke(applicationContext.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
                ? "granted" : deniedState(permission));
    }

    @LynxMethod
    public void requestPermission(String name, Callback callback) {
        if (callback == null) return;
        String permission = androidPermission(name);
        if (permission == null) { callback.invoke("notifications".equals(name) ? "granted" : "unavailable"); return; }
        if (applicationContext.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) { callback.invoke("granted"); return; }
        if (pendingCallback != null) { callback.invoke("unavailable"); return; }

        String requestId = java.util.UUID.randomUUID().toString();
        pendingCallback = callback;
        applicationContext.getSharedPreferences("lynxship.permissions", Context.MODE_PRIVATE)
                .edit().putBoolean("requested." + permission, true).apply();
        resultReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (!LynxShipPermissionContract.ACTION_RESULT.equals(intent.getAction())
                        || !requestId.equals(intent.getStringExtra(LynxShipPermissionContract.EXTRA_REQUEST_ID))) return;
                String result = intent.getStringExtra(LynxShipPermissionContract.EXTRA_STATE);
                Callback pending = pendingCallback;
                clearPending(false);
                if (pending != null) pending.invoke(result == null ? "unavailable" : result);
            }
        };
        IntentFilter filter = new IntentFilter(LynxShipPermissionContract.ACTION_RESULT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                applicationContext.registerReceiver(resultReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            else applicationContext.registerReceiver(resultReceiver, filter);
            Intent intent = new Intent(applicationContext, LynxShipPermissionActivity.class)
                    .putExtra("permission", permission)
                    .putExtra(LynxShipPermissionContract.EXTRA_REQUEST_ID, requestId);
            if (!(moduleContext instanceof Activity)) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            moduleContext.startActivity(intent);
        } catch (RuntimeException error) {
            clearPending(false);
            callback.invoke("unavailable");
        }
    }

    @LynxMethod
    public void openSettings(Callback callback) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + applicationContext.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            applicationContext.startActivity(intent);
            if (callback != null) callback.invoke(true);
        } catch (RuntimeException error) { if (callback != null) callback.invoke(false); }
    }

    @Override public void destroy() {
        clearPending(true);
        super.destroy();
    }

    private void clearPending(boolean invokeCallback) {
        if (resultReceiver != null) {
            try { applicationContext.unregisterReceiver(resultReceiver); }
            catch (IllegalArgumentException ignored) { }
            resultReceiver = null;
        }
        Callback callback = pendingCallback;
        pendingCallback = null;
        if (invokeCallback && callback != null) callback.invoke("unavailable");
    }
}
