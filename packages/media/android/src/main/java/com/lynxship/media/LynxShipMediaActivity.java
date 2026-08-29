package com.lynxship.media;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;

/** Private activity that bridges Android's system media UI to a Lynx module. */
public final class LynxShipMediaActivity extends Activity {
    private static final int REQUEST_CODE = 8291;
    private static final int PERMISSION_REQUEST_CODE = 8292;
    private Uri outputUri;
    private String outputPath;
    private boolean completed;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        String requestId = getIntent().getStringExtra(LynxShipMediaContract.EXTRA_REQUEST_ID);
        String mode = getIntent().getStringExtra("mode");
        String kind = getIntent().getStringExtra("kind");
        if (requestId == null || mode == null || kind == null) { finishWith(""); return; }
        if ("permission".equals(mode)) {
            String permission = permissionFor(kind);
            if (permission == null) { finishWith(""); return; }
            if (checkSelfPermission(permission) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                finishWith("granted");
                return;
            }
            requestPermissions(new String[]{permission}, PERMISSION_REQUEST_CODE);
            return;
        }

        Intent intent;
        try {
            if ("pick".equals(mode)) {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("video-library".equals(kind) ? "video/*" : "image/*")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            } else if ("camera".equals(kind)) {
                File directory = new File(getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES), "lynxship");
                if (!directory.mkdirs() && !directory.isDirectory()) { finishWith(""); return; }
                File output = File.createTempFile("capture-", ".jpg", directory);
                outputPath = output.getAbsolutePath();
                outputUri = FileProvider.getUriForFile(this, getPackageName() + ".lynxship.media.fileprovider", output);
                intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, outputUri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                intent.setClipData(ClipData.newRawUri("output", outputUri));
            } else if ("microphone".equals(kind)) {
                intent = new Intent(MediaStore.Audio.Media.RECORD_SOUND_ACTION)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else { finishWith(""); return; }
            if (intent.resolveActivity(getPackageManager()) == null) { finishWith(""); return; }
            startActivityForResult(intent, REQUEST_CODE);
        } catch (IOException | RuntimeException error) { finishWith(""); }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != PERMISSION_REQUEST_CODE) return;
        finishWith(results.length > 0
                && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED ? "granted" : "denied");
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CODE || resultCode != RESULT_OK) { finishWith(""); return; }
        if (data != null && data.getData() != null) {
            try {
                int takeFlags = data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
                getContentResolver().takePersistableUriPermission(data.getData(), takeFlags);
            } catch (SecurityException ignored) {
                // Some providers grant a one-shot URI only; return it regardless.
            }
        }
        Uri result = outputUri != null ? outputUri : data == null ? null : data.getData();
        finishWith(result == null ? "" : result.toString());
    }

    @Override protected void onDestroy() {
        if (!completed) finishWith("");
        super.onDestroy();
    }

    private String permissionFor(String kind) {
        if ("camera".equals(kind)) return android.Manifest.permission.CAMERA;
        if ("microphone".equals(kind)) return android.Manifest.permission.RECORD_AUDIO;
        return null;
    }

    private void finishWith(String value) {
        if (completed) return;
        completed = true;
        if ((value == null || value.isEmpty()) && outputPath != null)
            //noinspection ResultOfMethodCallIgnored
            new File(outputPath).delete();
        LynxShipMediaContract.sendResult(
                getApplicationContext(),
                getIntent().getStringExtra(LynxShipMediaContract.EXTRA_REQUEST_ID),
                value);
        outputUri = null;
        outputPath = null;
        finish();
    }
}
