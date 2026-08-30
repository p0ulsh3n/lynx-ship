package com.lynxship.navigation;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import android.window.OnBackInvokedCallback;

import com.lynx.react.bridge.JavaOnlyArray;
import com.lynx.tasm.LynxError;
import com.lynx.tasm.LynxLoadMeta;
import com.lynx.tasm.LynxView;
import com.lynx.tasm.LynxViewBuilder;
import com.lynx.tasm.LynxViewClient;
import com.lynx.tasm.provider.AbsTemplateProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.UUID;

/** Default full-page Lynx host used when an application has no router host. */
public final class LynxShipPageActivity extends Activity implements LynxShipNavigationHost {
    private static final int MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
    private FrameLayout root;
    private LinearLayout toolbar;
    private ImageButton leadingButton;
    private TextView titleView;
    private TextView subtitleView;
    private LynxView lynxView;
    private View loading;
    private TextView errorView;
    private LynxViewClient lifecycleClient;
    private final String containerId = UUID.randomUUID().toString();
    private final String containerInitTime = Long.toString(System.currentTimeMillis());
    private String bundleName;
    private boolean hideLoading;
    private boolean disableAutoRemoveLoading;
    private boolean hideError;
    private int containerBackgroundColor = Color.WHITE;
    private int loadingBackgroundColor = Color.WHITE;
    private boolean appInBackground;
    private boolean backPressHandlingEnabled;
    private boolean hideBackButton;
    private boolean transparentStatusBar;
    private boolean showNavBarInTransparentStatusBar;
    private boolean contentReady;
    @Nullable private OnBackInvokedCallback backCallback;

    @Override protected void onCreate(@Nullable Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        setContentView(root);
        createToolbar();
        createLynxView();
        registerPredictiveBack();
        loadIntent(getIntent().getData());
    }

