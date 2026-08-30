package com.lynxship.media;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

/** Android system-picker bridge; the system owns the picker and URI grants. */
public final class LynxShipMediaModule extends LynxModule {
    private final Context moduleContext;
    private final Context applicationContext;
    private final LynxShipAudioRecorder audioRecorder;
    private Callback pendingCallback;
    private BroadcastReceiver resultReceiver;
    private boolean pendingPermission;

    public LynxShipMediaModule(LynxContext lynxContext) {
        super(lynxContext);
        moduleContext = lynxContext.getContext();
        applicationContext = moduleContext.getApplicationContext();
        audioRecorder = new LynxShipAudioRecorder(applicationContext);
    }

    @LynxMethod
    public void getCapabilities(Callback callback) {
        callback.invoke("{\"pickPhoto\":true,\"pickVideo\":true,\"capturePhoto\":true,\"recordAudio\":true}");
    }

    @LynxMethod
    public void requestAccess(String kind, Callback callback) {
        if (callback == null) return;
        if ("photo-library".equals(kind) || "video-library".equals(kind)) {
            callback.invoke(true);
            return;
        }
        if (!"camera".equals(kind) && !"microphone".equals(kind)) {
            callback.invoke(false);
            return;
        }
        String permission = permissionFor(kind);
        if (applicationContext.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
            callback.invoke(true);
            return;
        }
        launch("permission", kind, callback, true);
    }

    @LynxMethod
    public void pick(String kind, Callback callback) {
        if (!"photo-library".equals(kind) && !"video-library".equals(kind)) { callback.invoke(""); return; }
        launch("pick", kind, callback, false);
    }

    @LynxMethod
    public void chooseMedia(String request, Callback callback) {
        if (request == null || request.length() > 16 * 1024) {
            callback.invoke("{\"code\":0,\"msg\":\"Invalid media selection request.\"}");
            return;
        }
        launch("chooseMedia", "", request, callback, false);
    }

    @LynxMethod
    public void capture(String kind, Callback callback) {
        if (!"camera".equals(kind) && !"microphone".equals(kind)) { callback.invoke(""); return; }
        String permission = permissionFor(kind);
        if (applicationContext.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
            callback.invoke("");
            return;
        }
        launch("capture", kind, callback, false);
    }

    @LynxMethod
    public void startRecording(Callback callback) {
        if (applicationContext.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            callback.invoke(false);
            return;
        }
        audioRecorder.start(callback);
    }

    @LynxMethod
    public void stopRecording(Callback callback) {
        audioRecorder.stop(callback);
    }

    @Override public void destroy() {
        clearPending(true);
        audioRecorder.cancel();
        super.destroy();
    }

    private void launch(String mode, String kind, Callback callback, boolean permission) {
        launch(mode, kind, null, callback, permission);
    }

    private void launch(String mode, String kind, String request, Callback callback, boolean permission) {
        if (callback == null) return;
        if (pendingCallback != null) { callback.invoke(permission ? false : ""); return; }
        String requestId = java.util.UUID.randomUUID().toString();
        pendingCallback = callback;
        pendingPermission = permission;
        resultReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (!LynxShipMediaContract.ACTION_RESULT.equals(intent.getAction())
                        || !requestId.equals(intent.getStringExtra(LynxShipMediaContract.EXTRA_REQUEST_ID))) return;
                String value = intent.getStringExtra(LynxShipMediaContract.EXTRA_VALUE);
                Callback pending = pendingCallback;
                boolean isPermission = pendingPermission;
                clearPending(false);
                if (pending != null) pending.invoke(isPermission ? "granted".equals(value) : value == null ? "" : value);
            }
        };
        IntentFilter filter = new IntentFilter(LynxShipMediaContract.ACTION_RESULT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                applicationContext.registerReceiver(resultReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            else applicationContext.registerReceiver(resultReceiver, filter);
            Intent intent = new Intent(applicationContext, LynxShipMediaActivity.class)
                    .putExtra("mode", mode)
                    .putExtra("kind", kind)
                    .putExtra(LynxShipMediaContract.EXTRA_REQUEST_ID, requestId);
            if (request != null) intent.putExtra("request", request);
            if (!(moduleContext instanceof Activity)) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            moduleContext.startActivity(intent);
        } catch (RuntimeException error) {
            clearPending(false);
            callback.invoke(permission ? false : "");
        }
    }

    private String permissionFor(String kind) {
        return "camera".equals(kind) ? android.Manifest.permission.CAMERA : android.Manifest.permission.RECORD_AUDIO;
    }

    private void clearPending(boolean invokeCallback) {
        if (resultReceiver != null) {
            try { applicationContext.unregisterReceiver(resultReceiver); }
            catch (IllegalArgumentException ignored) { }
            resultReceiver = null;
        }
        Callback callback = pendingCallback;
        boolean permission = pendingPermission;
        pendingCallback = null;
        pendingPermission = false;
        if (invokeCallback && callback != null) callback.invoke(permission ? false : "");
    }
}
