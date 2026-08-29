package com.lynxship.notifications;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import java.util.UUID;

/**
 * Process-independent Android state for the notification bridge.
 *
 * FCM can call its service while no Lynx module exists. Persisting the token
 * first and notifying only active module instances avoids a static callback
 * registry and makes the next registration authoritative after process death.
 */
final class LynxShipNotificationsStore {
    static final String ACTION_TOKEN_CHANGED =
            "com.lynxship.notifications.action.TOKEN_CHANGED";
    static final String ACTION_PERMISSION_RESULT =
            "com.lynxship.notifications.action.PERMISSION_RESULT";
    static final String EXTRA_TOKEN = "token";
    static final String EXTRA_REQUEST_ID = "requestId";
    static final String EXTRA_GRANTED = "granted";

    private static final String PREFERENCES = "lynxship.notifications";
    private static final String TOKEN = "fcm-token";

    private LynxShipNotificationsStore() {}

    static String readToken(Context context) {
        return preferences(context).getString(TOKEN, "");
    }

    static void saveToken(Context context, String token) {
        if (token == null) return;
        String normalized = token.trim();
        if (normalized.isEmpty() || normalized.length() > 4096
                || normalized.indexOf('\n') >= 0 || normalized.indexOf('\r') >= 0) return;
        SharedPreferences preferences = preferences(context);
        if (normalized.equals(preferences.getString(TOKEN, ""))) return;
        preferences.edit().putString(TOKEN, normalized).apply();
        Intent changed = new Intent(ACTION_TOKEN_CHANGED)
                .setPackage(context.getPackageName())
                .putExtra(EXTRA_TOKEN, normalized);
        context.sendBroadcast(changed);
    }

    static String newRequestId() {
        return UUID.randomUUID().toString();
    }

    static void sendPermissionResult(Context context, String requestId, boolean granted) {
        if (requestId == null || requestId.trim().isEmpty()) return;
        Intent result = new Intent(ACTION_PERMISSION_RESULT)
                .setPackage(context.getPackageName())
                .putExtra(EXTRA_REQUEST_ID, requestId)
                .putExtra(EXTRA_GRANTED, granted);
        context.sendBroadcast(result);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext()
                .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }
}
