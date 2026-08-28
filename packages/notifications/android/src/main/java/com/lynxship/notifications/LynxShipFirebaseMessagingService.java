package com.lynxship.notifications;

import com.google.firebase.messaging.FirebaseMessagingService;

/** Stores no credentials and forwards only token rotation events to Lynx. */
public final class LynxShipFirebaseMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        LynxShipNotificationsModule.dispatchTokenChanged(token);
    }
}
