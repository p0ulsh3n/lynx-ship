package com.lynxship.androiddemo;

import android.app.Application;

import com.lynx.tasm.LynxEnv;

public final class LynxShipApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        LynxEnv.inst().init(this, null, null, null);
    }
}
