package com.lynxship.sdk.android;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

/**
 * Atomic, best-effort persistence for the OTA activation state.
 *
 * A damaged state file is deliberately treated as empty so the embedded
 * bundle remains a safe recovery path. Writes are committed through a sibling
 * temporary file and the existing file is replaced only after the temporary
 * file has been fully written.
 */
final class OtaStateStore {
    private final File file;
    private final Properties pending = new Properties();

    OtaStateStore(File file) {
        this.file = file;
    }

    String get(String name, String fallback) {
        return read().getProperty(name, fallback);
    }

    long getLong(String name, long fallback) {
        try {
            return Long.parseLong(get(name, Long.toString(fallback)));
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    void set(String name, String value) {
        pending.put(name, value);
    }

    void save() throws IOException {
        Properties values = read();
        values.putAll(pending);
        File temporary = new File(file.getParentFile(), file.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            values.store(output, "LynxShip OTA state");
        }
        if (file.exists() && !file.delete()) {
            throw new IOException("Could not replace OTA state");
        }
        if (!temporary.renameTo(file)) {
            throw new IOException("Could not commit OTA state");
        }
        pending.clear();
        pending.putAll(values);
    }

    private Properties read() {
        Properties values = new Properties();
        if (!file.isFile()) return values;
        try (InputStream input = new FileInputStream(file)) {
            values.load(input);
        } catch (Exception ignored) {
            // A corrupt state must never prevent the embedded bundle from starting.
        }
        return values;
    }
}
