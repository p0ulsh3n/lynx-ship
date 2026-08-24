import { cp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
const runPnpm = (args: string[]) =>
  process.platform === "win32"
    ? exec("cmd.exe", ["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`])
    : exec("pnpm", args);
await runPnpm(["--filter", "@lynxship/api", "build"]);
await runPnpm(["--filter", "@lynxship/cli", "build"]);
await cp("packages/api/dist", "dist/packages/api", { recursive: true });
await cp("packages/cli/dist", "dist/packages/cli", { recursive: true });
await runPnpm(["--filter", "@lynxship/dashboard", "build"]);
await cp("packages/dashboard/dist", "dist/dashboard-app", { recursive: true });
console.log(
  "build: copied runtime compatibility sources and dashboard output to dist",
);
