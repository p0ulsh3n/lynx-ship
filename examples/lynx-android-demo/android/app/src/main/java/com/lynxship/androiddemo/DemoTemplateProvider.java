package com.lynxship.androiddemo;

import android.content.Context;

import com.lynxship.sdk.android.LynxShipOtaClient;
import com.lynx.tasm.provider.AbsTemplateProvider;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

public final class DemoTemplateProvider extends AbsTemplateProvider {
    private final Context context;
    private final LynxShipOtaClient otaClient;

    public DemoTemplateProvider(Context context, LynxShipOtaClient otaClient) {
        this.context = context.getApplicationContext();
        this.otaClient = otaClient;
    }

    @Override
    public void loadTemplate(String uri, Callback callback) {
        new Thread(() -> {
            try {
                if (otaClient != null) {
                    callback.onSuccess(otaClient.openActiveAsset(uri));
                    return;
                }
                try (InputStream input = context.getAssets().open(uri);
                        ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                    }
                    callback.onSuccess(output.toByteArray());
                }
            } catch (IOException error) {
                callback.onFailed(error.getMessage());
            }
        }, "lynx-template-loader").start();
    }
}
