# Examples

Examples contain small LynxJS projects and integration fixtures used by build
and OTA acceptance tests. No example is currently claimed as a production-ready
reference application.

Framework fixtures:

- \`lynx-basic-template\`: installable ReactLynx/Rspeedy smoke-test template.
- \`lynx-android-demo\`: real Android Lynx host used by local and CI build
  verification paths.
- \`lynx-react-tailwind-demo\`: ReactLynx + official Lynx Tailwind preset fixture
  with assets, state, lists, conditional rendering and interactions. Its
  \`lynxship.json\` uses only the LynxShip config contract; Expo options belong
  to an Expo project's app config.
- \`lynx-octane-fixture\`: official Octane Lynx integration instructions and
  early-access validation boundary.
- \`miso-lynx-fixture\`: official Miso/Nix bundle instructions and configuration
  contract, plus the opt-in MicroHs adapter boundary.
- \`expo-lynx-ota\`: minimal Expo + \`@lynxship/expo\` brownfield/OTA fixture;
  native builds must be generated and tested with the current Expo toolchain.
