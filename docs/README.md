# LynxShip documentation

This directory is the documentation index for the LynxShip workspace. The
repository is explicit about what is implemented and what still needs an
external platform, credential or production-operations gate.

## Start here

- [Root README](../README.md): installation, common workflows and publishing.
- [Package catalog](package-catalog.md): every workspace package and its
  public/private boundary.
- [Feature status](status.md): current evidence and remaining gates.
- [Acceptance matrix](acceptance-matrix.md): what is verified in this repo and
  what still requires Android, Apple, store, cloud or production testing.

## CLI and application integrations

- [CLI design system](cli.md)
- [Expo and LynxShip integration](expo-integration.md)
- [Plugin ecosystem](plugin-ecosystem.md)
- [External target fixtures](target-fixtures.md)
- [Compatibility baseline](compatibility.md)

## Platform and operations

- [Architecture](architecture.md)
- [Provider strategy](providers.md)
- [Operations runbook](operations.md)
- [Threat model](threat-model.md)

Package READMEs document public APIs and package-specific setup. Generated
output, credentials, local caches and native build directories are deliberately
not documentation sources and are ignored by Git.
