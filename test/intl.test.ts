import assert from "node:assert/strict";
import test from "node:test";
import {
  detectIntlCapabilities,
  intlPolyfillPlan,
  missingIntlCapabilities,
  planIntlPolyfills,
} from "@lynxship/i18n";

test("detects only callable Intl capabilities without mutating the runtime", () => {
  const runtime = {
    PluralRules: class PluralRules {},
    NumberFormat: undefined,
    getCanonicalLocales: () => [],
  };
  const before = { ...runtime };
  const state = detectIntlCapabilities(runtime);

  assert.equal(state.PluralRules, true);
  assert.equal(state.NumberFormat, false);
  assert.equal(state.getCanonicalLocales, true);
  assert.deepEqual(runtime, before);
});

test("plans only the requested official FormatJS polyfills", () => {
  const plans = planIntlPolyfills(
    ["PluralRules", "NumberFormat", "DateTimeFormat"],
    {},
  );

  assert.deepEqual(
    plans.map(({ packageName, setupEntryPoint }) => [
      packageName,
      setupEntryPoint,
    ]),
    [
      [
        "@formatjs/intl-pluralrules",
        "@formatjs/intl-pluralrules/polyfill-force.js",
      ],
      [
        "@formatjs/intl-numberformat",
        "@formatjs/intl-numberformat/polyfill-force.js",
      ],
      [
        "@formatjs/intl-datetimeformat",
        "@formatjs/intl-datetimeformat/polyfill-force.js",
      ],
    ],
  );
  assert.deepEqual(missingIntlCapabilities(["PluralRules"], {}), [
    "PluralRules",
  ]);
  assert.equal(intlPolyfillPlan("Locale").packageName, "@formatjs/intl-locale");
});