    @Override protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadIntent(intent.getData());
    }

    @Override protected void onResume() {
        super.onResume();
        appInBackground = false;
        if (lynxView != null) {
            lynxView.onEnterForeground();
            pushGlobalProps();
        }
    }

    @Override protected void onPause() {
        appInBackground = true;
        if (lynxView != null) {
            lynxView.onEnterBackground();
            pushGlobalProps();
        }
        super.onPause();
    }

    @Override public boolean open(String url, boolean replace) {
        android.net.Uri uri = android.net.Uri.parse(url);
        if (!hasBundle(uri)) return false;
        android.content.Intent intent = new android.content.Intent(this, LynxShipPageActivity.class)
                .setData(uri);
        if (replace) intent.addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP |
                android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        if (replace) overridePendingTransition(0, 0);
        return true;
    }

    @Override public boolean back() {
        finish();
        return true;
    }

    @Override public boolean close() {
        finish();
        return true;
    }

    @Override public boolean updateChrome(String json) {
        try {
            applyChrome(new JSONObject(json));
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private void createToolbar() {
        toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(8, 0, 8, 0);
        toolbar.setBackgroundColor(Color.WHITE);
        leadingButton = new ImageButton(this);
        leadingButton.setImageResource(android.R.drawable.ic_media_previous);
        leadingButton.setContentDescription("Go back");
        leadingButton.setBackgroundColor(Color.TRANSPARENT);
        leadingButton.setOnClickListener(view -> dispatchAction("back", "back"));
        toolbar.addView(leadingButton, new LinearLayout.LayoutParams(48, 48));
        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        titleView = new TextView(this);
        titleView.setTextSize(18);
        titleView.setMaxLines(1);
        subtitleView = new TextView(this);
        subtitleView.setTextSize(12);
        subtitleView.setMaxLines(1);
        texts.addView(titleView, new LinearLayout.LayoutParams(0, 28, 1));
        texts.addView(subtitleView, new LinearLayout.LayoutParams(0, 20, 1));
        toolbar.addView(texts, new LinearLayout.LayoutParams(0, 48, 1));
        root.addView(toolbar, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, 56, Gravity.TOP));
    }

    /** Registers the opt-in callback without consuming default system back. */
    private void registerPredictiveBack() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                !backPressHandlingEnabled || backCallback != null) return;
        backCallback = this::handleSystemBack;
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
    }

    private void unregisterPredictiveBack() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || backCallback == null) return;
        getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        backCallback = null;
    }

    private void handleSystemBack() {
        dispatchBackPress();
    }

    @Override public boolean setBackPressHandling(boolean enabled) {
        backPressHandlingEnabled = enabled;
        if (enabled) registerPredictiveBack();
        else unregisterPredictiveBack();
        return true;
    }

    /** Compatibility path for Android versions before OnBackInvokedDispatcher. */
    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() {
        if (backPressHandlingEnabled) {
            dispatchBackPress();
            return;
        }
        super.onBackPressed();
    }

    private void dispatchBackPress() {
        if (backPressHandlingEnabled && lynxView != null) {
            lynxView.sendGlobalEvent("lynxship:navigation-back-press",
                    JavaOnlyArray.from(Collections.emptyList()));
            return;
        }
        back();
    }

    private void createLynxView() {
        AbsTemplateProvider provider = new AbsTemplateProvider() {
            @Override public void loadTemplate(String uri, Callback callback) {
                try {
                    callback.onSuccess(readAsset(uri));
                } catch (Exception error) {
                    callback.onFailed(error.getMessage() == null ?
                            "Unable to load Lynx bundle" : error.getMessage());
                }
            }
        };
        lynxView = new LynxViewBuilder().setTemplateProvider(provider).build(this);
        lifecycleClient = new LynxViewClient() {
            @Override public void onPageStart(String url) { showLoading(); }
            @Override public void onFirstScreen() { showContent(); }
            @Override public void onReceivedError(LynxError error) {
                showError(error == null ? "Lynx failed to load" : error.toString());
            }
        };
        lynxView.addLynxViewClient(lifecycleClient);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
        params.topMargin = 56;
        root.addView(lynxView, params);
        loading = new android.widget.ProgressBar(this);
        FrameLayout.LayoutParams loadingParams = new FrameLayout.LayoutParams(64, 64, Gravity.CENTER);
        root.addView(loading, loadingParams);
        errorView = new TextView(this);
        errorView.setGravity(Gravity.CENTER);
        errorView.setTextColor(Color.DKGRAY);
        errorView.setPadding(48, 24, 48, 24);
        errorView.setOnClickListener(view -> render());
        FrameLayout.LayoutParams errorParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        errorParams.setMargins(32, 32, 32, 32);
        root.addView(errorView, errorParams);
    }

    private void loadIntent(@Nullable android.net.Uri uri) {
        if (uri == null || !hasBundle(uri)) {
            showError("This Lynx page does not identify a local bundle.");
            return;
        }
        bundleName = uri.getQueryParameter("bundle");
        applySchemeChrome(uri);
        render();
    }

    private void render() {
        if (bundleName == null) return;
        contentReady = false;
        showLoading();
        try {
            LynxLoadMeta.Builder builder = new LynxLoadMeta.Builder();
            builder.setUrl(bundleName);
            builder.setGlobalProps(TemplateData.fromMap(LynxShipNavigationGlobalProps.create(
                    this, root, containerId, containerInitTime, getIntent().getData(), appInBackground)));
            lynxView.loadTemplate(builder.build());
        } catch (RuntimeException error) {
            showError(error.getMessage() == null ? "Lynx failed to start" : error.getMessage());
        }
    }

    private void pushGlobalProps() {
        if (root == null || lynxView == null || bundleName == null) return;
        lynxView.updateGlobalProps(TemplateData.fromMap(LynxShipNavigationGlobalProps.create(
                this, root, containerId, containerInitTime, getIntent().getData(), appInBackground)));
    }

    private void applySchemeChrome(android.net.Uri uri) {
        JSONObject chrome = new JSONObject();
        try {
            String title = uri.getQueryParameter("title");
            if (title != null) chrome.put("title", title);
            String titleColor = uri.getQueryParameter("title_color");
            if (isColor(titleColor)) chrome.put("titleColor", titleColor);
            String background = uri.getQueryParameter("nav_bar_color");
            if (isColor(background)) chrome.put("backgroundColor", background);
            String containerBackground = uri.getQueryParameter("container_bg_color");
            if (isColor(containerBackground)) chrome.put("containerBackgroundColor", containerBackground);
            String loadingBackground = uri.getQueryParameter("loading_bg_color");
            if (isColor(loadingBackground)) chrome.put("loadingBackgroundColor", loadingBackground);
            String orientation = uri.getQueryParameter("screen_orientation");
            if (isOrientation(orientation)) chrome.put("screenOrientation", orientation);
            String statusFontMode = uri.getQueryParameter("status_font_mode");
            if (isStatusFontMode(statusFontMode)) chrome.put("statusFontMode", statusFontMode);
            if (isFlag(uri.getQueryParameter("hide_loading"))) chrome.put("hideLoading", true);
            if (isFlag(uri.getQueryParameter("disable_auto_remove_loading")))
                chrome.put("disableAutoRemoveLoading", true);
            if (isFlag(uri.getQueryParameter("hide_error"))) chrome.put("hideError", true);
            if (isFlag(uri.getQueryParameter("hide_back_button"))) chrome.put("hideBackButton", true);
            if (isFlag(uri.getQueryParameter("trans_status_bar"))) chrome.put("transparentStatusBar", true);
            if (isFlag(uri.getQueryParameter("show_nav_bar_in_trans_status_bar")))
                chrome.put("showNavBarInTransparentStatusBar", true);
            String forceTheme = uri.getQueryParameter("force_theme_style");
            if ("light".equals(forceTheme) || "dark".equals(forceTheme)) chrome.put("forceThemeStyle", forceTheme);
            addThemedValue(this, uri, chrome, "title_color", "titleColor");
            addThemedValue(this, uri, chrome, "nav_bar_color", "backgroundColor");
            addThemedValue(this, uri, chrome, "container_bg_color", "containerBackgroundColor");
            addThemedValue(this, uri, chrome, "loading_bg_color", "loadingBackgroundColor");
            if ("1".equals(uri.getQueryParameter("hide_nav_bar")))
                chrome.put("visible", false);
            applyChrome(chrome);
            applySystemBars(chrome);
        } catch (Exception ignored) { }
    }

    private void applyChrome(JSONObject chrome) {
        if (chrome.has("visible")) toolbar.setVisibility(chrome.optBoolean("visible") ? View.VISIBLE : View.GONE);
        String title = chrome.optString("title", "");
        titleView.setText(title);
        subtitleView.setText(chrome.optString("subtitle", ""));
        setColor(toolbar, chrome.optString("backgroundColor", "#FFFFFF"), Color.WHITE);
        String containerBackground = chrome.optString("containerBackgroundColor", "");
        if (isColor(containerBackground)) containerBackgroundColor = Color.parseColor(containerBackground);
        String loadingBackground = chrome.optString("loadingBackgroundColor", "");
        if (isColor(loadingBackground)) loadingBackgroundColor = Color.parseColor(loadingBackground);
        hideLoading = chrome.optBoolean("hideLoading", hideLoading);
        disableAutoRemoveLoading = chrome.optBoolean(
                "disableAutoRemoveLoading", disableAutoRemoveLoading);
        hideError = chrome.optBoolean("hideError", hideError);
        hideBackButton = chrome.optBoolean("hideBackButton", hideBackButton);
        transparentStatusBar = chrome.optBoolean("transparentStatusBar", transparentStatusBar);
        showNavBarInTransparentStatusBar = chrome.optBoolean(
                "showNavBarInTransparentStatusBar", showNavBarInTransparentStatusBar);
        applySystemBars(chrome);
        applyOrientation(chrome.optString("screenOrientation", ""));
        leadingButton.setVisibility(hideBackButton ? View.GONE : View.VISIBLE);
        applyLeadingAction(chrome.optJSONObject("leadingAction"));
        root.setBackgroundColor(containerBackgroundColor);
        if (contentReady) {
            if (hideLoading || !disableAutoRemoveLoading) loading.setVisibility(View.GONE);
            else loading.setVisibility(View.VISIBLE);
        }
        setTextColor(titleView, chrome.optString("titleColor", "#202124"), Color.DKGRAY);
        setTextColor(subtitleView, chrome.optString("subtitleColor", "#5F6368"), Color.GRAY);
        removeTrailingActions();
        JSONArray actions = chrome.optJSONArray("trailingActions");
        if (actions == null) return;
        for (int index = 0; index < Math.min(actions.length(), 4); index++) {
            JSONObject action = actions.optJSONObject(index);
            if (action == null) continue;
            String id = action.optString("id", "");
            String label = action.optString("label", id);
            if (!isActionId(id) || label.trim().isEmpty()) continue;
            TextView button = new TextView(this);
            button.setText(label);
            button.setGravity(Gravity.CENTER);
            button.setContentDescription(action.optString("accessibilityLabel", label));
            button.setEnabled(action.optBoolean("enabled", true));
            if (action.optBoolean("destructive", false)) button.setTextColor(Color.RED);
            button.setPadding(12, 0, 12, 0);
            applyIcon(button, action.optString("icon", ""), 0);
            button.setOnClickListener(view -> dispatchAction(action.optString("role", "action"), id));
            toolbar.addView(button, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, 48));
        }
    }

    private void removeTrailingActions() {
        while (toolbar.getChildCount() > 2) toolbar.removeViewAt(toolbar.getChildCount() - 1);
    }

    private void applyLeadingAction(@Nullable JSONObject action) {
        if (action == null) {
            leadingButton.setImageResource(android.R.drawable.ic_media_previous);
            leadingButton.setContentDescription("Go back");
            leadingButton.setEnabled(true);
            leadingButton.setOnClickListener(view -> dispatchAction("back", "back"));
            return;
        }
        String id = action.optString("id", "");
        String role = action.optString("role", "action");
        String label = action.optString("accessibilityLabel", action.optString("label", id));
        if (!isActionId(id) || label.trim().isEmpty() ||
                !("back".equals(role) || "close".equals(role) || "action".equals(role))) return;
        applyIcon(leadingButton, action.optString("icon", ""), android.R.drawable.ic_media_previous);
        leadingButton.setContentDescription(label);
        leadingButton.setEnabled(action.optBoolean("enabled", true));
        leadingButton.setOnClickListener(view -> dispatchAction(role, id));
    }

    private void dispatchAction(String role, String id) {
        if ("back".equals(role) || "close".equals(role)) {
            finish();
            return;
        }
        lynxView.sendGlobalEvent("lynxship:navigation-action",
                JavaOnlyArray.from(Collections.singletonList(id)));
    }

    private void applySystemBars(JSONObject chrome) {
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        if (chrome.optBoolean("hideStatusBar", false)) flags |= View.SYSTEM_UI_FLAG_FULLSCREEN;
        if (transparentStatusBar) flags |= View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
        String statusFontMode = chrome.optString("statusFontMode", "default");
        if ("dark".equals(statusFontMode) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        getWindow().getDecorView().setSystemUiVisibility(flags);
        if (transparentStatusBar) {
            getWindow().setStatusBarColor(Color.TRANSPARENT);
        }
        if (isColor(chrome.optString("backgroundColor", "")))
            getWindow().setNavigationBarColor(Color.parseColor(chrome.optString("backgroundColor")));
    }

    private void applyOrientation(String value) {
        if ("portrait".equals(value)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        else if ("portrait-upside-down".equals(value)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT);
        else if ("landscape".equals(value)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        else if ("landscape-left".equals(value)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        else if ("landscape-right".equals(value)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE);
        else if ("auto".equals(value)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    private static void addThemedValue(Activity activity, android.net.Uri uri,
            JSONObject target, String key, String outputKey) {
        String forceTheme = uri.getQueryParameter("force_theme_style");
        String suffix = "light".equals(forceTheme) ? "_light" :
                "dark".equals(forceTheme) ? "_dark" :
                isDarkMode(activity) ? "_dark" : "_light";
        String value = uri.getQueryParameter(key + suffix);
        if (!isColor(value)) value = uri.getQueryParameter(key);
        if (isColor(value)) {
            try { target.put(outputKey, value); } catch (Exception ignored) { }
        }
    }

    private static boolean isDarkMode(Activity activity) {
        int mode = activity.getResources().getConfiguration().uiMode &
                android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        return mode == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    private byte[] readAsset(String name) throws Exception {
        if (!isSafeBundleName(name)) throw new IllegalArgumentException("Invalid Lynx bundle path");
        try (InputStream input = getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BUNDLE_BYTES) throw new IllegalArgumentException("Lynx bundle is too large");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private void showLoading() {
        root.setBackgroundColor(loadingBackgroundColor);
        loading.setVisibility(hideLoading ? View.GONE : View.VISIBLE);
        errorView.setVisibility(View.GONE);
    }

    private void showContent() {
        root.setBackgroundColor(containerBackgroundColor);
        contentReady = true;
        loading.setVisibility(hideLoading || !disableAutoRemoveLoading ? View.GONE : View.VISIBLE);
        errorView.setVisibility(View.GONE);
    }

    private void showError(String message) {
        root.setBackgroundColor(containerBackgroundColor);
        loading.setVisibility(View.GONE);
        errorView.setText("Unable to load Lynx content.\nTap to retry.\n\n" + message);
        errorView.setVisibility(hideError ? View.GONE : View.VISIBLE);
    }

    @Override protected void onDestroy() {
        unregisterPredictiveBack();
        if (lynxView != null) {
            if (lifecycleClient != null) lynxView.removeLynxViewClient(lifecycleClient);
            lynxView.destroy();
        }
        super.onDestroy();
    }

    private static boolean hasBundle(android.net.Uri uri) {
        return uri.getQueryParameter("bundle") != null &&
                isSafeBundleName(uri.getQueryParameter("bundle"));
    }

    private static boolean isSafeBundleName(String name) {
        return name != null && !name.trim().isEmpty() && name.length() <= 4096 &&
                !name.startsWith("/") && !name.contains("\\") && !name.contains("..") &&
                !name.contains("\0") && !name.matches(".*[\\u0000-\\u001F\\u007F].*");
    }

    private static boolean isColor(String value) { return value != null && value.matches("#[0-9a-fA-F]{6}"); }
    private static boolean isFlag(String value) { return "1".equals(value) || "true".equalsIgnoreCase(value); }
    private static boolean isOrientation(String value) {
        return "auto".equals(value) || "portrait".equals(value) ||
                "portrait-upside-down".equals(value) || "landscape".equals(value) ||
                "landscape-left".equals(value) || "landscape-right".equals(value);
    }
    private static boolean isStatusFontMode(String value) {
        return "default".equals(value) || "light".equals(value) || "dark".equals(value);
    }
    private static boolean isActionId(String value) { return value != null && value.matches("[A-Za-z][A-Za-z0-9_.:-]{0,63}"); }
    private static void setColor(View view, String value, int fallback) {
        try { view.setBackgroundColor(isColor(value) ? Color.parseColor(value) : fallback); }
        catch (IllegalArgumentException ignored) { view.setBackgroundColor(fallback); }
    }
    private static void setTextColor(TextView view, String value, int fallback) {
        try { view.setTextColor(isColor(value) ? Color.parseColor(value) : fallback); }
        catch (IllegalArgumentException ignored) { view.setTextColor(fallback); }
    }

    private void applyIcon(View view, String iconName, int fallback) {
        int resource = 0;
        if (iconName != null && !iconName.isEmpty() && isSafeIconName(iconName))
            resource = getResources().getIdentifier(iconName, "drawable", getPackageName());
        if (view instanceof ImageButton) {
            ((ImageButton) view).setImageResource(resource != 0 ? resource : fallback);
        } else if (view instanceof TextView) {
            ((TextView) view).setCompoundDrawablesWithIntrinsicBounds(resource, 0, 0, 0);
            ((TextView) view).setCompoundDrawablePadding(resource == 0 ? 0 : 8);
        }
    }

    private static boolean isSafeIconName(String value) {
        return value.matches("[A-Za-z][A-Za-z0-9_.:-]{0,127}");
    }
}
