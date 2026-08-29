# @lynxship/asset-pipeline

Deterministic asset discovery and hash-verified synchronization for LynxShip
builds. It handles imported images, fonts, audio, video, CSS, bundles and
data files without copying credentials or build state by default.

The package follows Rspeedy's distinction between bundled assets, `public`
files and configured asset prefixes. It only provides the filesystem planning
and verification layer; the CLI decides which target directory belongs to
Android, iOS, HarmonyOS, Web or Desktop.

Before synchronization, manifests are validated as untrusted input: version,
relative paths, duplicate paths, sizes, SHA-256 values, asset kinds and MIME
types are checked. `createAssetSyncPlan` preserves the historical path and
source-hash error codes, while `validateAssetManifest` can additionally verify
that the manifest digest matches its records.

Reference: <https://lynxjs.org/rspeedy/assets>

## Usage and safety

```ts
import {
  createAssetManifest,
  createAssetSyncPlan,
} from "@lynxship/asset-pipeline";

const manifest = await createAssetManifest("dist");
const plan = createAssetSyncPlan(manifest, "android/app/src/main/assets");
```

Paths are normalized and contained within the declared source and destination
roots. A manifest should be treated as untrusted input and validated before it
is applied. The package does not upload files, modify native projects, or
contact a cloud provider by itself.
