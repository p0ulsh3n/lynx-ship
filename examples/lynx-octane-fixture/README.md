# Octane + Lynx fixture

This fixture documents the current official Octane Lynx integration without
vendoring Octane's source or unpublished packages.

Octane's official Lynx integration currently uses:

- \`@octanejs/lynx\`;
- \`@octanejs/rspeedy-plugin\`;
- \`environments.lynx\` in \`lynx.config.\*\`;
- the \`.tsrx\` compiler and Lynx's main/background thread graphs.

As of the source review on 2026-08-25, the Octane documentation says these
Lynx packages are not published yet and marks native support as early access.
Run the official repository example instead:

```bash
git clone https://github.com/octanejs/octane.git
cd octane
# The official documentation uses `pnpm install`. This focused install keeps
# the validation limited to the plugin and its workspace dependencies.
pnpm install --filter @octanejs/rspeedy-plugin... --frozen-lockfile
pnpm --filter @octanejs/rspeedy-plugin exec rspeedy dev \
  --root examples/gallery --environment lynx
```

Then, from the example project, LynxShip can run:

```bash
lynxship init
lynxship doctor --platform android
lynxship dev
```

This fixture is intentionally not presented as a production-ready template.
Native Octane support must remain labelled early access until the upstream
project broadens iOS and Android device coverage.
