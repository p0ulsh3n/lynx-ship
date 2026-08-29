package com.lynxship.sdk.android;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Small, dependency-light OTA client for a Lynx Android host.
 *
 * The client never activates a downloaded release before its manifest,
 * signature, path, size and SHA-256 hash have all been checked. The host
 * renders the active bundle through TemplateProvider#openActiveAsset.
 *
 * The public class remains a compatibility facade for the OTA lifecycle;
 * release validation, serialization and state persistence live in the
 * package-private helpers beside it.
 */
public final class LynxShipOtaClient {
    public interface EmbeddedAssetProvider {
        byte[] read(String path) throws IOException;
    }

    public interface Listener {
        void onSuccess(boolean updateAvailable);

        void onFailure(Exception error);
    }

    public static final class Config {
        public final File storageDirectory;
        public final String endpoint;
        public final String projectId;
        public final String channel;
        public final String platform;
        public final String runtimeVersion;
        public final String installationId;
        public final Map<String, String> publicKeys;
        public final EmbeddedAssetProvider embeddedAssets;
        public final int maxConsecutiveFailures;
        public final long maxReleaseBytes;
        public final int connectTimeoutMs;
        public final int readTimeoutMs;

        public Config(
                File storageDirectory,
                String endpoint,
                String projectId,
                String channel,
                String platform,
                String runtimeVersion,
                String installationId,
                Map<String, String> publicKeys,
                EmbeddedAssetProvider embeddedAssets) {
            this(
                    storageDirectory,
                    endpoint,
                    projectId,
                    channel,
                    platform,
                    runtimeVersion,
                    installationId,
                    publicKeys,
                    embeddedAssets,
                    3,
                    100L * 1024L * 1024L,
                    10_000,
                    30_000);
        }

        public Config(
                File storageDirectory,
                String endpoint,
                String projectId,
                String channel,
                String platform,
                String runtimeVersion,
                String installationId,
                Map<String, String> publicKeys,
                EmbeddedAssetProvider embeddedAssets,
                int maxConsecutiveFailures,
                long maxReleaseBytes,
                int connectTimeoutMs,
                int readTimeoutMs) {
            if (storageDirectory == null || endpoint == null || projectId == null
                    || channel == null || platform == null || runtimeVersion == null
                    || installationId == null || publicKeys == null || embeddedAssets == null) {
                throw new IllegalArgumentException("LynxShip OTA configuration is incomplete");
            }
            if (!"android".equals(platform)) {
                throw new IllegalArgumentException("Android client requires platform=android");
            }
            if (maxConsecutiveFailures < 1 || maxReleaseBytes < 1) {
                throw new IllegalArgumentException("OTA safety limits must be positive");
            }
            this.storageDirectory = storageDirectory;
            this.endpoint = trimEndpoint(endpoint);
            this.projectId = projectId;
            this.channel = channel;
            this.platform = platform;
            this.runtimeVersion = runtimeVersion;
            this.installationId = installationId;
            this.publicKeys = Collections.unmodifiableMap(new HashMap<>(publicKeys));
            this.embeddedAssets = embeddedAssets;
            this.maxConsecutiveFailures = maxConsecutiveFailures;
            this.maxReleaseBytes = maxReleaseBytes;
            this.connectTimeoutMs = connectTimeoutMs;
            this.readTimeoutMs = readTimeoutMs;
        }
    }

    public static final class Release {
        public final String id;
        public final String signature;
        public final Manifest manifest;

        private Release(String id, String signature, Manifest manifest) {
            this.id = id;
            this.signature = signature;
            this.manifest = manifest;
        }

        static Release parse(JSONObject value) throws Exception {
            if (value == null || value.length() == 0) return null;
            JSONObject manifestValue = value.optJSONObject("manifest");
            if (manifestValue == null) throw new IOException("OTA release has no manifest");
            return new Release(
                    value.optString("id", "sequence-" + manifestValue.optInt("sequence", 0)),
                    value.optString("signature", ""),
                    Manifest.parse(manifestValue));
        }
    }

    public static final class Manifest {
        public final int protocolVersion;
        public final String projectId;
        public final String channel;
        public final String platform;
        public final String runtimeVersion;
        public final long sequence;
        public final String keyId;
        public final List<Asset> assets;

        private Manifest(
                int protocolVersion,
                String projectId,
                String channel,
                String platform,
                String runtimeVersion,
                long sequence,
                String keyId,
                List<Asset> assets) {
            this.protocolVersion = protocolVersion;
            this.projectId = projectId;
            this.channel = channel;
            this.platform = platform;
            this.runtimeVersion = runtimeVersion;
            this.sequence = sequence;
            this.keyId = keyId;
            this.assets = Collections.unmodifiableList(assets);
        }

