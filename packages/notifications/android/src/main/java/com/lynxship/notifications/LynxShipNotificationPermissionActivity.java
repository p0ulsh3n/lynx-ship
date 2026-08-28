package com.lynxship.notifications;

import android.Manifest;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;

/** Isolated Activity used so a pure Lynx module can await Android 13+ consent. */
public final class LynxShipNotificationPermissionActivity extends Activity {
    private static final int REQUEST_CODE = 27041;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_CODE);
        } else {
            LynxShipNotificationsModule.dispatchPermissionResult(true);
            finish();
        }
    }

    @Override
    public void onRequestPermissionsResult(
        int requestCode,
        String[] permissions,
        int[] results
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQUEST_CODE) return;
        boolean granted = results.length > 0
            && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
        LynxShipNotificationsModule.dispatchPermissionResult(granted);
        finish();
    }
}
