const COMMAND_TITLES: Readonly<Record<string, string>> = {
  init: "Initialize project",
  doctor: "Environment doctor",
  dev: "Rspeedy development",
  preview: "Rspeedy preview",
  inspect: "Rspeedy inspection",
  profile: "Rspeedy profiling",
  autolink: "Lynx Autolink",
  run: "Run on device",
  logs: "Native logs",
  ota: "OTA diagnostics",
  build: "Cloud Build",
  submit: "Store Submission",
  update: "OTA Update",
  rollback: "OTA Rollback",
  "self-host": "Self-host setup",
  storage: "Cloudflare R2 setup",
  android: "Android signing setup",
  store: "App store submission setup",
  devtool: "Lynx DevTool diagnostics",
  trace: "Lynx Trace diagnostics",
  recorder: "Lynx Recorder diagnostics",
  plugin: "LynxShip plugins",
};

export function commandTitle(command: string): string {
  return COMMAND_TITLES[command] ?? command;
}

export function exitCode(error: unknown): number {
  const code = (error as { code?: string }).code;
  if (code?.startsWith("CLI_") || code?.startsWith("CONFIG_")) return 2;
  if (code === "BUILD_SIGNING_REQUIRED") return 2;
  if (code === "DESKTOP_SIGNING_REQUIRED") return 2;
  if (code?.startsWith("AUTH_")) return 4;
  if (code?.startsWith("BUILD_")) return 5;
  if (code?.startsWith("SUBMISSION_")) return 6;
  if (code?.startsWith("OTA_")) return 7;
  return 1;
}
