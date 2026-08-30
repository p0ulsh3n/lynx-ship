import test from "node:test";
import assert from "node:assert/strict";
import {
  CapabilityRegistry,
  defineLynxShipAppConfig,
  FrameworkError,
  LifecycleMachine,
  createGlobalProps,
  createContainerRuntime,
  createContainerUiController,
  createFramework,
  normalizeLynxShipAppConfig,
  validateGlobalProps,
  validateBundleReference,
  type LynxShipContainer,
} from "@lynxship/framework";

test("unified app config validates routes, paths, platforms and plugins", () => {
  const config = defineLynxShipAppConfig({
    lynxConfig: { source: { entry: { main: "./src/main.tsx" } } },
    appName: "Example",
    appIcon: "assets/icon.png",
    splashScreen: { backgroundColor: "#071522", image: "assets/splash.png" },
    router: { baseScheme: "hybrid://lynxview_page", initialRoute: "/" },
    paths: { android: "android/app/src/main/assets" },
    platform: { ios: { bundleIdentifier: "com.example.app" } },
    routes: [{ name: "home", bundle: "main.lynx.bundle", path: "/" }],
    plugins: [["@lynxship/navigation", { enabled: true }]],
  });
  assert.equal(config.appName, "Example");
  assert.equal(config.router?.baseScheme, "hybrid://lynxview_page");
  assert.throws(
    () =>
      defineLynxShipAppConfig({
        lynxConfig: {},
        paths: { android: "../outside" },
      }),
    { code: "FRAMEWORK_CONFIG_INVALID" },
  );
  assert.throws(
    () =>
      defineLynxShipAppConfig({
        lynxConfig: {},
        routes: [
          { name: "home", bundle: "a.lynx.bundle" },
          { name: "home", bundle: "b.lynx.bundle" },
        ],
      }),
    { code: "FRAMEWORK_CONFIG_INVALID" },
  );
  assert.throws(
    () =>
      defineLynxShipAppConfig({
        lynxConfig: {},
        splashScreen: { backgroundColor: "red" },
      }),
    { code: "FRAMEWORK_CONFIG_INVALID" },
  );
});

test("app config accepts Sparkling-style route and plugin aliases", () => {
  const config = normalizeLynxShipAppConfig({
    lynxConfig: {},
    plugin: [["@lynxship/navigation", { enabled: true }]],
    router: {
      main: { bundle: "main.lynx.bundle", path: "/" },
      routes: {
        chat: {
          bundle: "pages/chat.lynx.bundle",
          path: "/chat",
          title: "Chat",
          params: { animated: true, tab: "messages" },
        },
      },
    },
  });
  assert.deepEqual(config.plugins, [
    ["@lynxship/navigation", { enabled: true }],
  ]);
  assert.deepEqual(config.routes, [
    { name: "main", bundle: "main.lynx.bundle", path: "/" },
    { name: "chat", bundle: "pages/chat.lynx.bundle", path: "/chat" },
  ]);
  assert.throws(
    () =>
      normalizeLynxShipAppConfig({
        lynxConfig: {},
        router: { routes: { chat: { bundle: "../outside.lynx.bundle" } } },
      }),
    { code: "FRAMEWORK_CONFIG_INVALID" },
  );
});