        static Manifest parse(JSONObject value) throws Exception {
            JSONArray values = value.optJSONArray("assets");
            if (values == null || values.length() == 0) throw new IOException("OTA manifest has no assets");
            List<Asset> assets = new ArrayList<>();
            for (int index = 0; index < values.length(); index++) {
                assets.add(Asset.parse(values.getJSONObject(index)));
            }
            return new Manifest(
                    value.optInt("protocolVersion", 0),
                    value.optString("projectId", ""),
                    value.optString("channel", ""),
                    value.optString("platform", ""),
                    value.optString("runtimeVersion", ""),
                    value.optLong("sequence", 0),
                    value.optString("keyId", ""),
                    assets);
        }
    }

    public static final class Asset {
        public final String path;
        public final String hash;
        public final long size;
        public final String url;

        private Asset(String path, String hash, long size, String url) {
            this.path = path;
            this.hash = hash;
            this.size = size;
            this.url = url;
        }

        static Asset parse(JSONObject value) throws Exception {
            String path = value.optString("path", "");
            String hash = value.optString("hash", "");
            long size = value.optLong("size", -1);
            String url = value.optString("url", "");
            if (!OtaSecurity.isSafePath(path) || hash.length() != 64 || size < 0 || url.length() == 0) {
                throw new IOException("Invalid OTA asset metadata");
            }
            return new Asset(path, hash.toLowerCase(), size, url);
        }
    }

    private final Config config;
    private final File activeDirectory;
    private final File candidateDirectory;
    private final File lastKnownGoodDirectory;
    private final OtaStateStore stateStore;
    private final Object lock = new Object();

    public LynxShipOtaClient(Config config) throws IOException {
        this.config = config;
        if (!config.storageDirectory.exists() && !config.storageDirectory.mkdirs()) {
            throw new IOException("Could not create OTA storage directory");
        }
        this.activeDirectory = new File(config.storageDirectory, "active");
        this.candidateDirectory = new File(config.storageDirectory, "candidate");
        this.lastKnownGoodDirectory = new File(config.storageDirectory, "last-known-good");
        this.stateStore = new OtaStateStore(new File(config.storageDirectory, "state.properties"));
        recoverInterruptedActivation();
    }

    public void checkAndInstallAsync(final Listener listener) {
        new Thread(() -> {
            try {
                Release release = checkForUpdate();
                boolean installed = release != null && installCandidate(release);
                listener.onSuccess(installed);
            } catch (Exception error) {
                listener.onFailure(error);
            }
        }, "lynxship-ota-check").start();
    }

    public Release checkForUpdate() throws Exception {
        URL url = new URL(config.endpoint + "/v1/ota/check?projectId="
                + encode(config.projectId) + "&channel=" + encode(config.channel)
                + "&platform=android&runtimeVersion=" + encode(config.runtimeVersion)
                + "&installationId=" + encode(config.installationId));
        HttpURLConnection connection = open(url);
        try {
            int status = connection.getResponseCode();
            if (status == HttpURLConnection.HTTP_NOT_FOUND || status == HttpURLConnection.HTTP_NO_CONTENT) return null;
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("OTA check failed with HTTP " + status);
            String body = OtaFiles.readText(connection.getInputStream(), 1_000_000);
            if (body.trim().equals("null")) return null;
            return Release.parse(new JSONObject(body));
        } finally {
            connection.disconnect();
        }
    }

    public boolean installCandidate(Release release) throws Exception {
        synchronized (lock) {
            OtaSecurity.validateRelease(config, release);
            if (release.manifest.sequence <= activeSequence()) return false;
            File temporary = new File(config.storageDirectory, "download-" + release.manifest.sequence + ".tmp");
            OtaFiles.deleteRecursively(temporary);
            if (!temporary.mkdirs()) throw new IOException("Could not create OTA download directory");
            try {
                long total = 0;
                for (Asset asset : release.manifest.assets) {
                    total += downloadAsset(asset, temporary);
                    if (total > config.maxReleaseBytes) throw new IOException("OTA release exceeds size limit");
                }
                OtaFiles.writeText(new File(temporary, "release.json"), OtaSerialization.releaseJson(release));
                OtaFiles.deleteRecursively(candidateDirectory);
                if (!temporary.renameTo(candidateDirectory)) throw new IOException("Could not stage OTA candidate atomically");
                stateStore.set("candidateSequence", Long.toString(release.manifest.sequence));
                stateStore.set("candidateId", release.id);
                stateStore.set("candidatePending", "true");
                stateStore.save();
                return true;
            } catch (Exception error) {
                OtaFiles.deleteRecursively(temporary);
                throw error;
            }
        }
    }

