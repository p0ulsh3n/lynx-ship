package com.lynxship.sdk.android;

import androidx.annotation.NonNull;

import com.lynx.tasm.LynxViewBuilder;

/**
 * Configures the official Lynx builder before a container is created.
 *
 * <p>Hosts can use this seam to register local custom UI behaviors, template
 * providers or other builder-level Lynx extensions. The configurator is
 * invoked once, before the {@code LynxView} exists, so it cannot race with a
 * load and does not require process-global registration.</p>
 */
public interface LynxShipContainerBuilderConfigurator {
    void configure(@NonNull LynxViewBuilder builder);
}
