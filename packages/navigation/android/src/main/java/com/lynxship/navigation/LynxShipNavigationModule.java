package com.lynxship.navigation;

import android.app.Activity;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.net.Uri;
import org.json.JSONObject;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

/**
 * Lynx navigation bridge. A host can implement the native stack through
 * LynxShipNavigationHost; otherwise safe deep links are delegated to Android.
 */
public final class LynxShipNavigationModule extends LynxModule {
    private final Context moduleContext;

    public LynxShipNavigationModule(LynxContext lynxContext) {
        super(lynxContext);
        moduleContext = lynxContext.getContext();
    }

    @LynxMethod
    public void create(String url, Callback callback) {
        if (!isAllowedLynxURL(url)) {
            callback.invoke(false);
            return;
        }
        Activity activity = findActivity(moduleContext);
        callback.invoke(activity instanceof LynxShipNavigationHost
                && ((LynxShipNavigationHost) activity).create(url));
    }

    @LynxMethod
    public void open(String url, Callback callback) {
        dispatch(url, false, callback);
    }

    @LynxMethod
    public void openInSystemBrowser(String url, Callback callback) {
        if (!isAllowedBrowserURL(url)) {
            callback.invoke(false);
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            if (findActivity(moduleContext) == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            moduleContext.startActivity(intent);
            callback.invoke(true);
        } catch (RuntimeException error) {
            callback.invoke(false);
        }
    }

    @LynxMethod
    public void replace(String url, Callback callback) {
        dispatch(url, true, callback);
    }

    @LynxMethod
    public void back(Callback callback) {
        Activity activity = findActivity(moduleContext);
        if (activity instanceof LynxShipNavigationHost) {
            callback.invoke(((LynxShipNavigationHost) activity).back());
            return;
        }
        if (activity == null) {
            callback.invoke(false);
            return;
        }
        activity.finish();
        callback.invoke(true);
    }

    @LynxMethod
    public void setBackPressHandling(boolean enabled, Callback callback) {
        Activity activity = findActivity(moduleContext);
        callback.invoke(activity instanceof LynxShipNavigationHost
                && ((LynxShipNavigationHost) activity).setBackPressHandling(enabled));
    }

    @LynxMethod
    public void close(Callback callback) {
        Activity activity = findActivity(moduleContext);
        if (activity instanceof LynxShipNavigationHost) {
            callback.invoke(((LynxShipNavigationHost) activity).close());
            return;
        }
        if (activity == null) {
            callback.invoke(false);
            return;
        }
        activity.finish();
        callback.invoke(true);
    }

    @LynxMethod
    public void updateChrome(String json, Callback callback) {
        if (!isValidChrome(json)) {
            callback.invoke(false);
            return;
        }
        Activity activity = findActivity(moduleContext);
        callback.invoke(activity instanceof LynxShipNavigationHost
                && ((LynxShipNavigationHost) activity).updateChrome(json));
    }

    @Override public void destroy() {
        super.destroy();
    }

    private void dispatch(String rawUrl, boolean replace, Callback callback) {
        if (!isAllowed(rawUrl)) {
            callback.invoke(false);
            return;
        }
        Activity activity = findActivity(moduleContext);
        if (activity instanceof LynxShipNavigationHost) {
            callback.invoke(((LynxShipNavigationHost) activity).open(rawUrl, replace));
            return;
        }
        try {
            Uri uri = Uri.parse(rawUrl);
            Intent intent = hasLocalBundle(uri)
                    ? new Intent(moduleContext, LynxShipPageActivity.class).setData(uri)
                    : new Intent(Intent.ACTION_VIEW, uri);
            if (replace) intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (activity == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            moduleContext.startActivity(intent);
            callback.invoke(true);
        } catch (RuntimeException error) {
            callback.invoke(false);
        }
    }

    private static boolean isAllowed(String rawUrl) {
        if (rawUrl == null || rawUrl.length() == 0 || rawUrl.length() > 8192) return false;
        Uri uri = Uri.parse(rawUrl);
        String scheme = uri.getScheme();
        if (scheme == null || uri.getUserInfo() != null) return false;
        if ("https".equalsIgnoreCase(scheme) && (uri.getHost() == null || uri.getHost().length() == 0)) return false;
        return "lynx".equalsIgnoreCase(scheme)
                || "lynxship".equalsIgnoreCase(scheme)
                || "hybrid".equalsIgnoreCase(scheme)
                || "https".equalsIgnoreCase(scheme);
    }

    private static boolean isAllowedLynxURL(String rawUrl) {
        if (!isAllowed(rawUrl)) return false;
        String scheme = Uri.parse(rawUrl).getScheme();
        return "lynx".equalsIgnoreCase(scheme)
                || "lynxship".equalsIgnoreCase(scheme)
                || "hybrid".equalsIgnoreCase(scheme);
    }

    private static boolean isAllowedBrowserURL(String rawUrl) {
        if (!isAllowed(rawUrl)) return false;
        return "https".equalsIgnoreCase(Uri.parse(rawUrl).getScheme());
    }

    private static boolean isValidChrome(String json) {
        if (json == null || json.length() == 0 || json.length() > 16_384) return false;
        try {
            return new JSONObject(json).length() > 0;
        } catch (Exception error) {
            return false;
        }
    }

    private static boolean hasLocalBundle(Uri uri) {
        String bundle = uri.getQueryParameter("bundle");
        return bundle != null && !bundle.isEmpty() && bundle.length() <= 4096
                && !bundle.startsWith("/") && !bundle.contains("\\") && !bundle.contains("..")
                && !bundle.contains("\0");
    }

    private static Activity findActivity(Context context) {
        Context current = context;
        while (current instanceof ContextWrapper) {
            if (current instanceof Activity) return (Activity) current;
            Context next = ((ContextWrapper) current).getBaseContext();
            if (next == current) break;
            current = next;
        }
        return current instanceof Activity ? (Activity) current : null;
    }
}
