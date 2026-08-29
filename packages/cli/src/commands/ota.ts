import { assert, createId, sha256, type Platform } from "@lynxship/contracts";
import { createSigningKey, signManifest } from "@lynxship/signing";
import {
  fetchOtaPublicKey,
  publishOtaRelease,
  rollbackOtaRelease,
} from "../remote.js";
import { uploadR2Artifact } from "../r2.js";
import {
  assertCompatibleBinaryBuild,
  inspectRuntimeFingerprint,
} from "../runtime-fingerprint.js";
import { otaAssetName, otaAssetPaths } from "../ota-assets.js";
import { exists } from "../runtime/project.js";
import { saveState, type CliRelease, type CliState } from "../runtime/state.js";
import type { BuildOrchestrator } from "@lynxship/build-orchestrator";
import type { JsonRepository } from "@lynxship/db";
import type { SubmissionService } from "@lynxship/submit";
import { loadConfig, type LynxShipConfig } from "../config.js";
import type { BoxRow, CliUi } from "../ui/index.js";

export interface OtaCommandContext {
  root: string;
  args: string[];
  ui: CliUi;
  flag: (name: string, fallback?: string | null) => string | null;
  printValue: (
    value: unknown,
    view?: { title: string; rows: BoxRow[]; done: string },
  ) => void;
  requireOperationalConfiguration: (platform: Platform) => Promise<void>;
  requireR2Configuration: () => Promise<void>;
  configuredProjectId: (config: LynxShipConfig) => string;
  mobilePlatformValue: (value: string) => "android" | "ios";
  state: CliState;
  repository: JsonRepository<CliState>;
  builds: BuildOrchestrator;
  submissions: SubmissionService;
}

