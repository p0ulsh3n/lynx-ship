package com.lynxship.sdk.android;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Package-private file and byte-stream operations used by the OTA facade. */
final class OtaFiles {
    private OtaFiles() {}

    static String readText(InputStream input, long maxBytes) throws IOException {
        return new String(readBytes(input, maxBytes), StandardCharsets.UTF_8);
    }

    static byte[] readBytes(InputStream input, long maxBytes) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int read;
        long count = 0;
        while ((read = input.read(buffer)) != -1) {
            count += read;
            if (count > maxBytes) throw new IOException("OTA response exceeds size limit");
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    static byte[] readBytes(File file, long maxBytes) throws IOException {
        try (InputStream input = new FileInputStream(file)) {
            return readBytes(input, maxBytes);
        }
    }

    static void writeText(File file, String value) throws IOException {
        File temporary = new File(file.getParentFile(), file.getName() + ".tmp");
        try (BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(temporary))) {
            output.write(value.getBytes(StandardCharsets.UTF_8));
        }
        if (file.exists() && !file.delete()) throw new IOException("Could not replace OTA state file");
        if (!temporary.renameTo(file)) throw new IOException("Could not commit OTA state file");
    }

    static void copyDirectory(File source, File target) throws IOException {
        if (!source.isDirectory()) return;
        if (!target.mkdirs() && !target.isDirectory()) throw new IOException("Could not create OTA backup");
        File[] children = source.listFiles();
        if (children == null) return;
        for (File child : children) {
            File destination = new File(target, child.getName());
            if (child.isDirectory()) copyDirectory(child, destination);
            else writeFile(destination, readBytes(child, 100L * 1024L * 1024L));
        }
    }

    static void writeFile(File file, byte[] value) throws IOException {
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("Could not create OTA directory");
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(value);
        }
    }

    static void deleteRecursively(File file) throws IOException {
        if (!file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        if (!file.delete()) throw new IOException("Could not remove OTA temporary data");
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }
}
