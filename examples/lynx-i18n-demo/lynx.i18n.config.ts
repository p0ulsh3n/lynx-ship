import { pluginQRCode } from "@lynx-js/qrcode-rsbuild-plugin";
import { pluginReactLynx } from "@lynx-js/react-rsbuild-plugin";
import { defineConfig } from "@lynx-js/rspeedy";
import { pluginI18nextExtractor } from "rsbuild-plugin-i18next-extractor";

export default defineConfig({
  plugins: [
    pluginQRCode({
      schema(url) {
        return `${url}?fullscreen=true`;
      },
    }),
    pluginReactLynx(),
    pluginI18nextExtractor({
      localesDir: "./src/locales",
      i18nextToolkitConfig: {
        extract: { ignore: ["**/node_modules/**"] },
      },
    }),
  ],
});
