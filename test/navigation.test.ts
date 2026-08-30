import assert from "node:assert/strict";
import test from "node:test";
import {
  NavigationError,
  buildLynxScheme,
  createLynxNavigationAdapter,
  createNavigationController,
  normalizeNavigationChrome,
  normalizeNavigationTarget,
  parseLynxScheme,
} from "@lynxship/navigation";

test("navigation normalizes safe targets and parameters", () => {
  assert.deepEqual(
    normalizeNavigationTarget(
      { url: "lynxship://chat/42", params: { unread: 2, focused: true } },
      {},
    ),
    { url: "lynxship://chat/42?unread=2&focused=true" },
  );
  assert.equal(
    normalizeNavigationTarget({ url: "hybrid://settings" }).url,
    "hybrid://settings",
  );
  assert.throws(
    () =>
      normalizeNavigationTarget({
        url: "lynx://home",
        params: { ratio: Number.NaN },
      }),
    { code: "NAVIGATION_INVALID_TARGET" },
  );
  assert.throws(
    () => normalizeNavigationTarget({ url: "http://evil.test" }),
    (error: unknown) =>
      error instanceof NavigationError &&
      error.code === "NAVIGATION_INVALID_TARGET",
  );
  assert.throws(
    () =>
      normalizeNavigationTarget(
        { url: "https://evil.test" },
        { httpsHosts: ["app.example.com"] },
      ),
    { code: "NAVIGATION_INVALID_TARGET" },
  );
});

test("navigation builds and parses safe multi-page Lynx schemes", () => {
  const url = buildLynxScheme({
    path: "pages/chat.lynx.bundle",
    presentation: {
      title: "Chat",
      hideNavBar: true,
      containerBackgroundColor: "#071522",
      hideLoading: true,
      loadingBackgroundColor: "#0B1D2E",
      hideError: true,
      forceThemeStyle: "dark",
      fitSize: true,
    },
    params: { title: "Chat & Calls", hide_nav_bar: 1 },
  });
  assert.equal(
    url,
    "hybrid://lynxview_page?bundle=pages%2Fchat.lynx.bundle&title=Chat+%26+Calls&hide_nav_bar=1&container_bg_color=%23071522&hide_loading=1&loading_bg_color=%230B1D2E&hide_error=1&force_theme_style=dark&FitSize=1",
  );
  assert.deepEqual(parseLynxScheme(url), {
    url,
    bundle: "pages/chat.lynx.bundle",
    params: {
      title: "Chat & Calls",
      hide_nav_bar: "1",
      container_bg_color: "#071522",
      hide_loading: "1",
      loading_bg_color: "#0B1D2E",
      hide_error: "1",
      force_theme_style: "dark",
      FitSize: "1",
    },
  });
  assert.throws(
    () => buildLynxScheme({ path: "https://cdn.example/app.bundle" }),
    { code: "NAVIGATION_INVALID_TARGET" },
  );
  assert.throws(
    () => parseLynxScheme("hybrid://lynxview_page?title=MissingBundle"),
    { code: "NAVIGATION_INVALID_TARGET" },
  );
  assert.throws(
    () =>
      buildLynxScheme({
        path: "main.lynx.bundle",
        presentation: { navBarColor: "red" },
      }),
    { code: "NAVIGATION_INVALID_TARGET" },
  );
});

test("navigation serializes complete native presentation controls", () => {
  const url = buildLynxScheme({
    path: "main.lynx.bundle",
    presentation: {
      titleColorLight: "#111111",
      titleColorDark: "#eeeeee",
      navBarColorLight: "#ffffff",
      navBarColorDark: "#101010",
      containerBackgroundColorLight: "#f7f7f7",
      containerBackgroundColorDark: "#070707",
      loadingBackgroundColorLight: "#fafafa",
      loadingBackgroundColorDark: "#050505",
      showNavBarInTransparentStatusBar: true,
      screenOrientation: "landscape-left",
      statusFontMode: "light",
      hideBackButton: true,
      disableAutoRemoveLoading: true,
    },
  });
  const query = new URL(url).searchParams;
  assert.equal(query.get("title_color_light"), "#111111");
  assert.equal(query.get("title_color_dark"), "#eeeeee");
  assert.equal(query.get("nav_bar_color_light"), "#ffffff");
  assert.equal(query.get("nav_bar_color_dark"), "#101010");
  assert.equal(query.get("container_bg_color_light"), "#f7f7f7");
  assert.equal(query.get("container_bg_color_dark"), "#070707");
  assert.equal(query.get("loading_bg_color_light"), "#fafafa");
  assert.equal(query.get("loading_bg_color_dark"), "#050505");
  assert.equal(query.get("show_nav_bar_in_trans_status_bar"), "1");
  assert.equal(query.get("screen_orientation"), "landscape-left");
  assert.equal(query.get("status_font_mode"), "light");
  assert.equal(query.get("hide_back_button"), "1");
  assert.equal(query.get("disable_auto_remove_loading"), "1");
});

