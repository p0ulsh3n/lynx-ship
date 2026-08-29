import "@lynx-js/preact-devtools";
import "@lynx-js/react/debug";
import { root } from "@lynx-js/react";
import { LynxI18nextProvider } from "@lynxship/i18n/react-lynx";
import { App } from "./App.js";
import { i18n } from "./i18n.js";

root.render(
  <LynxI18nextProvider adapter={i18n}>
    <App />
  </LynxI18nextProvider>,
);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
