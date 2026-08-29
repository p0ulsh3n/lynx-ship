package com.lynxship.notifications;

import com.google.firebase.messaging.FirebaseMessagingService;

/** Stores no credentials and forwards only token rotation events to Lynx. */
public final class LynxShipFirebaseMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        // This callback returns the send-to-device token used by FCM payloads.
        // onRegistered is an FID callback and is not a replacement for it.
        LynxShipNotificationsStore.saveToken(getApplicationContext(), token);
    }
}
