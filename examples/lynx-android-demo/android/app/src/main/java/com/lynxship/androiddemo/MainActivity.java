package com.lynxship.androiddemo;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

import com.lynx.tasm.LynxViewClient;
import com.lynx.tasm.LynxView;
import com.lynx.tasm.LynxViewBuilder;
import com.lynxship.sdk.android.LynxShipOtaClient;

import java.io.IOException;
import java.util.Collections;

public final class MainActivity extends Activity {
    private LynxShipOtaClient otaClient;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        otaClient = createOtaClient();
        if (otaClient != null) {
            try {
                otaClient.beginLaunch();
            } catch (IOException error) {
                Log.w("LynxShip", "Could not prepare OTA launch", error);
            }
        }
        LynxView lynxView = new LynxViewBuilder()
                .setTemplateProvider(new DemoTemplateProvider(this, otaClient))
                .build(this);
        if (otaClient != null) {
            lynxView.addLynxViewClient(new LynxViewClient() {
                @Override
                public void onFirstScreen() {
                    try {
                        otaClient.markLaunchSuccess();
                    } catch (IOException error) {
                        Log.w("LynxShip", "Could not mark OTA launch successful", error);
                    }
                }
            });
            otaClient.checkAndInstallAsync(new LynxShipOtaClient.Listener() {
                @Override
                public void onSuccess(boolean updateAvailable) {
                    Log.i("LynxShip", updateAvailable
                            ? "OTA candidate staged for the next launch"
                            : "No compatible OTA update available");
                }

                @Override
                public void onFailure(Exception error) {
                    Log.w("LynxShip", "OTA check failed; embedded bundle remains active", error);
                }
            });
        }
        setContentView(lynxView);
        lynxView.renderTemplateUrl("main.lynx.bundle", "");
    }

    private LynxShipOtaClient createOtaClient() {
        if (BuildConfig.LYNXSHIP_OTA_ENDPOINT.isEmpty()
                || BuildConfig.LYNXSHIP_OTA_RUNTIME_VERSION.isEmpty()
                || BuildConfig.LYNXSHIP_OTA_PUBLIC_KEY_ID.isEmpty()
                || BuildConfig.LYNXSHIP_OTA_PUBLIC_KEY.isEmpty()) {
            return null;
        }
        try {
            return new LynxShipOtaClient(new LynxShipOtaClient.Config(
                    new java.io.File(getFilesDir(), "lynxship-ota"),
                    BuildConfig.LYNXSHIP_OTA_ENDPOINT,
                    BuildConfig.LYNXSHIP_OTA_PROJECT_ID,
                    "production",
                    "android",
                    BuildConfig.LYNXSHIP_OTA_RUNTIME_VERSION,
                    android.provider.Settings.Secure.getString(
                            getContentResolver(), android.provider.Settings.Secure.ANDROID_ID),
                    Collections.singletonMap(
                            BuildConfig.LYNXSHIP_OTA_PUBLIC_KEY_ID,
                            BuildConfig.LYNXSHIP_OTA_PUBLIC_KEY),
                    path -> {
                        try (InputStream input = getAssets().open(path);
                                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                            byte[] buffer = new byte[8192];
                            int read;
                            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                            return output.toByteArray();
                        }
                    }));
        } catch (IOException | RuntimeException error) {
            Log.w("LynxShip", "OTA is disabled until its public configuration is complete", error);
            return null;
        }
    }
}
