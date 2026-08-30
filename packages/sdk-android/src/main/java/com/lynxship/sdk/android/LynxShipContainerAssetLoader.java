package com.lynxship.sdk.android;

/** Loads an interpreted Lynx bundle from embedded assets, OTA or another source. */
public interface LynxShipContainerAssetLoader {
    byte[] load(String bundleName) throws Exception;
}