test("native Lynx navigation adapter translates callbacks without global state", async () => {
  const calls: string[] = [];
  const adapter = createLynxNavigationAdapter("android", {
    open(url, callback) {
      calls.push(`open:${url}`);
      callback({ code: 1 });
    },
    replace(url, callback) {
      calls.push(`replace:${url}`);
      callback({ success: true });
    },
    back(callback) {
      calls.push("back");
      callback({ changed: true });
    },
  });
  await adapter.open({ url: "lynxship://home" });
  await adapter.replace({ url: "lynxship://chat/42" });
  assert.equal(await adapter.back(), true);
  assert.deepEqual(calls, [
    "open:lynxship://home",
    "replace:lynxship://chat/42",
    "back",
  ]);
});

test("native navigation back handling is opt-in and keeps the default path", async () => {
  const calls: boolean[] = [];
  const adapter = createLynxNavigationAdapter("android", {
    open(_url, callback) {
      callback(true);
    },
    replace(_url, callback) {
      callback(true);
    },
    back(callback) {
      callback(false);
    },
    setBackPressHandling(enabled, callback) {
      calls.push(enabled);
      callback({ code: 1 });
    },
  });
  const controller = createNavigationController({
    platform: "android",
    adapter,
  });
  await controller.setBackPressHandling(true);
  await controller.setBackPressHandling(false);
  assert.deepEqual(calls, [true, false]);
});

test("native navigation exposes create and system-browser operations without mutating the stack", async () => {
  const calls: string[] = [];
  const adapter = createLynxNavigationAdapter("ios", {
    create(url, callback) {
      calls.push(`create:${url}`);
      callback({ success: true });
    },
    open(url, callback) {
      calls.push(`open:${url}`);
      callback(true);
    },
    replace(url, callback) {
      calls.push(`replace:${url}`);
      callback(true);
    },
    openInSystemBrowser(url, callback) {
      calls.push(`browser:${url}`);
      callback({ code: 1 });
    },
    back(callback) {
      callback(false);
    },
  });
  const controller = createNavigationController({
    platform: "ios",
    adapter,
  });

  await controller.create!({ url: "hybrid://prepared" });
  await controller.openInSystemBrowser!({ url: "https://lynx.dev/docs" });
  assert.deepEqual(controller.stack, []);
  assert.deepEqual(calls, [
    "create:hybrid://prepared",
    "browser:https://lynx.dev/docs",
  ]);
});

test("navigation reports missing optional native capabilities instead of pretending", async () => {
  const controller = createNavigationController({
    platform: "android",
    adapter: {
      platform: "android",
      async open() {},
      async replace() {},
      async back() {
        return false;
      },
    },
  });
  await assert.rejects(
    () => controller.create!({ url: "lynxship://prepared" }),
    { code: "NAVIGATION_CAPABILITY_MISSING" },
  );
  await assert.rejects(
    () => controller.openInSystemBrowser!({ url: "https://lynx.dev" }),
    { code: "NAVIGATION_CAPABILITY_MISSING" },
  );
  await assert.rejects(
    () =>
      controller.updateChrome({
        title: "Home",
        leadingAction: {
          id: "back",
          role: "back",
          accessibilityLabel: "Go back",
        },
      }),
    { code: "NAVIGATION_CAPABILITY_MISSING" },
  );
});

