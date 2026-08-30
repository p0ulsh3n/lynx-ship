package com.lynxship.bridge;

import com.lynx.react.bridge.Callback;

/**
 * Application-owned bridge implementation. The application must enforce its
 * own method allowlist, capability checks and thread policy before executing a
 * request. The LynxShip module only provides the bounded transport boundary.
 */
public interface LynxShipBridgeHost {
    boolean invoke(String requestJson, Callback callback);

    default boolean subscribe(String event, Callback callback) {
        return false;
    }

    default void unsubscribe(String event) {}
}
