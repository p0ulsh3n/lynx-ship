# Miso + Lynx fixture

Miso's Lynx backend is a Haskell/Nix project, not an npm/Rspeedy application.
The current upstream project is \`miso\`, while \`miso-lynx\` remains the
historical repository and points contributors to the upstream documentation.

Use the current official gallery as a real fixture:

```bash
git clone https://github.com/haskell-miso/miso-lynx-gallery.git
cd miso-lynx-gallery
nix build
```

The flake's default output produces `result/main.lynx.bundle`, so LynxShip
can discover it without extra configuration. For a project whose flake uses
another output, set the output explicitly in
\`lynxship.json\`:

```json
{
  "build": {
    "production": {
      "miso": {
        "attribute": "bundle",
        "artifact": "result/main.lynx.bundle"
      }
    }
  }
}
```

Then LynxShip can copy the verified bundle into \`dist/\` before the native
Android, iOS or HarmonyOS host pipeline:

```bash
lynxship doctor --platform android
lynxship build --platform android --profile production --no-upload
```

Miso's native backend is experimental. The same Haskell bundle targets the
Lynx dual-thread runtime, so native modules and main-thread operations must
follow the Miso.Native thread restrictions.

## Optional MicroHs adapter contract

MicroHs is not selected automatically. The official MicroHs repository does
not currently provide a verified release artifact set, and current Miso still
uses GHC/GHCJS-oriented packages and FFI. Do not put an invented download URL
in a project. If a team maintains a compatible MicroHs build, configure a
local binary or its own pinned HTTPS manifest, then provide a real adapter:

```json
{
  "build": {
    "development": {
      "miso": {
        "compiler": "microhs",
        "microhs": {
          "binary": "toolchains/mhs",
          "adapter": {
            "command": "node",
            "args": ["tools/miso-microhs-adapter.mjs"]
          }
        }
      }
    }
  }
}
```

The adapter must write `result/main.lynx.bundle` or set
`miso.artifact`. LynxShip verifies and copies that bundle, but it does not
pretend that this contract alone proves Miso language, FFI, BTS/MTS or native
Android/iOS compatibility. The fallback remains the official `nix build`
workflow above.

The current upstream gallery was also used as a negative compatibility test on
2026-08-26: MicroHs `0.16.6.0` compiled successfully on Windows, then rejected
the gallery's `$(makeLenses ''Drag)` Template Haskell expression. Until that
language and package boundary is ported, select the default GHC/Nix workflow;
do not publish a MicroHs manifest or claim a native Miso build from this
contract alone.
