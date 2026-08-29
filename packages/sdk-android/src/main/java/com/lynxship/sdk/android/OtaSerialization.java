package com.lynxship.sdk.android;

import org.json.JSONObject;

final class OtaSerialization {
    private OtaSerialization() {}

    static String releaseJson(LynxShipOtaClient.Release release) {
        return "{\"id\":" + JSONObject.quote(release.id) + ",\"signature\":"
                + JSONObject.quote(release.signature) + ",\"manifest\":"
                + manifestJson(release.manifest) + "}";
    }

    private static String manifestJson(LynxShipOtaClient.Manifest manifest) {
        StringBuilder result = new StringBuilder("{\"protocolVersion\":")
                .append(manifest.protocolVersion)
                .append(",\"projectId\":").append(JSONObject.quote(manifest.projectId))
                .append(",\"channel\":").append(JSONObject.quote(manifest.channel))
                .append(",\"platform\":").append(JSONObject.quote(manifest.platform))
                .append(",\"runtimeVersion\":").append(JSONObject.quote(manifest.runtimeVersion))
                .append(",\"sequence\":").append(manifest.sequence)
                .append(",\"keyId\":").append(JSONObject.quote(manifest.keyId))
                .append(",\"assets\":[");
        for (int index = 0; index < manifest.assets.size(); index++) {
            if (index > 0) result.append(',');
            LynxShipOtaClient.Asset asset = manifest.assets.get(index);
            result.append("{\"path\":").append(JSONObject.quote(asset.path))
                    .append(",\"hash\":").append(JSONObject.quote(asset.hash))
                    .append(",\"size\":").append(asset.size)
                    .append(",\"url\":").append(JSONObject.quote(asset.url)).append('}');
        }
        return result.append("]}").toString();
    }
}
