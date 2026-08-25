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
