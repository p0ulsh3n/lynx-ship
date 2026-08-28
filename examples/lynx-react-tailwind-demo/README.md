# ReactLynx + Tailwind demo

This is a real ReactLynx messaging and calls fixture for validating the LynxShip
and Expo paths with the official Lynx Tailwind preset. It exercises:

- ReactLynx JSX and stateful `bindtap` interactions;
- conditional rendering for Messages and Calls, plus mapped conversation and call lists;
- a local image asset imported into the bundle;
- Tailwind CSS v3 utilities through `@lynx-js/tailwind-preset`;
- Lynx-specific CSS for the gradient, safe areas, responsive sizing, and scrolling;
- accessible labels on the interactive controls.

The preset is an official Lynx package, but it is currently experimental. Keep
the preset and Tailwind major version aligned with the official Lynx guidance.

```bash
pnpm --filter @lynxship/lynx-react-tailwind-demo dev
pnpm --filter @lynxship/lynx-react-tailwind-demo build
```

The production bundle is written to `dist/main.lynx.bundle`. The entire `dist`
directory should be copied when embedding this fixture in an Expo project so
that future static assets are preserved as well as the main bundle.
