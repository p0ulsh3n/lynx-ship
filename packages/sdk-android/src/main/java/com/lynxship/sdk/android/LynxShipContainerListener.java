package com.lynxship.sdk.android;

import com.lynx.tasm.LynxError;

/** Lifecycle callbacks for {@link LynxShipContainerView}. */
public interface LynxShipContainerListener {
    default void onPrepared(LynxShipContainerView container, String bundleName) {}
    default void onPrepareError(LynxShipContainerView container, String bundleName, Exception error) {}
    default void onLoadStart(LynxShipContainerView container, String bundleName) {}
    /** Called when Lynx asks the host provider for the bundle bytes. */
    default void onResourceFetchStart(LynxShipContainerView container, String bundleName) {}
    default void onFirstScreen(LynxShipContainerView container, String bundleName) {}
    /** Called after Lynx accepts a non-remounting data update. */
    default void onUpdate(LynxShipContainerView container, String bundleName) {}
    default void onLoadError(LynxShipContainerView container, String bundleName, LynxError error) {}
    default void onShow(LynxShipContainerView container) {}
    default void onHide(LynxShipContainerView container) {}
}
