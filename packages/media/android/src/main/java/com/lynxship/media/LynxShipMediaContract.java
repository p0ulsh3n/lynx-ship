package com.lynxship.media;

import android.content.Context;
import android.content.Intent;

/** Private, explicit result contract between the system-media activity and its module instance. */
final class LynxShipMediaContract {
    static final String ACTION_RESULT = "com.lynxship.media.action.RESULT";
    static final String EXTRA_REQUEST_ID = "requestId";
    static final String EXTRA_VALUE = "value";

    private LynxShipMediaContract() {}

    static void sendResult(Context context, String requestId, String value) {
        if (requestId == null || requestId.isEmpty()) return;
        context.sendBroadcast(new Intent(ACTION_RESULT)
                .setPackage(context.getPackageName())
                .putExtra(EXTRA_REQUEST_ID, requestId)
                .putExtra(EXTRA_VALUE, value == null ? "" : value));
    }
}
