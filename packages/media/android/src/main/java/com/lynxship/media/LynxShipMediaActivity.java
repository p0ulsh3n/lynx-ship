package com.lynxship.media;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/** Private activity that bridges Android's system media UI to a Lynx module. */
public final class LynxShipMediaActivity extends Activity {
    private static final int REQUEST_CODE = 8291;
    private static final int PERMISSION_REQUEST_CODE = 8292;
    private static final long MAX_FILE_BYTES = 100L * 1024L * 1024L;
    private static final long MAX_BASE64_BYTES = 16L * 1024L * 1024L;
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
            if (permission == null) { finishWith("denied"); return; }
            if (checkSelfPermission(permission) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                finishWith("granted");
                return;
            }
            requestPermissions(new String[]{permission}, PERMISSION_REQUEST_CODE);
            return;
        }

        try {
            Intent intent;
            if ("chooseMedia".equals(mode)) {
                intent = createChooseIntent(getIntent().getStringExtra("request"));
            } else if ("pick".equals(mode)) {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("video-library".equals(kind) ? "video/*" : "image/*")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            } else if ("camera".equals(kind)) {
                intent = createCameraIntent(false, "back");
            } else if ("microphone".equals(kind)) {
                intent = new Intent(MediaStore.Audio.Media.RECORD_SOUND_ACTION)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else { finishWith(""); return; }
            if (intent.resolveActivity(getPackageManager()) == null) { finishWith(error("No compatible media activity is installed.")); return; }
            startActivityForResult(intent, REQUEST_CODE);
        } catch (Exception failure) {
            finishWith(error(failure.getMessage() == null ? "Media picker could not start." : failure.getMessage()));
        }
    }

    private Intent createChooseIntent(String rawRequest) throws Exception {
        if (rawRequest == null || rawRequest.length() > 16 * 1024) throw new IllegalArgumentException("Invalid media selection request.");
        JSONObject request = new JSONObject(rawRequest);
        JSONArray types = request.optJSONArray("mediaTypes");
        String source = request.optString("sourceType", "");
        int maxCount = request.optInt("maxCount", 1);
        if (types == null || types.length() == 0 || maxCount < 1 || maxCount > 100) throw new IllegalArgumentException("Invalid media selection options.");
        if ("album".equals(source)) {
            boolean images = contains(types, "image");
            boolean videos = contains(types, "video");
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(images && videos ? "*/*" : images ? "image/*" : "video/*")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, maxCount > 1);
            if (images && videos) intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
            return intent;
        }
        if (!"camera".equals(source) || maxCount != 1 || types.length() != 1) throw new IllegalArgumentException("Android camera selection requires exactly one media type and one item.");
        String type = types.optString(0, "");
        if (!"image".equals(type) && !"video".equals(type)) throw new IllegalArgumentException("Unsupported camera media type.");
        return createCameraIntent("video".equals(type), request.optString("cameraType", "back"));
    }

    private static boolean contains(JSONArray values, String expected) {
        for (int index = 0; index < values.length(); index++) if (expected.equals(values.optString(index))) return true;
        return false;
    }

    private Intent createCameraIntent(boolean video, String cameraType) throws IOException {
        File directory = new File(getExternalFilesDir(video ? android.os.Environment.DIRECTORY_MOVIES : android.os.Environment.DIRECTORY_PICTURES), "lynxship");
        if (!directory.mkdirs() && !directory.isDirectory()) throw new IOException("Media output directory could not be created.");
        File output = File.createTempFile("capture-", video ? ".mp4" : ".jpg", directory);
        outputPath = output.getAbsolutePath();
        outputUri = FileProvider.getUriForFile(this, getPackageName() + ".lynxship.media.fileprovider", output);
        Intent intent = new Intent(video ? MediaStore.ACTION_VIDEO_CAPTURE : MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, outputUri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if ("front".equals(cameraType)) intent.putExtra("android.intent.extras.CAMERA_FACING", 1);
        intent.setClipData(ClipData.newRawUri("output", outputUri));
        return intent;
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == PERMISSION_REQUEST_CODE) finishWith(results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED ? "granted" : "denied");
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CODE || resultCode != RESULT_OK) { finishWith(""); return; }
        if ("chooseMedia".equals(getIntent().getStringExtra("mode"))) { finishWith(buildSelectionResult(data)); return; }
        Uri result = outputUri != null ? outputUri : data == null ? null : data.getData();
        if (data != null && data.getData() != null) persistGrant(data.getData(), data.getFlags());
        finishWith(result == null ? "" : result.toString());
    }

    private String buildSelectionResult(Intent data) {
        try {
            JSONObject request = new JSONObject(getIntent().getStringExtra("request"));
            List<Uri> uris = new ArrayList<>();
            if (outputUri != null) uris.add(outputUri);
            if (data != null && data.getClipData() != null) {
                for (int index = 0; index < data.getClipData().getItemCount(); index++) uris.add(data.getClipData().getItemAt(index).getUri());
            } else if (data != null && data.getData() != null) uris.add(data.getData());
            int limit = Math.min(request.optInt("maxCount", 1), 100);
            JSONObject result = new JSONObject().put("code", 1).put("data", new JSONObject().put("tempFiles", new JSONArray()));
            JSONArray files = result.getJSONObject("data").getJSONArray("tempFiles");
            for (int index = 0; index < uris.size() && index < limit; index++) {
                Uri uri = uris.get(index);
                if (uri == null) continue;
                if (data != null) persistGrant(uri, data.getFlags());
                JSONObject file = materialize(uri, request);
                if (file != null) files.put(file);
            }
            return files.length() == 0 ? error("No media item was selected.") : result.toString();
        } catch (Exception failure) {
            return error(failure.getMessage() == null ? "Media selection failed." : failure.getMessage());
        }
    }

    private JSONObject materialize(Uri source, JSONObject request) throws Exception {
        String mime = getContentResolver().getType(source);
        if (mime == null || (!mime.startsWith("image/") && !mime.startsWith("video/"))) return null;
        File file = copyToCache(source, mime);
        if (request.optBoolean("compressImage", false) && mime.startsWith("image/")) file = compressImage(file, request.optInt("compressWidth", 0), request.optInt("compressHeight", 0), request.optInt("compressQuality", 100));
        String mediaType = mime.startsWith("video/") ? "video" : "image";
        if (request.optBoolean("saveToPhotoAlbum", false)) saveToAlbum(file, mime, mediaType);
        long size = file.length();
        JSONObject value = new JSONObject().put("tempFilePath", Uri.fromFile(file).toString()).put("tempFileAbsolutePath", file.getAbsolutePath()).put("size", size).put("mediaType", mediaType).put("mimeType", mime);
        if (request.optBoolean("needBase64Data", false)) {
            if (size > MAX_BASE64_BYTES) throw new IOException("Base64 media is limited to 16 MiB.");
            value.put("base64Data", Base64.encodeToString(readBytes(file), Base64.NO_WRAP));
        }
        return value;
    }

    private File copyToCache(Uri source, String mime) throws IOException {
        File file = File.createTempFile("lynxship-media-", mime.startsWith("video/") ? ".mp4" : ".jpg", getCacheDir());
        try (InputStream input = getContentResolver().openInputStream(source); FileOutputStream output = new FileOutputStream(file)) {
            if (input == null) throw new IOException("Media URI could not be opened.");
            byte[] buffer = new byte[32 * 1024]; long total = 0; int read;
            while ((read = input.read(buffer)) != -1) { total += read; if (total > MAX_FILE_BYTES) throw new IOException("Media file exceeds the 100 MiB limit."); output.write(buffer, 0, read); }
        } catch (IOException failure) { //noinspection ResultOfMethodCallIgnored
            file.delete(); throw failure;
        }
        return file;
    }

    private File compressImage(File source, int width, int height, int quality) throws IOException {
        Bitmap bitmap = BitmapFactory.decodeFile(source.getAbsolutePath());
        if (bitmap == null) return source;
        int targetWidth = width > 0 ? width : bitmap.getWidth();
        int targetHeight = height > 0 ? height : bitmap.getHeight();
        float scale = Math.min(1f, Math.min((float) targetWidth / bitmap.getWidth(), (float) targetHeight / bitmap.getHeight()));
        Bitmap output = scale < 1f ? Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * scale)), Math.max(1, Math.round(bitmap.getHeight() * scale)), true) : bitmap;
        File compressed = File.createTempFile("lynxship-image-", ".jpg", getCacheDir());
        try (FileOutputStream stream = new FileOutputStream(compressed)) {
            if (!output.compress(Bitmap.CompressFormat.JPEG, Math.max(0, Math.min(100, quality)), stream)) throw new IOException("Image compression failed.");
        }
        if (output != bitmap) output.recycle(); bitmap.recycle(); //noinspection ResultOfMethodCallIgnored
        source.delete();
        return compressed;
    }

    private byte[] readBytes(File file) throws IOException {
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) { byte[] buffer = new byte[32 * 1024]; int read; while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read); return output.toByteArray(); }
    }

    private void saveToAlbum(File source, String mime, String mediaType) throws IOException {
        if (android.os.Build.VERSION.SDK_INT < 29) throw new IOException("Saving media to the public album requires Android 10 or newer.");
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, source.getName());
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, mediaType.equals("video") ? "Movies/LynxShip" : "Pictures/LynxShip");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri collection = mediaType.equals("video")
                ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri destination = getContentResolver().insert(collection, values);
        if (destination == null) throw new IOException("The public media album rejected the file.");
        android.os.ParcelFileDescriptor descriptor = getContentResolver().openFileDescriptor(destination, "w");
        if (descriptor == null) {
            getContentResolver().delete(destination, null, null);
            throw new IOException("The public media album could not be opened.");
        }
        try (FileInputStream input = new FileInputStream(source); android.os.ParcelFileDescriptor.AutoCloseOutputStream output = new android.os.ParcelFileDescriptor.AutoCloseOutputStream(descriptor)) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        } catch (Exception failure) {
            getContentResolver().delete(destination, null, null);
            throw new IOException("Media could not be saved to the public album.", failure);
        }
        ContentValues published = new ContentValues();
        published.put(MediaStore.MediaColumns.IS_PENDING, 0);
        getContentResolver().update(destination, published, null, null);
    }

    private void persistGrant(Uri uri, int flags) { try { getContentResolver().takePersistableUriPermission(uri, flags & Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (SecurityException ignored) { } }

    @Override protected void onDestroy() { if (!completed) finishWith(""); super.onDestroy(); }

    private String permissionFor(String kind) { return "camera".equals(kind) ? android.Manifest.permission.CAMERA : "microphone".equals(kind) ? android.Manifest.permission.RECORD_AUDIO : null; }

    private String error(String message) { try { return new JSONObject().put("code", 0).put("msg", message).toString(); } catch (Exception ignored) { return "{\"code\":0,\"msg\":\"Media operation failed.\"}"; } }

    private void finishWith(String value) {
        if (completed) return;
        completed = true;
        if ((value == null || value.isEmpty()) && outputPath != null) { //noinspection ResultOfMethodCallIgnored
            new File(outputPath).delete();
        }
        LynxShipMediaContract.sendResult(getApplicationContext(), getIntent().getStringExtra(LynxShipMediaContract.EXTRA_REQUEST_ID), value);
        outputUri = null; outputPath = null; finish();
    }
}
