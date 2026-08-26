import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  acquireMicroHs,
  microHsHostTriple,
  validateMicroHsManifest,
} from "@lynxship/microhs";
import { buildLynxBundle } from "../packages/cli/src/bundle-build.js";

function sha256(value: Uint8Array): string {
  return createHash("sha256")
    .update(value as unknown as Uint8Array<ArrayBuffer>)
    .digest("hex");
}

function manifestFor(
  host: ReturnType<typeof microHsHostTriple>,
  bytes: Uint8Array,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    version: "0.16.6.0",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    artifacts: {
      [host]: {
        url: "https://downloads.example.invalid/microhs.tar.gz",
        sha256: sha256(bytes),
      },
    },
  };
}

test("MicroHs validates host triples and rejects unsupported manifests", () => {
  assert.equal(microHsHostTriple("darwin", "arm64"), "darwin-arm64");
  assert.equal(microHsHostTriple("linux", "x64"), "linux-x64");
  assert.throws(
    () => validateMicroHsManifest({ schemaVersion: 1 }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "MICROHS_MANIFEST_INVALID",
  );
  assert.throws(
    () =>
      validateMicroHsManifest({
        ...manifestFor("linux-x64", new Uint8Array([1])),
        artifacts: {
          "linux-x64": {
            url: "http://insecure.example.invalid/mhs",
            sha256: "0".repeat(64),
          },
        },
      }),
    /HTTPS URL/,
  );
});

test("MicroHs downloads once, verifies SHA-256, then reuses the cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-microhs-cache-"));
  const bytes = new TextEncoder().encode("verified-microhs-binary");
  const host = microHsHostTriple(process.platform, process.arch);
  const manifest = manifestFor(host, bytes);
  let requests = 0;
  const fetchImpl: typeof fetch = async (input) => {
    requests += 1;
    if (String(input) === "https://manifest.example.invalid/microhs.json") {
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    assert.equal(
      String(input),
      "https://downloads.example.invalid/microhs.tar.gz",
    );
    return new Response(bytes, { status: 200 });
  };
  const options = {
    manifestUrl: "https://manifest.example.invalid/microhs.json",
    cacheDir: root,
    fetchImpl,
  };
  const first = await acquireMicroHs(options);
  const second = await acquireMicroHs(options);
  assert.equal(first.source, "download");
  assert.equal(second.source, "cache");
  assert.equal(first.binaryPath, second.binaryPath);
  // The manifest is intentionally re-read on each invocation so a changed
  // pinned version is not hidden by a stale binary cache.
  assert.equal(requests, 3);
});

test("MicroHs verifies a signed artifact before caching it", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-microhs-signature-"));
  const bytes = new TextEncoder().encode("signed-microhs-binary");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signature = sign(
    null,
    Buffer.from(bytes) as unknown as Uint8Array<ArrayBuffer>,
    privateKey,
  ).toString("base64");
  const host = microHsHostTriple(process.platform, process.arch);
  const manifest = manifestFor(host, bytes);
  const artifact = (
    manifest.artifacts as Record<string, Record<string, unknown>>
  )[host];
  assert.ok(artifact);
  artifact.signatureBase64 = signature;
  const result = await acquireMicroHs({
    manifestUrl: "https://manifest.example.invalid/microhs.json",
    cacheDir: root,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    fetchImpl: async (input) =>
      String(input) === "https://manifest.example.invalid/microhs.json"
        ? new Response(JSON.stringify(manifest), { status: 200 })
        : new Response(bytes, { status: 200 }),
  });
  assert.equal(result.source, "download");
});

test("MicroHs adapter contract is exercised without claiming a compiler build", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-microhs-adapter-"));
  await writeFile(join(root, "flake.nix"), "# MicroHs adapter fixture\n");
  await writeFile(join(root, "cabal.project"), "packages: miso\n");
  await writeFile(join(root, "toolchain"), "fixture executable");
  if (process.platform !== "win32") await chmod(join(root, "toolchain"), 0o755);
  const script = [
    "import { mkdir, writeFile } from 'node:fs/promises';",
    "await mkdir('result', { recursive: true });",
    "await writeFile(process.env.LYNXSHIP_MISO_OUTPUT, 'contract bundle');",
  ].join(" ");
  const output: string[] = [];
  await buildLynxBundle(root, {
    miso: {
      compiler: "microhs",
      artifact: "result/main.lynx.bundle",
      microhs: {
        binary: "toolchain",
        adapter: {
          command: process.execPath,
          args: ["--input-type=module", "-e", script],
        },
      },
    },
    onOutput: (line) => output.push(line),
  });
  assert.match(output.join("\n"), /Miso bundle ready/);
});

test("MicroHs adapter failures keep a build-specific error code", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-microhs-adapter-fail-"));
  await writeFile(join(root, "flake.nix"), "# MicroHs adapter fixture\n");
  await writeFile(join(root, "cabal.project"), "packages: miso\n");
  await writeFile(join(root, "toolchain"), "fixture executable");
  await assert.rejects(
    buildLynxBundle(root, {
      miso: {
        compiler: "microhs",
        microhs: {
          binary: "toolchain",
          adapter: {
            command: process.execPath,
            args: ["--input-type=module", "-e", "process.exit(17)"],
          },
        },
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "BUILD_MISO_MICROHS_ADAPTER_FAILED",
  );
});
