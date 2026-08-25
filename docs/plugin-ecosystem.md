# LynxShip plugin ecosystem

LynxShip plugins are project-owned npm packages that extend the build
configuration without replacing Lynx's official integration points. The
contract is intentionally close to the useful part of Expo config plugins:
packages are installed with the project's package manager, listed in project
configuration, applied in declaration order and made idempotent before a
native build.

This is a public API, not a remote marketplace. A project must pin the plugin
version in its lockfile and explicitly list the plugin in lynxship.json.

## Install and enable a plugin

Install the package with the package manager already used by the project:

```bash
npm install --save-dev @example/lynx-camera-plugin
```

Then add it to lynxship.json:

```json
{
  "plugins": [
    "@example/lynx-camera-plugin",
    ["@example/lynx-theme-plugin", { "brandColor": "#ff2bd6" }]
  ]
}
```

The package must expose this metadata in its package.json:

```json
{
  "lynxship": {
    "apiVersion": 1,
    "plugin": "./dist/lynxship-plugin.js",
    "capabilities": ["config", "native", "autolink", "template", "cloud"],
    "permissions": [
      "config:write",
      "native:write",
      "autolink:metadata",
      "template:register",
      "cloud:provider"
    ]
  }
}
```

The plugin entry exports a definition created with
defineLynxShipPlugin from @lynxship/plugin-api:

```ts
import { defineLynxShipPlugin } from "@lynxship/plugin-api";

export default defineLynxShipPlugin({
  apiVersion: 1,
  name: "@example/lynx-camera-plugin",
  capabilities: ["native", "autolink"],
  permissions: ["native:write", "autolink:metadata"],
  platforms: ["android", "ios"],
  apply(context) {
    return {
      native: [
        {
          platform: "android",
          file: "android/app/build.gradle",
          operation: "ensure-text",
          text: 'apply plugin: "com.example.camera"',
        },
        {
          platform: "ios",
          file: "ios/Podfile",
          operation: "ensure-text",
          text: 'pod "ExampleCamera"',
        },
      ],
    };
  },
});
```

The supported native operations are ensure-text, append-text, replace-text
and json-merge. Paths must remain inside the project. The operations are
applied in the order returned by the plugin and ensure-text is safe to run
repeatedly.

## Commands and build lifecycle

```bash
lynxship plugin list
lynxship plugin doctor
lynxship plugin apply --platform android --profile production --dry-run
lynxship plugin apply --platform android --profile production
```

plugin doctor reads package metadata only and does not execute a plugin or
modify native files. `plugin apply --dry-run` executes the plugin in plan mode,
validates permissions and conflicts, and reports the exact native operations
without writing them. A normal plugin apply executes the plugin and applies
native operations atomically: if a later operation fails, files changed by
that invocation are restored. lynxship build automatically applies enabled
plugins after a missing host is initialized and before Autolink checks,
runtime fingerprinting and the native build.

Plugin order is deterministic. A later plugin can extend a previous
configuration contribution, but a native replacement fails if its expected
source text is absent. This makes incompatible plugin combinations visible
instead of silently producing a different host project.

## Extension boundaries

The API exposes six capability labels:

- config: merge JSON-compatible LynxShip configuration.
- build: declare build-tool, artifact and compatibility requirements for the
  selected adapter.
- native: apply bounded, declarative native-file operations.
- autolink: describe native capabilities; actual library discovery and
  codegen remain Lynx's official lynx.lib.json and lynx-autolink-codegen
  workflow.
- template: publish metadata for a project/template integration.
- cloud: publish metadata for build, artifact, update or submit adapters.

template and cloud contributions are validated and reported now; they do not
silently execute arbitrary downloaded code, replace the R2 contract, or grant
access to credentials. They are metadata contracts until a separately
reviewed template registry or cloud provider adapter consumes them.

Plugins do not receive secrets, a network client or an arbitrary shell runner
through the public context. Native host commands such as Gradle, CocoaPods,
Hvigor and Lynxtron continue to run through LynxShip's audited platform
adapters. This is an API boundary, not a JavaScript sandbox: an npm package
is executable code and must be trusted, reviewed, pinned in the lockfile and
tested in CI. The declared permissions make intended effects auditable; they
cannot protect a project from a malicious dependency that ignores the API.

## Relationship with Lynx

For a Lynx native library, use the official package shape and lynx.lib.json.
Lynx currently documents Android and iOS Autolink tooling, with Lynxtron
package metadata/loading covered separately; Web and some platform
integrations still have different support boundaries. LynxShip checks those
manifests and host plugins but does not invent a second native registry.

Recommended package workflow:

```bash
npm create lynx-library
npm run codegen
npm pack
```

Install the resulting package into an example host, run lynxship autolink
check, then run the platform build. Keep the plugin package and the native
library package separate when the feature is reusable: the former configures
the host, while the latter owns the official Lynx native implementation.

## Compatibility and release rules

Plugin API version 1 is the current stable contract for this repository.
Plugin packages should:

1. pin or peer-depend on the Lynx SDK range they support;
2. declare the LynxShip plugin API version in package.json;
3. keep native edits deterministic and reversible;
4. test Android, iOS and any additional target separately;
5. run lynxship plugin doctor, lynxship autolink check and a clean native
   build in CI;
6. publish a changelog when a native operation or required host version
   changes.

This contract makes community extensions possible today. It does not claim
that LynxShip already provides Expo's hosted build fleet, credential service,
store operations, update service, template registry or ecosystem size. Those
are separate products and require independently operated infrastructure and
provider agreements.
