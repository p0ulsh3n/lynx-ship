package com.lynxship.navigation;

import android.content.Context;
import android.content.res.Configuration;
import android.os.Build;
import android.os.PowerManager;
import android.view.View;
import android.view.WindowInsets;
import android.view.accessibility.AccessibilityManager;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/** Builds the automatic host context for the default full-page container. */
final class LynxShipNavigationGlobalProps {
    private static final int MAX_QUERY_ITEMS = 64;
    private static final int MAX_QUERY_KEY_LENGTH = 128;
    private static final int MAX_QUERY_VALUE_LENGTH = 4096;

    private LynxShipNavigationGlobalProps() {}

    @NonNull
    static Map<String, Object> create(
            @NonNull Context context,
            @NonNull View host,
            @NonNull String containerId,
            @NonNull String containerInitTime,
            @Nullable android.net.Uri uri,
            boolean appInBackground) {
        float density = context.getResources().getDisplayMetrics().density;
        if (!(density > 0f) || !Float.isFinite(density)) density = 1f;
        int widthPixels = context.getResources().getDisplayMetrics().widthPixels;
        int heightPixels = context.getResources().getDisplayMetrics().heightPixels;
        double contentWidth = Math.max(0d, host.getWidth() / (double) density);
        double contentHeight = Math.max(0d, host.getHeight() / (double) density);
        Map<String, Double> insets = systemInsets(host, density);
        Configuration configuration = context.getResources().getConfiguration();
        String orientation = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
                ? "landscape" : "portrait";
        int night = configuration.uiMode & Configuration.UI_MODE_NIGHT_MASK;
        String theme = night == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
        String locale = configuration.getLocales().isEmpty()
                ? "en-US" : configuration.getLocales().get(0).toLanguageTag();
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        boolean cutout = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                host.getRootWindowInsets() != null && host.getRootWindowInsets().getDisplayCutout() != null;
        boolean tablet = configuration.smallestScreenWidthDp >= 600;
        Map<String, Object> props = new HashMap<>();
        props.put("os", "android");
        props.put("osVersion", Build.VERSION.RELEASE == null ? "unknown" : Build.VERSION.RELEASE);
        props.put("deviceModel", Build.MODEL == null ? "unknown" : Build.MODEL);
        props.put("containerID", containerId);
        props.put("containerInitTime", containerInitTime);
        props.put("screenWidth", widthPixels / (double) density);
        props.put("screenHeight", heightPixels / (double) density);
        props.put("contentWidth", contentWidth);
        props.put("contentHeight", contentHeight);
        props.put("safeAreaInsets", insets);
        props.put("pixelRatio", (double) density);
        props.put("accessibleMode", accessibilityMode(context));
        props.put("isIPhoneX", 0);
        props.put("isIPhoneXMax", 0);
        props.put("isPad", tablet ? 1 : 0);
        props.put("isNotchScreen", cutout);
        props.put("isLowPowerMode", power != null && power.isPowerSaveMode() ? 1 : 0);
        props.put("orientation", orientation);
        props.put("screenOrientation", orientation);
        props.put("theme", theme);
        int separator = locale.indexOf('-');
        props.put("appLanguage", separator > 0 ? locale.substring(0, separator) : locale);
        props.put("appLocale", locale);
        props.put("isAppBackground", appInBackground);
        props.put("queryItems", queryItems(uri));
        props.put("statusBarHeight", insets.get("top"));
        props.put("navigationBarHeight", insets.get("bottom"));
        props.put("safeAreaHeight", insets.get("top"));
        return Collections.unmodifiableMap(props);
    }

    @NonNull
    private static Map<String, Object> queryItems(@Nullable android.net.Uri uri) {
        if (uri == null) return Collections.emptyMap();
        Map<String, Object> values = new HashMap<>();
        for (String key : uri.getQueryParameterNames()) {
            if (values.size() >= MAX_QUERY_ITEMS) break;
            if (key == null || key.length() == 0 || key.length() > MAX_QUERY_KEY_LENGTH ||
                    key.matches(".*[\\u0000-\\u001F\\u007F].*")) continue;
            String value = uri.getQueryParameter(key);
            if (value != null && value.length() <= MAX_QUERY_VALUE_LENGTH &&
                    !value.matches(".*[\\u0000-\\u001F\\u007F].*")) values.put(key, value);
        }
        return Collections.unmodifiableMap(values);
    }

    private static int accessibilityMode(@NonNull Context context) {
        AccessibilityManager manager = (AccessibilityManager) context.getSystemService(Context.ACCESSIBILITY_SERVICE);
        return manager != null && manager.isTouchExplorationEnabled() ? 1 : 0;
    }

    @NonNull
    private static Map<String, Double> systemInsets(@NonNull View host, float density) {
        WindowInsets current = host.getRootWindowInsets();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && current != null) {
            android.graphics.Insets values = current.getInsets(WindowInsets.Type.systemBars());
            return insets(values.top / density, values.right / density, values.bottom / density, values.left / density);
        }
        int top = current == null ? 0 : current.getSystemWindowInsetTop();
        int right = current == null ? 0 : current.getSystemWindowInsetRight();
        int bottom = current == null ? 0 : current.getSystemWindowInsetBottom();
        int left = current == null ? 0 : current.getSystemWindowInsetLeft();
        return insets(top / density, right / density, bottom / density, left / density);
    }

    @NonNull
    private static Map<String, Double> insets(double top, double right, double bottom, double left) {
        Map<String, Double> values = new HashMap<>();
        values.put("top", Math.max(0d, top));
        values.put("right", Math.max(0d, right));
        values.put("bottom", Math.max(0d, bottom));
        values.put("left", Math.max(0d, left));
        return Collections.unmodifiableMap(values);
    }
}
