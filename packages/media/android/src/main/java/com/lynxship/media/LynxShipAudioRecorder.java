package com.lynxship.media;

import android.content.Context;
import android.net.Uri;
import android.os.Environment;

import androidx.core.content.FileProvider;

import com.lynx.react.bridge.Callback;

import java.io.File;
import java.io.IOException;

/**
 * Owns one app-scoped Android MediaRecorder session.
 *
 * The class deliberately exposes a small start/stop lifecycle to the Lynx
 * bridge. Files are kept in the app's external-files directory, so no broad
 * storage permission is needed and a failed session can be removed safely.
 */
final class LynxShipAudioRecorder {
    private final Object lock = new Object();
    private final Context context;
    private android.media.MediaRecorder recorder;
    private File outputFile;

    LynxShipAudioRecorder(Context context) {
        this.context = context.getApplicationContext();
    }

    void start(Callback callback) {
        boolean started = false;
        synchronized (lock) {
            if (recorder == null) {
                try {
                    File directory = context.getExternalFilesDir(Environment.DIRECTORY_MUSIC);
                    if (directory == null) directory = context.getFilesDir();
                    if (!directory.mkdirs() && !directory.isDirectory()) throw new IOException("Audio directory unavailable");
                    File file = File.createTempFile("lynxship-recording-", ".m4a", directory);
                    android.media.MediaRecorder candidate = android.os.Build.VERSION.SDK_INT >= 31
                            ? new android.media.MediaRecorder(context)
                            : new android.media.MediaRecorder();
                    candidate.setAudioSource(android.media.MediaRecorder.AudioSource.MIC);
                    candidate.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4);
                    candidate.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC);
                    candidate.setAudioSamplingRate(44_100);
                    candidate.setAudioEncodingBitRate(128_000);
                    candidate.setOutputFile(file.getAbsolutePath());
                    candidate.prepare();
                    candidate.start();
                    recorder = candidate;
                    outputFile = file;
                    started = true;
                } catch (Exception error) {
                    releaseAndDeleteLocked();
                }
            }
        }
        callback.invoke(started);
    }

    void stop(Callback callback) {
        String result = "";
        synchronized (lock) {
            android.media.MediaRecorder active = recorder;
            File file = outputFile;
            recorder = null;
            outputFile = null;
            if (active != null) {
                try {
                    active.stop();
                    active.release();
                    if (file != null && file.isFile() && file.length() > 0) {
                        result = FileProvider.getUriForFile(
                                context,
                                context.getPackageName() + ".lynxship.media.fileprovider",
                                file).toString();
                    } else if (file != null) {
                        // An empty recording is not a valid media result.
                        //noinspection ResultOfMethodCallIgnored
                        file.delete();
                    }
                } catch (RuntimeException error) {
                    try {
                        active.reset();
                    } catch (RuntimeException ignored) {
                        // The recorder is already unusable; release below.
                    }
                    active.release();
                    if (file != null) {
                        //noinspection ResultOfMethodCallIgnored
                        file.delete();
                    }
                }
            }
        }
        callback.invoke(result);
    }

    void cancel() {
        synchronized (lock) {
            releaseAndDeleteLocked();
        }
    }

    private void releaseAndDeleteLocked() {
        if (recorder != null) {
            try {
                recorder.reset();
            } catch (RuntimeException ignored) {
                // Best-effort reset before releasing a failed recorder.
            }
            recorder.release();
            recorder = null;
        }
        if (outputFile != null) {
            //noinspection ResultOfMethodCallIgnored
            outputFile.delete();
            outputFile = null;
        }
    }
}
