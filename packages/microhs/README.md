# @lynxship/microhs

This package provides the verified MicroHs toolchain acquisition layer for a
LynxShip Miso adapter. It is intentionally not a replacement for Miso, GHC,
Rspeedy or the Lynx native host.

The package accepts an explicit binary or a pinned JSON release manifest. A
download is accepted only after its SHA-256 matches the manifest; signed
artifacts also require a configured pinned public key. Downloads are stored in
the platform cache and never inside the project.

MicroHs support is opt-in. A project must provide a real adapter command that
understands the current Miso/Miso.Native contract and writes the configured
`main.lynx.bundle`. LynxShip does not claim that the upstream `mhs` executable
is a drop-in GHCJS replacement.

Supported verified host triples are `darwin-arm64`, `darwin-x64`,
`linux-arm64`, `linux-x64` and `win32-x64`. The host triple identifies the
machine running the compiler; it does not remove the Xcode, Android or
HarmonyOS requirements for native packaging.