test("global props provide a validated cross-platform host context", () => {
  const props = createGlobalProps(
    {
      os: "android",
      osVersion: "15",
      deviceModel: "pixel",
      containerID: "container-1",
      containerInitTime: "1725000000000",
      screenWidth: 412,
      screenHeight: 915,
      contentWidth: 412,
      contentHeight: 883,
      safeAreaInsets: { top: 32, right: 0, bottom: 0, left: 0 },
      pixelRatio: 2.75,
      accessibleMode: 1,
      isIPhoneXMax: 0,
      isPad: 0,
      isNotchScreen: false,
      isLowPowerMode: 0,
      statusBarHeight: 32,
      navigationBarHeight: 0,
      orientation: "portrait",
      screenOrientation: "portrait",
      theme: "dark",
      appLanguage: "fr",
      appLocale: "fr-FR",
      isAppBackground: false,
      queryItems: { route: "home" },
    },
    { featureFlag: true },
  );
  assert.equal(props.os, "android");
  assert.equal(props.featureFlag, true);
  assert.equal(Object.isFrozen(props), true);
  assert.throws(
    () => createGlobalProps({ ...props, theme: "dark" }, { theme: "light" }),
    { code: "FRAMEWORK_GLOBAL_PROPS_INVALID" },
  );
  assert.throws(() => validateGlobalProps({ ...props, pixelRatio: 0 }), {
    code: "FRAMEWORK_GLOBAL_PROPS_INVALID",
  });
  assert.throws(() => validateGlobalProps({ ...props, isIPhoneX: 2 }), {
    code: "FRAMEWORK_GLOBAL_PROPS_INVALID",
  });
});