export async function runOtaCommand(
  context: OtaCommandContext,
  command: string,
): Promise<void> {
  const {
    root,
    args,
    ui,
    flag,
    printValue,
    requireOperationalConfiguration,
    requireR2Configuration,
    configuredProjectId,
    mobilePlatformValue,
    state,
    repository,
    builds,
    submissions,
  } = context;
  if (command === "update" && args[0] !== "rollback") {
    const config = await loadConfig(root);
    const platform = mobilePlatformValue(flag("--platform", "android")!);
    await requireOperationalConfiguration(platform);
    const projectId = configuredProjectId(config);
    const localMode =
      args.includes("--local") || process.env.LYNXSHIP_SUBMIT_MODE === "mock";
    const explicitBundles = flag("--bundle");
    const runtime = await inspectRuntimeFingerprint(root, platform, config);
    const progress = ui.progress("Sign manifest");
    try {
      if (localMode) {
        const key = state.signingKey ?? createSigningKey();
        const data = flag("--bundle", "local-bundle")!;
        const manifest = {
          protocolVersion: 1,
          projectId,
          channel: config.update?.channel ?? "production",
          platform,
          runtimeVersion: runtime.value,
          sequence: state.releases.length + 1,
          keyId: key.keyId,
          assets: [
            {
              path: "main.js",
              hash: sha256(data),
              size: Buffer.byteLength(data),
            },
          ],
        };
        const release: CliRelease = {
          id: createId("rel"),
          manifest,
          signature: signManifest(manifest, key.privateKey),
          message: flag("--message", "local update")!,
          createdAt: new Date().toISOString(),
        };
        state.releases.push(release);
        await saveState(state, repository, builds, submissions);
        progress.update(100);
        printValue(release, {
          title: "OTA update published locally",
          rows: [
            { label: "Release ID", value: release.id, valueColor: "purple" },
            {
              label: "Platform",
              value: release.manifest.platform,
              valueColor: "blue",
            },
            {
              label: "Signature",
              value: "Ed25519 signed",
              valueColor: "muted",
            },
          ],
          done: "Local update created. Use a real API and bundle for devices.",
        });
        return;
      }

      const bundlePaths = await otaAssetPaths(root, explicitBundles);
      for (const bundlePath of bundlePaths)
        assert(
          await exists(bundlePath),
          "OTA_BUNDLE_REQUIRED",
          `Bundle not found: ${bundlePath}. Build the Lynx bundle first or pass --bundle.`,
        );
      assertCompatibleBinaryBuild(builds, platform, runtime.value);
      const releaseId = createId("ota");
      progress.update(
        25,
        `Uploading ${bundlePaths.length} Lynx asset(s) to Cloudflare R2…`,
      );
      const uploadedAssets = [];
      for (const [index, bundlePath] of bundlePaths.entries()) {
        const uploaded = await uploadR2Artifact(
          root,
          projectId,
          releaseId,
          bundlePath,
          "application/octet-stream",
          otaAssetName(root, bundlePath),
        );
        uploadedAssets.push({
          path: otaAssetName(root, bundlePath),
          hash: uploaded.hash,
          size: uploaded.size,
          url: uploaded.url,
        });
        progress.update(
          25 + Math.round(((index + 1) / bundlePaths.length) * 35),
          `Uploaded ${index + 1}/${bundlePaths.length} Lynx asset(s)…`,
        );
      }
      progress.update(
        65,
        "Publishing signed OTA release through LynxShip API…",
      );
      const remoteRelease = (await publishOtaRelease(config, state, {
        projectId,
        organizationId: "local_org",
        channel: config.update?.channel ?? "production",
        platform,
        runtimeVersion: runtime.value,
        assets: uploadedAssets,
        message: flag("--message", "OTA update")!,
        rollout: config.update?.rollout?.defaultPercentage ?? 100,
        policyApprovalId: flag("--policy-approval-id"),
      })) as CliRelease;
      const publicKey = await fetchOtaPublicKey(config);
      state.releases.push(remoteRelease);
      await saveState(state, repository, builds, submissions);
      progress.update(100, "OTA release signed and published");
      printValue(
        { ...remoteRelease, signingKey: publicKey },
        {
          title: "OTA update published",
          rows: [
            {
              label: "Release ID",
              value: remoteRelease.id,
              valueColor: "purple",
            },
            {
              label: "Platform",
              value: remoteRelease.manifest.platform,
              valueColor: "blue",
            },
            { label: "Bundle", value: "Cloudflare R2", valueColor: "orange" },
            {
              label: "Signature",
              value: "Ed25519 signed by API",
              valueColor: "green",
            },
          ],
          done: "Devices can check and install this compatible OTA release.",
        },
      );
    } finally {
      progress.stop();
    }
    return;
  }

  if (
    command === "rollback" ||
    (command === "update" && args[0] === "rollback")
  ) {
    if (command === "update") args.shift();
    const config = await loadConfig(root);
    const platform = mobilePlatformValue(flag("--platform", "android")!);
    const releaseId = flag("--release-id");
    const reason = flag("--reason");
    const channel = config.update?.channel ?? "production";
    const localMode = args.includes("--local");
    assert(
      Boolean(releaseId && releaseId !== "true"),
      "ROLLBACK_RELEASE_REQUIRED",
      "Pass the release to restore with `--release-id <id>`.",
    );
    assert(
      Boolean(reason?.trim()) && reason !== "true",
      "ROLLBACK_REASON_REQUIRED",
      'Pass an audit reason with `--reason "..."`.',
    );
    await requireR2Configuration();
    const progress = ui.progress("OTA rollback");
    try {
      progress.update(10, `Selecting ${releaseId} for ${channel}…`);
      if (localMode) {
        const release = state.releases.find(
          (candidate) =>
            candidate.id === releaseId &&
            candidate.manifest.channel === channel &&
            candidate.manifest.platform === platform,
        );
        assert(
          release,
          "RELEASE_NOT_FOUND",
          `Local release ${releaseId} was not found in channel ${channel} for ${platform}.`,
        );
        state.lastRollback = {
          releaseId: release.id,
          reason: reason!,
          at: new Date().toISOString(),
        };
        await saveState(state, repository, builds, submissions);
        progress.update(100, "Local OTA channel rolled back");
        printValue(
          { status: "rolled_back", release, rollback: state.lastRollback },
          {
            title: "OTA rollback",
            rows: [
              { label: "Release ID", value: release.id, valueColor: "purple" },
              { label: "Platform", value: platform, valueColor: "blue" },
              { label: "Channel", value: channel, valueColor: "orange" },
              { label: "Reason", value: reason!, valueColor: "muted" },
            ],
            done: "Local OTA channel now points to the selected release.",
          },
        );
        return;
      }

      progress.update(45, "Requesting rollback through LynxShip API…");
      const release = (await rollbackOtaRelease(config, state, {
        projectId: configuredProjectId(config),
        channel,
        platform,
        releaseId: releaseId!,
        reason: reason!,
      })) as CliRelease;
      state.lastRollback = {
        releaseId: release.id,
        reason: reason!,
        at: new Date().toISOString(),
      };
      await saveState(state, repository, builds, submissions);
      progress.update(100, "OTA channel rolled back");
      printValue(
        { status: "rolled_back", release, rollback: state.lastRollback },
        {
          title: "OTA rollback",
          rows: [
            { label: "Release ID", value: release.id, valueColor: "purple" },
            { label: "Platform", value: platform, valueColor: "blue" },
            { label: "Channel", value: channel, valueColor: "orange" },
            { label: "Reason", value: reason!, valueColor: "muted" },
          ],
          done: "Devices will receive the selected compatible release on their next OTA check.",
        },
      );
    } finally {
      progress.stop();
    }
    return;
  }

  assert(command === "build", "CLI_COMMAND", `Unknown command: ${command}`);
}
