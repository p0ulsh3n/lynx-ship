const {
  withAndroidManifest,
  withGradleProperties,
  withInfoPlist,
  withPodfile,
  withSettingsGradle,
} = require("@expo/config-plugins");

const MARKER = "# @lynxship/expo managed";
const DEFAULT_LYNX_VERSION = "auto";

function optionsFromPluginEntry(entry) {
  if (Array.isArray(entry) && entry[0] === "@lynxship/expo")
    return entry[1] || {};
  return {};
}

function getOptions(config) {
  return (
    (config.plugins || [])
      .map(optionsFromPluginEntry)
      .find((value) => Object.keys(value).length > 0) || {}
  );
}

function assertOptions(options) {
  if (options.endpoint) {
    const url = new URL(options.endpoint);
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname)
    ) {
      throw new Error(
        "@lynxship/expo endpoint must use HTTPS outside localhost",
      );
    }
  }
  if (options.publicKeys) {
    for (const [key, value] of Object.entries(options.publicKeys)) {
      if (
        !key ||
        typeof value !== "string" ||
        !value.includes("BEGIN PUBLIC KEY")
      ) {
        throw new Error(
          "@lynxship/expo publicKeys must contain PEM public keys",
        );
      }
    }
  }
  if (
    options.lynxVersion !== undefined &&
    options.lynxVersion !== "auto" &&
    options.lynxVersion !== "latest" &&
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.lynxVersion)
  ) {
    throw new Error(
      "@lynxship/expo lynxVersion must be auto, latest, or an exact semver",
    );
  }
  return options;
}

function lynxVersion(options) {
  return options.lynxVersion || DEFAULT_LYNX_VERSION;
}

function gradleLynxVersion(options) {
  const value = lynxVersion(options);
  return value === "auto" || value === "latest" ? "latest.release" : value;
}

function addAndroidMetaData(application, name, value) {
  application["meta-data"] = application["meta-data"] || [];
  const existing = application["meta-data"].find(
    (item) => item.$ && item.$["android:name"] === name,
  );
  if (existing) existing.$["android:value"] = value;
  else
    application["meta-data"].push({
      $: { "android:name": name, "android:value": value },
    });
}

function withLynxShipAndroidManifest(config, options) {
  return withAndroidManifest(config, (value) => {
    const manifest = value.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    if (
      !manifest["uses-permission"].some(
        (item) =>
          item.$ && item.$["android:name"] === "android.permission.INTERNET",
      )
    ) {
      manifest["uses-permission"].push({
        $: { "android:name": "android.permission.INTERNET" },
      });
    }
    const application = manifest.application && manifest.application[0];
    if (!application)
      throw new Error("@lynxship/expo requires an Android application node");
    const metadata = {
      endpoint: options.endpoint || "",
      projectId: options.projectId || "",
      channel: options.channel || "production",
      runtimeVersion: options.runtimeVersion || "",
      embeddedBundle: options.embeddedBundle || "main.lynx.bundle",
      publicKeys: JSON.stringify(options.publicKeys || {}),
      maxReleaseBytes: String(options.maxReleaseBytes || 104857600),
    };
    for (const [key, item] of Object.entries(metadata))
      addAndroidMetaData(application, `com.lynxship.expo.${key}`, item);
    return value;
  });
}

function withLynxShipInfoPlist(config, options) {
  return withInfoPlist(config, (value) => {
    value.modResults.LynxShipExpo = {
      endpoint: options.endpoint || "",
      projectId: options.projectId || "",
      channel: options.channel || "production",
      runtimeVersion: options.runtimeVersion || "",
      embeddedBundle: options.embeddedBundle || "main.lynx.bundle",
      publicKeys: options.publicKeys || {},
      maxReleaseBytes: options.maxReleaseBytes || 104857600,
    };
    return value;
  });
}

function withLynxShipGradle(config, options) {
  return withGradleProperties(config, (value) => {
    const properties = value.modResults;
    const key = "LYNXSHIP_LYNX_VERSION";
    const current = properties.find((item) => item.key === key);
    if (current) current.value = gradleLynxVersion(options);
    else
      properties.push({
        type: "property",
        key,
        value: gradleLynxVersion(options),
      });
    const androidX = properties.find(
      (item) => item.key === "android.useAndroidX",
    );
    if (androidX) androidX.value = "true";
    else
      properties.push({
        type: "property",
        key: "android.useAndroidX",
        value: "true",
      });
    return value;
  });
}

function withLynxShipAndroidSdk(config) {
  return withSettingsGradle(config, (value) => {
    const settings = value.modResults.contents;
    if (settings.includes("@lynxship/expo managed sdk")) return value;
    value.modResults.contents = `${settings.trimEnd()}\n\n// @lynxship/expo managed sdk\ninclude ':lynxship-sdk-android'\nproject(':lynxship-sdk-android').projectDir = new File(rootDir, '../node_modules/@lynxship/sdk-android')\n`;
    return value;
  });
}

function withLynxShipPodfile(config, options) {
  return withPodfile(config, (value) => {
    const podfile = value.modResults.contents;
    if (podfile.includes(MARKER)) return value;
    const additions = [
      `  ${MARKER}`,
      ...(lynxVersion(options) === "auto" || lynxVersion(options) === "latest"
        ? []
        : [`  ENV['LYNXSHIP_LYNX_VERSION'] = '${lynxVersion(options)}'`]),
      "  pod 'LynxShipOta', :path => '../node_modules/@lynxship/sdk-ios'",
      `  ${MARKER} end`,
    ].join("\n");
    const target = podfile.search(/^target\s+['\"][^'\"]+['\"]\s+do\s*$/m);
    if (target < 0)
      throw new Error("@lynxship/expo could not find an iOS Podfile target");
    const lineEnd = podfile.indexOf("\n", target);
    value.modResults.contents = `${podfile.slice(0, lineEnd + 1)}${additions}\n${podfile.slice(lineEnd + 1)}`;
    return value;
  });
}

function withLynxShipExpo(config, props = {}) {
  const options = assertOptions({ ...getOptions(config), ...props });
  return withLynxShipPodfile(
    withLynxShipAndroidSdk(
      withLynxShipGradle(
        withLynxShipInfoPlist(
          withLynxShipAndroidManifest(config, options),
          options,
        ),
        options,
      ),
    ),
    options,
  );
}

module.exports = withLynxShipExpo;
