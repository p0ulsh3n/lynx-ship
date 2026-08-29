package com.lynxship.permissions;

import android.app.Activity;
import android.os.Bundle;

/** Private trampoline so a Lynx module can request an Android runtime permission. */
public final class LynxShipPermissionActivity extends Activity {
    private static final int REQUEST_CODE = 8191;
    private boolean completed;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        String permission = getIntent().getStringExtra("permission");
        String requestId = getIntent().getStringExtra(LynxShipPermissionContract.EXTRA_REQUEST_ID);
        if (permission == null || requestId == null) {
            finishWith("unavailable");
            return;
        }
        if (checkSelfPermission(permission) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            finishWith("granted");
            return;
        }
        requestPermissions(new String[] { permission }, REQUEST_CODE);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQUEST_CODE) return;
        String permission = permissions.length == 0 ? null : permissions[0];
        boolean granted = results.length > 0
                && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
        boolean blocked = !granted && permission != null
                && !shouldShowRequestPermissionRationale(permission);
        finishWith(granted ? "granted" : blocked ? "blocked" : "denied");
    }

    private void finishWith(String result) {
        if (completed) return;
        completed = true;
        LynxShipPermissionContract.sendResult(
                getApplicationContext(),
                getIntent().getStringExtra(LynxShipPermissionContract.EXTRA_REQUEST_ID),
                result);
        finish();
    }
}
