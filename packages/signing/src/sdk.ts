import { assert, sha256, type Release } from "@lynxship/contracts";
import { verifyManifest } from "./core.js";

export class OtaClient {
  readonly state: {
    embedded: Release;
    lastKnownGood: Release;
    candidate: Release | null;
    active: Release;
    failedLaunches: number;
  };

  private readonly publicKeys: Record<string, string>;

  private readonly maxConsecutiveFailedLaunches: number;

  constructor(options: {
    embedded: Release;
    publicKeys?: Record<string, string>;
    maxConsecutiveFailedLaunches?: number;
  }) {
    assert(
      options.embedded.manifest.sequence !== undefined,
      "SDK_EMBEDDED_REQUIRED",
      "Embedded release is required",
    );
    this.publicKeys = options.publicKeys ?? {};
    this.maxConsecutiveFailedLaunches =
      options.maxConsecutiveFailedLaunches ?? 3;
    this.state = {
      embedded: options.embedded,
      lastKnownGood: options.embedded,
      candidate: null,
      active: options.embedded,
      failedLaunches: 0,
    };
  }

  offer(release: Release | null): boolean {
    if (
      !release ||
      release.manifest.sequence <= this.state.active.manifest.sequence ||
      release.manifest.runtimeVersion !==
        this.state.active.manifest.runtimeVersion
    )
      return false;
    const publicKey = this.publicKeys[release.manifest.keyId];
    if (
      !publicKey ||
      !verifyManifest(release.manifest, release.signature, publicKey)
    )
      return false;
    this.state.candidate = release;
    return true;
  }

  activate(): Release {
    assert(
      this.state.candidate,
      "SDK_NO_CANDIDATE",
      "No candidate release is pending",
    );
    this.state.active = this.state.candidate;
    this.state.failedLaunches = 0;
    return this.state.active;
  }

  reportLaunchSuccess(): Release {
    if (this.state.active !== this.state.embedded)
      this.state.lastKnownGood = this.state.active;
    this.state.failedLaunches = 0;
    return this.state.active;
  }

  reportLaunchFailure(): { rolledBack: boolean; active: Release } {
    this.state.failedLaunches += 1;
    if (
      this.state.failedLaunches >= this.maxConsecutiveFailedLaunches &&
      this.state.active !== this.state.lastKnownGood
    ) {
      this.state.active = this.state.lastKnownGood;
      this.state.candidate = null;
      this.state.failedLaunches = 0;
      return { rolledBack: true, active: this.state.active };
    }
    return { rolledBack: false, active: this.state.active };
  }

  snapshot(): {
    active: string | number;
    lastKnownGood: string | number;
    candidate: string | null;
    failedLaunches: number;
  } {
    return {
      active: this.state.active.id ?? this.state.active.manifest.sequence,
      lastKnownGood:
        this.state.lastKnownGood.id ??
        this.state.lastKnownGood.manifest.sequence,
      candidate: this.state.candidate?.id ?? null,
      failedLaunches: this.state.failedLaunches,
    };
  }
}

export function verifyAsset(
  data: string | Buffer,
  expectedHash: string,
): boolean {
  return sha256(data) === expectedHash;
}