    public void activateCandidate() throws IOException {
        synchronized (lock) {
            if (!candidateDirectory.exists()) return;
            OtaFiles.deleteRecursively(lastKnownGoodDirectory);
            if (activeDirectory.exists() && !activeDirectory.renameTo(lastKnownGoodDirectory)) {
                throw new IOException("Could not preserve the last-known-good OTA release");
            }
            if (!candidateDirectory.renameTo(activeDirectory)) throw new IOException("Could not activate OTA candidate");
            stateStore.set("activeSequence", Long.toString(stateStore.getLong("candidateSequence", 0)));
            stateStore.set("activeId", stateStore.get("candidateId", ""));
            stateStore.set("candidatePending", "false");
            stateStore.set("failedLaunches", "0");
            stateStore.save();
        }
    }

    public void beginLaunch() throws IOException {
        synchronized (lock) {
            if (!activeDirectory.exists() || activeSequence() == lastKnownGoodSequence()) return;
            long failures = stateStore.getLong("failedLaunches", 0) + 1;
            stateStore.set("failedLaunches", Long.toString(failures));
            stateStore.save();
            if (failures >= config.maxConsecutiveFailures) rollbackToLastKnownGood();
        }
    }

    public void markLaunchSuccess() throws IOException {
        synchronized (lock) {
            if (!activeDirectory.exists()) return;
            OtaFiles.deleteRecursively(lastKnownGoodDirectory);
            OtaFiles.copyDirectory(activeDirectory, lastKnownGoodDirectory);
            stateStore.set("lastGoodSequence", Long.toString(activeSequence()));
            stateStore.set("lastGoodId", stateStore.get("activeId", "embedded"));
            stateStore.set("failedLaunches", "0");
            stateStore.save();
        }
    }

    public byte[] openActiveAsset(String path) throws IOException {
        if (!OtaSecurity.isSafePath(path)) throw new IOException("Unsafe OTA asset path");
        synchronized (lock) {
            File active = new File(activeDirectory, path);
            if (active.isFile()) return OtaFiles.readBytes(active, config.maxReleaseBytes);
        }
        return config.embeddedAssets.read(path);
    }

    public long activeSequence() {
        return stateStore.getLong("activeSequence", 0);
    }

    private long downloadAsset(Asset asset, File directory) throws Exception {
        OtaSecurity.validateUrl(asset.url);
        File target = new File(directory, asset.path);
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("Could not create OTA asset directory");
        HttpURLConnection connection = open(new URL(asset.url));
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) throw new IOException("OTA asset download failed with HTTP " + connection.getResponseCode());
            long length = connection.getContentLengthLong();
            if (length > config.maxReleaseBytes || (length >= 0 && length != asset.size)) throw new IOException("OTA asset size does not match its manifest");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long count = 0;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    count += read;
                    if (count > asset.size || count > config.maxReleaseBytes) throw new IOException("OTA asset exceeds its manifest size");
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                }
            }
            if (count != asset.size || !OtaFiles.hex(digest.digest()).equals(asset.hash)) throw new SecurityException("OTA asset integrity check failed for " + asset.path);
            return count;
        } finally {
            connection.disconnect();
        }
    }

    private void recoverInterruptedActivation() throws IOException {
        synchronized (lock) {
            if (stateStore.get("candidatePending", "false").equals("true") && candidateDirectory.exists()) activateCandidate();
            if (stateStore.getLong("failedLaunches", 0) >= config.maxConsecutiveFailures) rollbackToLastKnownGood();
        }
    }

    private void rollbackToLastKnownGood() throws IOException {
        if (!lastKnownGoodDirectory.exists()) return;
        OtaFiles.deleteRecursively(activeDirectory);
        if (!lastKnownGoodDirectory.renameTo(activeDirectory)) throw new IOException("Could not rollback OTA release");
        stateStore.set("activeSequence", stateStore.get("lastGoodSequence", "0"));
        stateStore.set("activeId", stateStore.get("lastGoodId", "embedded"));
        stateStore.set("failedLaunches", "0");
        stateStore.save();
    }

    private HttpURLConnection open(URL url) throws IOException {
        OtaSecurity.validateUrl(url.toString());
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(config.connectTimeoutMs);
        connection.setReadTimeout(config.readTimeoutMs);
        connection.setRequestProperty("Accept", "application/json, application/octet-stream");
        connection.setUseCaches(false);
        return connection;
    }

    private static String trimEndpoint(String value) {
        String result = value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }

    private static String encode(String value) throws IOException {
        try {
            return java.net.URLEncoder.encode(value, "UTF-8");
        } catch (Exception error) {
            throw new IOException("Could not encode OTA query", error);
        }
    }

    private long lastKnownGoodSequence() {
        return stateStore.getLong("lastGoodSequence", 0);
    }

}
