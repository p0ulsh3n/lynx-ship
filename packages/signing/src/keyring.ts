import { assert, type OtaManifest } from "@lynxship/contracts";
import { createSigningKey, verifyManifest, type SigningKey } from "./core.js";
interface StoredKey extends SigningKey {
  revokedAt: { reason: string; at: string } | null;
}

export class Keyring {
  readonly keys = new Map<string, StoredKey>();

  constructor(keys: SigningKey[] = []) {
    for (const key of keys)
      this.keys.set(key.keyId, { ...key, revokedAt: null });
  }

  add(key: SigningKey = createSigningKey()): {
    keyId: string;
    publicKey: string;
  } {
    this.keys.set(key.keyId, { ...key, revokedAt: null });
    return { keyId: key.keyId, publicKey: key.publicKey };
  }

  revoke(
    keyId: string,
    reason = "",
  ): { keyId: string; reason: string; at: string } {
    const key = this.keys.get(keyId);
    assert(key, "KEY_NOT_FOUND", "Signing key not found");
    const revokedAt = { reason, at: new Date().toISOString() };
    key.revokedAt = revokedAt;
    return { keyId, ...revokedAt };
  }

  verify(manifest: OtaManifest, signature: string): boolean {
    const key = this.keys.get(manifest.keyId);
    return Boolean(
      key &&
      !key.revokedAt &&
      verifyManifest(manifest, signature, key.publicKey),
    );
  }

  list(): Array<Omit<StoredKey, "privateKey">> {
    return [...this.keys.values()].map(
      ({ privateKey: _privateKey, ...key }) => key,
    );
  }
}
