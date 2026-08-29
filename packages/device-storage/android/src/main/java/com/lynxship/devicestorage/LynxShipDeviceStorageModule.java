package com.lynxship.devicestorage;

import android.content.Context;
import android.content.SharedPreferences;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

/** Persistent, app-scoped storage backed by Android SharedPreferences. */
public final class LynxShipDeviceStorageModule extends LynxModule {
    private static final String PREFERENCES = "lynxship.device-storage";
    private final Context context;

    public LynxShipDeviceStorageModule(LynxContext lynxContext) {
        super(lynxContext);
        context = lynxContext.getContext().getApplicationContext();
    }

    private SharedPreferences preferences() {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    @LynxMethod
    public void getItem(String key, Callback callback) {
        callback.invoke(preferences().getString(key, null));
    }

    @LynxMethod
    public void setItem(String key, String value, Callback callback) {
        preferences().edit().putString(key, value).apply();
        if (callback != null) callback.invoke(true);
    }

    @LynxMethod
    public void removeItem(String key, Callback callback) {
        preferences().edit().remove(key).apply();
        if (callback != null) callback.invoke(true);
    }

    @LynxMethod
    public void clear(Callback callback) {
        preferences().edit().clear().apply();
        if (callback != null) callback.invoke(true);
    }
}
