import { hashJson } from "@lynxship/contracts";

export interface CacheKeyInput {
  sourceHash: string;
  runtimeFingerprint: string;
  profile: string;
  toolchain: string;
}

export interface CacheEntry {
  key: string;
  artifact: Record<string, unknown>;
  provenance: Record<string, unknown>;
  createdAt: string;
}

export class BuildCache {
  readonly entries = new Map<string, CacheEntry>();

  key(input: CacheKeyInput): string {
    return hashJson(input);
  }

  get(key: string): CacheEntry | null {
    return this.entries.get(key) ?? null;
  }

  put(
    key: string,
    artifact: Record<string, unknown>,
    provenance: Record<string, unknown>,
  ): CacheEntry {
    const entry = Object.freeze({
      key,
      artifact,
      provenance,
      createdAt: new Date().toISOString(),
    });
    this.entries.set(key, entry);
    return entry;
  }

  list(): CacheEntry[] {
    return [...this.entries.values()];
  }
}
