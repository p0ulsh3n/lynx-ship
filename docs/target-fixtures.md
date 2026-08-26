# External Lynx target validation

This document records reproducible validation against public LynxJS projects.
The fixtures are not vendored into this repository: clone them into a temporary
directory, pin the commit under test, and keep their dependencies outside the
workspace.

## Community Web and Desktop fixture

- Repository: [KadenHD/lynxjs-crossplatform](https://github.com/KadenHD/lynxjs-crossplatform)
- Validation commit: `50736f3fb2fc99eb9332720ee14e7b0816f96a33`
- Project shape: Rspeedy Web plus Electron Builder Desktop packaging.
- Project scripts: `build:web` and `build:app`.

Run from the LynxShip repository after cloning the fixture:

```bash
lynxship init --project-dir <fixture>
lynxship doctor --project-dir <fixture> --platform web
lynxship build --project-dir <fixture> --platform web \
  --profile production --no-upload --non-interactive

lynxship doctor --project-dir <fixture> --platform desktop
lynxship build --project-dir <fixture> --platform desktop \
  --profile production --no-upload --non-interactive
```

The Web build produced a real `.web.bundle` from the project's `build/web`
output. The Desktop build produced a real Windows installer from
`build:app`. Both artifacts were kept local and were not uploaded to R2.

The fixture used an unsigned packaging-only configuration for the Desktop
test. That test must use the explicit local override:

```bash
lynxship build --project-dir <fixture> --platform desktop \
  --profile production --no-upload --allow-unsigned --non-interactive
```

It validates packaging only. A normal production build must use a real Windows
Authenticode certificate and must pass LynxShip's final signature check.

## Official Lynx Web fixture

- Repository: [lynx-family/lynx-examples](https://github.com/lynx-family/lynx-examples)
- Validation commit: `39c8c2750d88a02f45c9fc5f9201b243f13791b8`
- Project: `examples/web-platform/packages/lynx-project`

The project passed `doctor --platform web` and a real Web build with
`--no-upload`. Its official `examples/desktop` package was also checked. That
package is a Desktop-oriented Lynx UI example, not a Lynxtron or Electron
Builder host, so LynxShip correctly reports the missing host and packager
instead of inventing an installer.

## Reproducibility rules

- Do not commit cloned external fixtures, `node_modules`, build directories,
  installer files, hashes from one workstation, or R2 URLs.
- Do not disable signing for a production or uploaded build.
- Record a new validation commit when a fixture or its toolchain changes.

## Framework fixtures

### Octane Lynx

- Official docs: https://octanejs.dev/docs/lynx
- Official source: https://github.com/octanejs/octane
- Fixture notes: examples/lynx-octane-fixture/README.md

The official page currently says that @octanejs/lynx and
@octanejs/rspeedy-plugin are not published and that native support is early
access. Validation must therefore run from a pinned Octane checkout:

```bash
git clone https://github.com/octanejs/octane.git
cd octane
# The official documentation uses `pnpm install`. A focused install is enough
# for this development smoke test and avoids installing unrelated workspaces.
pnpm install --filter @octanejs/rspeedy-plugin... --frozen-lockfile
pnpm --filter @octanejs/rspeedy-plugin exec rspeedy dev \
  --root examples/gallery --environment lynx
```

This proves the real Octane/Rspeedy/Lynx development path. It is not a claim
of signed Android or iOS production support.

### Miso Native

- Historical repository: https://github.com/haskell-miso/miso-lynx
- Current native API: https://haddocks.haskell-miso.org/miso/Miso-Native.html
- Fixture notes: examples/miso-lynx-fixture/README.md

The project is Haskell/Nix and its current official gallery is built with
nix build (the flake exposes both default and bundle outputs). LynxShip
detects this shape, requires Nix, and uses the default/bundle output or the
configured build.<profile>.miso.attribute and build.<profile>.miso.artifact
values. Miso's native backend remains
experimental, and the dual-thread restrictions must be validated separately
from the bundle build.

### Miso MicroHs (experimental)

LynxShip exposes MicroHs only through an explicit adapter contract. A project
must provide a pinned local binary or HTTPS manifest and an adapter command
under `build.<profile>.miso.microhs.adapter`. The adapter receives
`LYNXSHIP_MICROHS_BINARY`, `LYNXSHIP_MICROHS_VERSION` and
`LYNXSHIP_MISO_OUTPUT`, and must produce the output bundle itself. The
repository contains contract tests for acquisition, cache reuse, digest and
signature verification; these do not claim that MicroHs currently compiles
the full upstream Miso package. Keep the official GHCJS/Nix path as the
fallback until that compatibility work is validated upstream.
