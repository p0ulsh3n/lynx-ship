package com.lynxship.navigation;

/**
 * Optional native stack supplied by an Android host application.
 * Implementations must perform their own route allowlisting.
 */
public interface LynxShipNavigationHost {
    /** Creates a route without presenting it; return false when unsupported. */
    default boolean create(String url) {
        return false;
    }

    boolean open(String url, boolean replace);

    boolean back();

    /** Enables the opt-in Lynx back-press event instead of immediate finish. */
    default boolean setBackPressHandling(boolean enabled) {
        return false;
    }

    /** Optional semantic close; legacy hosts retain back() behavior. */
    default boolean close() {
        return back();
    }

    /** Applies a validated JSON navigation-chrome model to the active page. */
    default boolean updateChrome(String json) {
        return false;
    }
}
