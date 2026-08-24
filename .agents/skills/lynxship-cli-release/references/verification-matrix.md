# CLI release verification matrix

## Local repository checks

```text
pnpm install --frozen-lockfile
pnpm check
pnpm verify
pnpm --filter @lynxship/cli pack --dry-run
```

Check the tarball contents before npm publishing. It must contain the CLI
`dist/`, README and all generated host templates, and must not contain local
credentials, build outputs, `.lynxship` state or unrelated workspace files.

## Platform checks

| Target                         | Required real toolchain                              | Required proof                                       |
| ------------------------------ | ---------------------------------------------------- | ---------------------------------------------------- |
| Android on Windows/Linux/macOS | Node, package manager, JDK, Android SDK, Gradle host | signed APK/AAB, `apksigner` verification             |
| iOS on macOS                   | Xcode, `xcodebuild`, `xcrun`, CocoaPods, Xcode host  | archive, exported IPA, `codesign` verification       |
| Lynx Explorer development      | Rspeedy dev server and Explorer                      | QR loads and source reloads                          |
| OTA                            | compatible native binary and storage/provider        | signed manifest, hash, runtime fingerprint, rollback |
| Store submission               | verified artifact plus provider credentials          | provider API/Transporter response and audit record   |

An Ubuntu job can prove Android. A macOS GitHub Actions job can prove iOS
toolchain and simulator compilation. Neither proves a production Apple
submission unless real Apple credentials and the store provider are used.

## CI behavior

Use pinned Node and pnpm versions, frozen lockfiles, least-privilege job
permissions and retry only network installation failures. Do not retry a
deterministic compiler, signing, test or validation failure as if it were a
network problem.

Use GitHub's official Actions documentation for workflow changes:

- [GitHub Actions](https://docs.github.com/en/actions)
- [Workflow syntax](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)
- [Security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)

## Handoff labels

Every report must label the strongest verified claim:

```text
contract-only
bundle-built
native-compiled-unsigned
locally-signed-and-verified
uploaded-to-r2
submitted-to-store
```

Never collapse these labels into a generic “build succeeded”.
