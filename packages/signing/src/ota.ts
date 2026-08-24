import {
  assert,
  sha256,
  type Channel,
  type Platform,
  type Release,
} from "@lynxship/contracts";
import {
  createSigningKey,
  createManifest,
  evaluatePolicy,
  signManifest,
  type ManifestAssetInput,
  type SigningKey,
} from "./core.js";

export interface PublishInput {
  projectId: string;
  channel: string;
  platform: Platform;
  runtimeVersion: string;
  assets: ManifestAssetInput[];
  message?: string;
  rollout?: number;
  policyApprovalId?: string | null;
}

export interface HealthSummary {
  activations: number;
  failures: number;
}

export interface HealthOptions {
  maxFailureRate?: number;
  minSamples?: number;
}

export function shouldPauseRollout(
  summary: HealthSummary,
  options: HealthOptions = {},
): boolean {
  const total = summary.activations + summary.failures;
  return (
    total >= (options.minSamples ?? 20) &&
    summary.failures / total > (options.maxFailureRate ?? 0.05)
  );
}

export class OtaService {
  readonly channels = new Map<string, Channel>();

  readonly releases = new Map<string, Release>();

  readonly signingKey: SigningKey;

  constructor(input: SigningKey | { signingKey?: SigningKey } = {}) {
    this.signingKey =
      "keyId" in input ? input : (input.signingKey ?? createSigningKey());
  }

  createChannel(name: string, projectId: string): Channel {
    assert(
      name && projectId,
      "CHANNEL_INPUT",
      "Channel name and projectId are required",
    );
    const key = `${projectId}:${name}`;
    const existing = this.channels.get(key);
    if (existing) return existing;
    const channel: Channel = { name, projectId, releases: [], current: null };
    this.channels.set(key, channel);
    return channel;
  }

  publish(input: PublishInput): Release {
    const policy = evaluatePolicy({
      platform: input.platform,
      policyApprovalId: input.policyApprovalId,
    });
    assert(policy.verdict !== "BLOCK", "OTA_POLICY_BLOCKED", policy.reason);
    assert(
      policy.verdict !== "REVIEW" || input.policyApprovalId,
      "OTA_POLICY_REVIEW",
      policy.reason,
    );
    const channel = this.createChannel(input.channel, input.projectId);
    const manifest = createManifest({
      projectId: input.projectId,
      channel: input.channel,
      platform: input.platform,
      runtimeVersion: input.runtimeVersion,
      sequence: channel.releases.length + 1,
      assets: input.assets,
      keyId: this.signingKey.keyId,
    });
    const release: Release = {
      id: `rel_${Date.now().toString(36)}_${sha256(JSON.stringify(manifest)).slice(0, 10)}`,
      manifest,
      signature: signManifest(manifest, this.signingKey.privateKey),
      message: input.message ?? "",
      rollout: input.rollout ?? 100,
      paused: false,
      createdAt: new Date().toISOString(),
      policy,
    };
    this.releases.set(release.id, release);
    channel.releases.push(release.id);
    channel.current = release.id;
    return release;
  }

  check(input: {
    projectId: string;
    channel: string;
    platform: Platform;
    runtimeVersion: string;
    installationId?: string;
  }): Release | null {
    const channel = this.channels.get(`${input.projectId}:${input.channel}`);
    if (!channel?.current) return null;
    const release = this.releases.get(channel.current);
    if (
      !release ||
      release.paused ||
      release.manifest.platform !== input.platform ||
      release.manifest.runtimeVersion !== input.runtimeVersion
    )
      return null;
    const bucket =
      Number.parseInt(sha256(input.installationId ?? "").slice(0, 8), 16) % 100;
    return bucket < release.rollout ? release : null;
  }

  rollback(input: {
    projectId: string;
    channel: string;
    releaseId: string;
    reason?: string;
  }): Release {
    const channel = this.channels.get(`${input.projectId}:${input.channel}`);
    assert(channel, "CHANNEL_NOT_FOUND", "Channel not found");
    assert(
      input.channel !== "production" || Boolean(input.reason?.trim()),
      "ROLLBACK_REASON_REQUIRED",
      "Production rollback requires a reason",
    );
    assert(
      channel.releases.includes(input.releaseId),
      "RELEASE_CHANNEL_MISMATCH",
      "Release does not belong to channel",
    );
    channel.current = input.releaseId;
    channel.lastRollback = {
      releaseId: input.releaseId,
      reason: input.reason ?? "",
      at: new Date().toISOString(),
    };
    return this.get(input.releaseId);
  }

  pause(id: string): Release {
    const release = this.get(id);
    release.paused = true;
    return release;
  }

  resume(id: string): Release {
    const release = this.get(id);
    release.paused = false;
    return release;
  }

  promote(id: string, rollout: number): Release {
    const release = this.get(id);
    assert(
      Number.isInteger(rollout) && rollout >= 0 && rollout <= 100,
      "ROLLOUT_INVALID",
      "Rollout must be an integer between 0 and 100",
    );
    release.rollout = rollout;
    return release;
  }

  guardHealth(
    id: string,
    summary: HealthSummary,
    options?: HealthOptions,
  ): { paused: boolean; release: Release; rolledBackTo?: string | null } {
    const release = this.get(id);
    if (!shouldPauseRollout(summary, options))
      return { paused: false, release };
    release.paused = true;
    const channel = this.channels.get(
      `${release.manifest.projectId}:${release.manifest.channel}`,
    );
    const previousId = channel?.releases.at(-2);
    if (channel && previousId) channel.current = previousId;
    return { paused: true, release, rolledBackTo: previousId ?? null };
  }

  get(id: string): Release {
    const release = this.releases.get(id);
    assert(release, "RELEASE_NOT_FOUND", "Release not found");
    return release;
  }

  history(projectId: string, channelName: string): Array<Release | undefined> {
    const channel = this.channels.get(`${projectId}:${channelName}`);
    return channel ? channel.releases.map((id) => this.releases.get(id)) : [];
  }

  listChannels(projectId?: string): Channel[] {
    return [...this.channels.values()].filter(
      (channel) => !projectId || channel.projectId === projectId,
    );
  }
}