test("framework lifecycle waits for the real first-screen signal", async () => {
  let resolveFirstScreen!: () => void;
  const firstScreen = new Promise<void>((resolve) => {
    resolveFirstScreen = resolve;
  });
  let mounted = false;
  let updated = false;
  const container: LynxShipContainer = {
    platform: "android",
    async mount() {
      mounted = true;
      return {
        firstScreen,
        capabilities: [{ id: "storage", platform: "all" }],
      };
    },
    async update() {
      updated = true;
    },
    async unmount() {},
  };
  const framework = createFramework({ platform: "android", container });
  const states: string[] = [];
  framework.subscribe(({ state }) => states.push(state));
  const start = framework.start({ bundle: { id: "main" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mounted, true);
  assert.equal(framework.state, "first-screen");
  resolveFirstScreen();
  await start;
  assert.equal(framework.state, "interactive");
  await framework.update({ bundle: { id: "main-v2" } });
  assert.equal(updated, true);
  assert.deepEqual(states, [
    "resolving",
    "verified",
    "mounting",
    "first-screen",
    "interactive",
    "updating",
    "interactive",
  ]);
  framework.requireCapability({ id: "storage" });
  await framework.dispose();
  assert.equal(framework.state, "disposed");
});

test("framework rejects cross-platform containers and invalid lifecycle use", () => {
  const container: LynxShipContainer = {
    platform: "ios",
    async mount() {
      return { firstScreen: Promise.resolve() };
    },
    async update() {},
    async unmount() {},
  };
  assert.throws(
    () => createFramework({ platform: "android", container }),
    (error: unknown) =>
      error instanceof FrameworkError &&
      error.code === "FRAMEWORK_PLATFORM_MISMATCH",
  );
  const machine = new LifecycleMachine();
  assert.throws(
    () => machine.transition("interactive"),
    (error: unknown) =>
      error instanceof FrameworkError &&
      error.code === "FRAMEWORK_INVALID_TRANSITION",
  );
});

test("capability registry validates platform, version and conflicts", () => {
  const registry = new CapabilityRegistry();
  registry.register({
    id: "navigation",
    platform: "ios",
    version: "2.1.0",
    permissions: ["navigation:open"],
  });
  assert.equal(
    registry.require({
      id: "navigation",
      platform: "ios",
      minVersion: "2.0.0",
    }).version,
    "2.1.0",
  );
  assert.throws(
    () => registry.require({ id: "navigation", platform: "android" }),
    { code: "FRAMEWORK_CAPABILITY_MISSING" },
  );
  assert.throws(
    () =>
      registry.register({
        id: "navigation",
        platform: "ios",
        version: "3.0.0",
      }),
    { code: "FRAMEWORK_CAPABILITY_CONFLICT" },
  );
});

test("bundle validation rejects ambiguous or unsafe references before mounting", () => {
  assert.throws(
    () =>
      validateBundleReference({
        id: "main",
        path: "dist/main",
        url: "https://cdn.test/main",
      }),
    (error: unknown) =>
      error instanceof FrameworkError &&
      error.code === "FRAMEWORK_BUNDLE_REFERENCE",
  );
  assert.throws(
    () => validateBundleReference({ id: "main", url: "http://cdn.test/main" }),
    (error: unknown) =>
      error instanceof FrameworkError &&
      error.code === "FRAMEWORK_BUNDLE_REFERENCE",
  );
  assert.doesNotThrow(() =>
    validateBundleReference({
      id: "main",
      url: "http://localhost:3000/main.lynx.bundle",
      sha256: "a".repeat(64),
    }),
  );
});

test("container presentation validates Sparkling-style host hints before effects", async () => {
  let mounted = false;
  const runtime = createContainerRuntime({
    platform: "ios",
    async mount(request) {
      mounted = request.presentation?.contentMode === "fit-size";
      return { firstScreen: Promise.resolve() };
    },
    async update() {},
    async unmount() {},
  });
  await runtime.mount({
    bundle: { id: "card" },
    presentation: {
      title: "Card",
      hideNavigationBar: true,
      backgroundColor: "#071522",
      hideLoading: true,
      loadingBackgroundColor: "#0B1D2E",
      hideError: true,
      theme: "dark",
      contentMode: "fit-size",
    },
  });
  assert.equal(mounted, true);
  await runtime.unmount();

  let effects = 0;
  const invalidRuntime = createContainerRuntime({
    platform: "ios",
    async mount() {
      effects += 1;
      return { firstScreen: Promise.resolve() };
    },
    async update() {},
    async unmount() {},
  });
  await assert.rejects(
    () =>
      invalidRuntime.mount({
        bundle: { id: "card" },
        presentation: { navigationBarColor: "not-a-color" },
      }),
    { code: "FRAMEWORK_BUNDLE_REFERENCE" },
  );
  assert.equal(effects, 0);
  await assert.rejects(
    () =>
      invalidRuntime.mount({
        bundle: { id: "card" },
        presentation: { kind: "overlay" as never },
      }),
    { code: "FRAMEWORK_BUNDLE_REFERENCE" },
  );
});

test("container runtime prepares without mounting or changing active state", async () => {
  const calls: string[] = [];
  const events: string[] = [];
  const runtime = createContainerRuntime({
    platform: "android",
    async prepare(request) {
      calls.push(`prepare:${request.bundle.id}`);
    },
    async mount() {
      calls.push("mount");
      return { firstScreen: Promise.resolve() };
    },
    async update() {},
    async unmount() {},
  });
  runtime.subscribe((event) => events.push(event.type));

  await runtime.prepare({ bundle: { id: "prefetch", path: "dist/prefetch" } });
  assert.deepEqual(calls, ["prepare:prefetch"]);
  assert.equal(runtime.currentBundle, undefined);
  assert.equal(runtime.loadState, "idle");
  assert.deepEqual(events, ["prepare-start", "prepared"]);
  await runtime.unmount();

  const unsupported = createContainerRuntime({
    platform: "android",
    async mount() {
      return { firstScreen: Promise.resolve() };
    },
    async update() {},
    async unmount() {},
  });
  await assert.rejects(
    () => unsupported.prepare({ bundle: { id: "prefetch" } }),
    { code: "FRAMEWORK_CONTAINER_CAPABILITY_MISSING" },
  );
  await unsupported.unmount();
});

test("container runtime observes and cleans up live intrinsic-size signals", async () => {
  let listener: ((size: { width: number; height: number }) => void) | undefined;
  let unsubscribed = false;
  const events: Array<{ width: number; height: number }> = [];
  const runtime = createContainerRuntime({
    platform: "android",
    async mount() {
      return {
        firstScreen: Promise.resolve(),
        subscribeIntrinsicSize(next) {
          listener = next;
          return () => {
            unsubscribed = true;
            listener = undefined;
          };
        },
      };
    },
    async update() {},
    async unmount() {},
  });
  runtime.subscribe((event) => {
    if (event.type === "intrinsic-size") events.push(event.size);
  });
  await runtime.mount({
    bundle: { id: "embedded" },
    presentation: { kind: "embedded", contentMode: "fit-size" },
  });
  listener?.({ width: 320, height: 480 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [{ width: 320, height: 480 }]);
  await runtime.unmount();
  assert.equal(unsubscribed, true);
  listener?.({ width: -1, height: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [{ width: 320, height: 480 }]);
});

test("container runtime exposes serialized reload, lifecycle controls and release", async () => {
  const calls: string[] = [];
  const events: string[] = [];
  const runtime = createContainerRuntime({
    platform: "android",
    async mount(request) {
      calls.push(`mount:${request.bundle.id}`);
      return {
        firstScreen: Promise.resolve(),
        intrinsicSize: Promise.resolve({ width: 320, height: 640 }),
      };
    },
    async reload(request) {
      calls.push(`reload:${request?.bundle.id ?? "none"}`);
      return { firstScreen: Promise.resolve() };
    },
    async updateData(data, processorName) {
      calls.push(`data:${data}:${processorName ?? "default"}`);
    },
    async update() {},
    async updateGlobalProps(props) {
      calls.push(`props:${Object.keys(props).join(",")}`);
    },
    async updateGlobalPropsByIncrement(props) {
      calls.push(`increment:${Object.keys(props).join(",")}`);
    },
    async sendGlobalEvent(name) {
      calls.push(`event:${name}`);
    },
    async show() {
      calls.push("show");
    },
    async hide() {
      calls.push("hide");
    },
    async updateViewport(viewport) {
      calls.push(`viewport:${viewport.width}x${viewport.height}`);
    },
    async unmount() {
      calls.push("unmount");
    },
  });
  runtime.subscribe((event) => events.push(event.type));
  const mounted = await runtime.mount({ bundle: { id: "main" } });
  await mounted.firstScreen;
  await runtime.updateGlobalProps({ theme: "dark" });
  await runtime.updateGlobalPropsByIncrement({ locale: "fr" });
  await runtime.updateData('{"count":2}', "inbox");
  await runtime.sendGlobalEvent("refresh", []);
  await runtime.show();
  await runtime.hide();
  await runtime.updateViewport({ width: 320, height: 640 });
  const reloaded = await runtime.reload();
  await reloaded.firstScreen;
  await runtime.unmount();
  assert.equal(runtime.loadState, "released");
  assert.deepEqual(calls, [
    "mount:main",
    "increment:theme",
    "increment:locale",
    'data:{"count":2}:inbox',
    "event:refresh",
    "show",
    "hide",
    "viewport:320x640",
    "reload:main",
    "unmount",
  ]);
  assert.deepEqual(events, [
    "load-start",
    "first-screen",
    "intrinsic-size",
    "data-update",
    "show",
    "hide",
    "viewport",
    "load-start",
    "first-screen",
    "released",
  ]);
  await assert.rejects(() => runtime.show(), {
    code: "FRAMEWORK_CONTAINER_RELEASED",
  });
});

test("container UI providers observe lifecycle events without breaking the runtime", async () => {
  const events: string[] = [];
  const runtime = createContainerRuntime(
    {
      platform: "android",
      async mount() {
        return { firstScreen: Promise.resolve() };
      },
      async update() {},
      async unmount() {},
    },
    {
      ui: {
        render(event) {
          events.push(event.type);
          if (event.type === "load-start") throw new Error("UI failed");
        },
      },
    },
  );

  await runtime.mount({
    bundle: { id: "main", path: "dist/main.lynx.bundle" },
  });
  await runtime.unmount();
  assert.deepEqual(events, ["load-start", "first-screen", "released"]);
});

test("container UI controller provides portable loading, error and retry state", async () => {
  const models: string[] = [];
  let retries = 0;
  const controller = createContainerUiController({
    presentation: { title: "Inbox", theme: "dark" },
    onRender(model) {
      models.push(`${model.phase}:${model.visible}:${model.canRetry}`);
    },
    async onRetry() {
      retries += 1;
    },
  });
  const bundle = { id: "main", path: "dist/main.lynx.bundle" };

  controller.render({ type: "load-start", bundle });
  controller.render({ type: "error", error: new Error("network") });
  assert.equal(controller.snapshot.phase, "error");
  assert.equal(controller.snapshot.canRetry, true);
  await controller.retry();
  assert.equal(retries, 1);
  assert.equal(controller.snapshot.phase, "loading");
  controller.render({ type: "first-screen", bundle });
  controller.render({ type: "hide" });
  assert.deepEqual(models, [
    "loading:true:false",
    "error:true:true",
    "loading:true:false",
    "ready:true:false",
    "ready:false:false",
  ]);
  assert.deepEqual(controller.snapshot.presentation, {
    title: "Inbox",
    theme: "dark",
  });
});

test("container runtime fails explicitly when a native control is missing", async () => {
  const runtime = createContainerRuntime({
    platform: "ios",
    async mount() {
      return {
        firstScreen: Promise.resolve(),
        intrinsicSize: Promise.resolve({ width: 390, height: 844 }),
      };
    },
    async update() {},
    async unmount() {},
  });
  await assert.rejects(() => runtime.show(), {
    code: "FRAMEWORK_CONTAINER_CAPABILITY_MISSING",
  });
  await assert.rejects(
    () => runtime.updateViewport({ width: Number.NaN, height: 1 }),
    { code: "FRAMEWORK_CONTAINER_VIEWPORT_INVALID" },
  );
  await runtime.unmount();
});

test("framework serializes lifecycle operations and supports first-screen abort", async () => {
  let resolveFirstScreen!: () => void;
  const firstScreen = new Promise<void>((resolve) => {
    resolveFirstScreen = resolve;
  });
  let unmounted = false;
  const container: LynxShipContainer = {
    platform: "android",
    async mount() {
      return { firstScreen };
    },
    async update() {},
    async unmount() {
      unmounted = true;
    },
  };
  const framework = createFramework({
    platform: "android",
    container,
    firstScreenTimeoutMs: 5_000,
  });
  const start = framework.start({ bundle: { id: "main" } });
  const dispose = framework.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(framework.state, "first-screen");
  resolveFirstScreen();
  await start;
  await dispose;
  assert.equal(unmounted, true);
  assert.equal(framework.state, "disposed");

  const abort = new AbortController();
  const aborted = createFramework({
    platform: "android",
    container: {
      ...container,
      async unmount() {},
    },
  });
  abort.abort();
  await assert.rejects(
    () => aborted.start({ bundle: { id: "main" }, signal: abort.signal }),
    { code: "FRAMEWORK_ABORTED" },
  );
  assert.equal(aborted.state, "failed");

  const timedOut = createFramework({
    platform: "android",
    container: {
      platform: "android",
      async mount() {
        return { firstScreen: new Promise<void>(() => {}) };
      },
      async update() {},
      async unmount() {},
    },
    firstScreenTimeoutMs: 1,
  });
  await assert.rejects(() => timedOut.start({ bundle: { id: "main" } }), {
    code: "FRAMEWORK_FIRST_SCREEN_TIMEOUT",
  });
  assert.equal(timedOut.state, "failed");
  assert.throws(
    () =>
      createFramework({
        platform: "android",
        container,
        firstScreenTimeoutMs: 0,
      }),
    { code: "FRAMEWORK_TIMEOUT_CONFIG" },
  );
});
