package com.lynxship.sdk.android;

import android.content.Context;
import android.content.res.Configuration;
import android.os.Build;
import android.os.PowerManager;
import android.view.View;
import android.view.WindowInsets;
import android.view.accessibility.AccessibilityManager;

import androidx.annotation.NonNull;

import com.lynx.tasm.TemplateData;
import com.lynx.tasm.LynxView;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/** Builds the reserved host context injected into an Android Lynx container. */
final class LynxShipGlobalProps {
    private LynxShipGlobalProps() {}

    static void apply(
            @NonNull LynxView lynxView,
            @NonNull View host,
            @NonNull String containerId,
            @NonNull String containerInitTime,
            @NonNull Map<String, Object> appProps,
            boolean autoEnabled,
            boolean appInBackground) {
        if (!autoEnabled && appProps.isEmpty()) return;
        Map<String, Object> props = autoEnabled
                ? create(host, containerId, containerInitTime, appProps, appInBackground)
                : appProps;
        lynxView.updateGlobalProps(TemplateData.fromMap(props));
    }

    @NonNull
    static Map<String, Object> create(
            @NonNull View host,
            @NonNull String containerId,
            @NonNull String containerInitTime,
            @NonNull Map<String, Object> appProps,
            boolean appInBackground) {
        Context context = host.getContext();
        float density = context.getResources().getDisplayMetrics().density;
        if (!(density > 0f) || !Float.isFinite(density)) density = 1f;
        double screenWidth = context.getResources().getDisplayMetrics().widthPixels / (double) density;
        double screenHeight = context.getResources().getDisplayMetrics().heightPixels / (double) density;
        double contentWidth = Math.max(0d, host.getWidth() / (double) density);
        double contentHeight = Math.max(0d, host.getHeight() / (double) density);
        Map<String, Double> insets = systemInsets(host, density);
        String orientation = context.getResources().getConfiguration().orientation ==
                Configuration.ORIENTATION_LANDSCAPE ? "landscape" : "portrait";
        int night = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        String theme = night == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
        String locale = context.getResources().getConfiguration().getLocales().isEmpty()
                ? "en-US" : context.getResources().getConfiguration().getLocales().get(0).toLanguageTag();
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        boolean cutout = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                host.getRootWindowInsets() != null && host.getRootWindowInsets().getDisplayCutout() != null;
        boolean tablet = context.getResources().getConfiguration().smallestScreenWidthDp >= 600;
        Map<String, Object> props = new HashMap<>(appProps);
        props.put("os", "android");
        props.put("osVersion", Build.VERSION.RELEASE == null ? "unknown" : Build.VERSION.RELEASE);
        props.put("deviceModel", Build.MODEL == null ? "unknown" : Build.MODEL);
        props.put("containerID", containerId);
        props.put("containerInitTime", containerInitTime);
        props.put("screenWidth", screenWidth);
        props.put("screenHeight", screenHeight);
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
        props.put("queryItems", Collections.emptyMap());
        props.put("statusBarHeight", insets.get("top"));
        props.put("navigationBarHeight", insets.get("bottom"));
        props.put("safeAreaHeight", insets.get("top"));
        return Collections.unmodifiableMap(props);
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
