package com.lynxship.sdk.android;

import android.content.Context;
import android.view.View;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.lynx.tasm.LynxError;

/** Optional host-owned loading and failure UI for an embedded Lynx container. */
public interface LynxShipContainerUiProvider {
    /** Return an overlay view, or null to render no loading overlay. */
    @Nullable
    default View createLoadingView(
            @NonNull Context context,
            @NonNull LynxShipContainerView container,
            @NonNull String bundleName) {
        return null;
    }

    /** Return an overlay view, or null to render no error overlay. */
    @Nullable
    default View createErrorView(
            @NonNull Context context,
            @NonNull LynxShipContainerView container,
            @NonNull String bundleName,
            @Nullable LynxError error,
            @NonNull Runnable retry) {
        return null;
    }
}
