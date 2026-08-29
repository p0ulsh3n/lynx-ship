package com.lynxship.permissions;

import android.content.Context;
import android.content.Intent;

/** Private, explicit broadcast contract between the permission activity and module instance. */
final class LynxShipPermissionContract {
    static final String ACTION_RESULT = "com.lynxship.permissions.action.RESULT";
    static final String EXTRA_REQUEST_ID = "requestId";
    static final String EXTRA_STATE = "state";

    private LynxShipPermissionContract() {}

    static void sendResult(Context context, String requestId, String state) {
        if (requestId == null || requestId.isEmpty()) return;
        context.sendBroadcast(new Intent(ACTION_RESULT)
                .setPackage(context.getPackageName())
                .putExtra(EXTRA_REQUEST_ID, requestId)
                .putExtra(EXTRA_STATE, state));
    }
}
