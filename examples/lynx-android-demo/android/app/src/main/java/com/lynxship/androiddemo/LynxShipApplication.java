package com.lynxship.androiddemo;

import android.app.Application;

import com.lynx.tasm.LynxEnv;
import com.lynxship.devicestorage.LynxShipDeviceStorageModule;
import com.lynxship.permissions.LynxShipPermissionsModule;
import com.lynxship.media.LynxShipMediaModule;
import com.lynxship.notifications.LynxShipNotificationsModule;
import com.lynxship.navigation.LynxShipNavigationModule;

public final class LynxShipApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        LynxEnv.inst().init(this, null, null, null);
        LynxEnv.inst().registerModule("LynxShipDeviceStorage", LynxShipDeviceStorageModule.class);
        LynxEnv.inst().registerModule("LynxShipPermissions", LynxShipPermissionsModule.class);
        LynxEnv.inst().registerModule("LynxShipMedia", LynxShipMediaModule.class);
        LynxEnv.inst().registerModule("LynxShipNotifications", LynxShipNotificationsModule.class);
        LynxEnv.inst().registerModule("LynxShipNavigation", LynxShipNavigationModule.class);
    }
}