test("navigation chrome is portable, accessible and validated before native dispatch", async () => {
  const calls: string[] = [];
  const adapter = createLynxNavigationAdapter("android", {
    open(url, callback) {
      calls.push(`open:${url}`);
      callback(true);
    },
    replace(_url, callback) {
      callback(true);
    },
    back(callback) {
      callback(false);
    },
    updateChrome(json, callback) {
      calls.push(json);
      callback({ code: 1 });
    },
  });
  const controller = createNavigationController({
    platform: "android",
    adapter,
  });
  const chrome = normalizeNavigationChrome({
    title: "Inbox",
    backgroundColor: "#071522",
    leadingAction: {
      id: "back",
      role: "back",
      accessibilityLabel: "Go back",
      icon: "arrow-left",
    },
    trailingActions: [
      {
        id: "compose",
        role: "action",
        accessibilityLabel: "Compose message",
        label: "New",
      },
    ],
  });
  await controller.updateChrome(chrome);
  const serializedChrome = calls[0];
  assert.ok(serializedChrome);
  assert.deepEqual(JSON.parse(serializedChrome), chrome);
  assert.throws(
    () =>
      normalizeNavigationChrome({
        trailingActions: [
          { id: "x", role: "action", accessibilityLabel: "x" },
          { id: "x", role: "action", accessibilityLabel: "x" },
        ],
      }),
    { code: "NAVIGATION_INVALID_TARGET" },
  );
  assert.throws(
    () =>
      normalizeNavigationChrome({
        leadingAction: {
          id: "x",
          role: "action",
          accessibilityLabel: "x",
        },
        trailingActions: [{ id: "x", role: "action", accessibilityLabel: "x" }],
      }),
    { code: "NAVIGATION_INVALID_TARGET" },
  );
});

test("navigation exposes semantic close while preserving legacy back adapters", async () => {
  const calls: string[] = [];
  const controller = createNavigationController({
    platform: "android",
    adapter: {
      platform: "android",
      async open() {
        calls.push("open");
      },
      async replace() {
        calls.push("replace");
      },
      async back() {
        calls.push("back");
        return true;
      },
      async close() {
        calls.push("close");
        return true;
      },
    },
  });
  await controller.open({ url: "lynx://home" });
  assert.equal(await controller.close(), true);
  assert.deepEqual(controller.stack, []);
  assert.deepEqual(calls, ["open", "close"]);
});

test("navigation delegates only validated operations to the injected adapter", async () => {
  const calls: string[] = [];
  const controller = createNavigationController({
    platform: "ios",
    adapter: {
      platform: "ios",
      async open(target) {
        calls.push(`open:${target.url}`);
      },
      async replace(target) {
        calls.push(`replace:${target.url}`);
      },
      async back() {
        calls.push("back");
        return true;
      },
    },
    createId: (() => {
      let id = 0;
      return () => `test_${++id}`;
    })(),
  });
  const events: string[] = [];
  controller.subscribe((event) => events.push(event.type));
  await controller.open({ url: "lynx://home" });
  assert.deepEqual(controller.stack, [{ url: "lynx://home" }]);
  await controller.navigate({
    path: "pages/chat.lynx.bundle",
    params: { id: "42" },
  });
  await controller.replace({ url: "lynxship://chat/42" });
  assert.equal(await controller.back(), true);
  assert.deepEqual(calls, [
    "open:lynx://home",
    "open:hybrid://lynxview_page?bundle=pages%2Fchat.lynx.bundle&id=42",
    "replace:lynxship://chat/42",
    "back",
  ]);
  assert.deepEqual(controller.stack, [{ url: "lynx://home" }]);
  assert.deepEqual(events, [
    "will-open",
    "did-open",
    "will-open",
    "did-open",
    "will-open",
    "did-open",
    "did-back",
  ]);
  controller.dispose();
  await assert.rejects(() => controller.open({ url: "lynx://home" }), {
    code: "NAVIGATION_DISPOSED",
  });
});

test("navigation interceptors can redirect or cancel before native effects", async () => {
  const calls: string[] = [];
  const controller = createNavigationController({
    platform: "android",
    adapter: {
      platform: "android",
      async open(target) {
        calls.push(target.url);
      },
      async replace() {},
      async back() {
        return false;
      },
    },
    interceptors: [
      ({ target }) =>
        target.url === "lynxship://login-required"
          ? { target: { url: "lynxship://login" } }
          : undefined,
      ({ target }) =>
        target.url === "lynxship://blocked"
          ? { cancel: true, reason: "blocked by policy" }
          : undefined,
    ],
  });
  await controller.open({ url: "lynxship://login-required" });
  assert.deepEqual(calls, ["lynxship://login"]);
  await assert.rejects(() => controller.open({ url: "lynxship://blocked" }), {
    code: "NAVIGATION_INTERCEPTED",
  });
  assert.deepEqual(calls, ["lynxship://login"]);
});
