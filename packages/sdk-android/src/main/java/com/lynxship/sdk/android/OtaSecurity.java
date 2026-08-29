package com.lynxship.sdk.android;

import android.util.Base64;

import org.json.JSONObject;

import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

final class OtaSecurity {
    private OtaSecurity() {}

    static boolean isSafePath(String path) {
        return path != null && !path.isEmpty() && !path.startsWith("/") && !path.contains("\\")
                && !path.contains("..") && !new java.io.File(path).isAbsolute();
    }

    static void validateRelease(LynxShipOtaClient.Config config, LynxShipOtaClient.Release release)
            throws Exception {
        LynxShipOtaClient.Manifest manifest = release == null ? null : release.manifest;
        if (manifest == null || manifest.protocolVersion != 1
                || !config.projectId.equals(manifest.projectId)
                || !config.channel.equals(manifest.channel)
                || !config.platform.equals(manifest.platform)
                || !config.runtimeVersion.equals(manifest.runtimeVersion)) {
            throw new IOException("OTA release is incompatible with this application");
        }
        String key = config.publicKeys.get(manifest.keyId);
        if (key == null || !verifySignature(manifest, release.signature, key)) {
            throw new SecurityException("OTA manifest signature is invalid or revoked");
        }
        long total = 0;
        for (LynxShipOtaClient.Asset asset : manifest.assets) {
            validateUrl(asset.url);
            total += asset.size;
            if (total > config.maxReleaseBytes) throw new IOException("OTA release exceeds size limit");
        }
    }

    static void validateUrl(String value) throws IOException {
        URL url = new URL(value);
        if (!"https".equalsIgnoreCase(url.getProtocol())
                && !("http".equalsIgnoreCase(url.getProtocol()) && isLocalHost(url.getHost()))) {
            throw new IOException("OTA URLs must use HTTPS outside localhost");
        }
    }

    private static boolean isLocalHost(String host) {
        return "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host) || "10.0.2.2".equals(host);
    }

    private static boolean verifySignature(LynxShipOtaClient.Manifest manifest, String encodedSignature,
            String pem) throws Exception {
        String normalized = pem.replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "").replaceAll("\\s", "");
        PublicKey key = KeyFactory.getInstance("Ed25519")
                .generatePublic(new X509EncodedKeySpec(Base64.decode(normalized, Base64.DEFAULT)));
        Signature signature = Signature.getInstance("Ed25519");
        signature.initVerify(key);
        signature.update(canonicalManifest(manifest).getBytes(StandardCharsets.UTF_8));
        return signature.verify(Base64.decode(encodedSignature, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING));
    }

    private static String canonicalManifest(LynxShipOtaClient.Manifest manifest) {
        List<LynxShipOtaClient.Asset> assets = new ArrayList<>(manifest.assets);
        assets.sort(Comparator.comparing(asset -> asset.path));
        StringBuilder result = new StringBuilder("{\"assets\":[");
        for (int index = 0; index < assets.size(); index++) {
            if (index > 0) result.append(',');
            LynxShipOtaClient.Asset asset = assets.get(index);
            result.append("{\"hash\":").append(JSONObject.quote(asset.hash))
                    .append(",\"path\":").append(JSONObject.quote(asset.path))
                    .append(",\"size\":").append(asset.size)
                    .append(",\"url\":").append(JSONObject.quote(asset.url)).append('}');
        }
        return result.append("],\"channel\":").append(JSONObject.quote(manifest.channel))
                .append(",\"keyId\":").append(JSONObject.quote(manifest.keyId))
                .append(",\"platform\":").append(JSONObject.quote(manifest.platform))
                .append(",\"projectId\":").append(JSONObject.quote(manifest.projectId))
                .append(",\"protocolVersion\":").append(manifest.protocolVersion)
                .append(",\"runtimeVersion\":").append(JSONObject.quote(manifest.runtimeVersion))
                .append(",\"sequence\":").append(manifest.sequence).append('}').toString();
    }
}
