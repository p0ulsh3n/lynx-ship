import type { AndroidToolchainReport } from "./android-toolchain/types.js";
import { runProcess } from "./process-runner.js";
import { sdkManagerPath } from "./android-toolchain/probes.js";

export type {
  AndroidToolchainReport,
  ToolchainCheck,
  ToolchainCheckStatus,
} from "./android-toolchain/types.js";

import { inspectAndroidToolchain } from "./android-toolchain/inspection.js";

export { inspectAndroidToolchain };

export async function fixAndroidToolchain(
  root: string,
  report: AndroidToolchainReport,
  confirm: (message: string) => Promise<boolean>,
  onOutput?: (line: string) => void,
): Promise<void> {
  const managerCheck = report.checks.find((item) => item.name === "sdkmanager");
  const manager = report.sdkPath ? sdkManagerPath(report.sdkPath) : undefined;
  if (!manager || !report.sdkPackages.length) return;
  const packages = report.sdkPackages;
  if (
    !(await confirm(
      `Install missing Android SDK packages (${packages.join(", ")}) now?`,
    ))
  )
    return;
  await runProcess(manager, packages, { cwd: root, onOutput });
  if (managerCheck && !(await confirm("Accept Android SDK licenses now?")))
    return;
  await runProcess(manager, ["--licenses"], { cwd: root, onOutput });
}

export function formatAndroidToolchainFailure(
  report: AndroidToolchainReport,
): string {
  return report.checks
    .filter((item) => item.status === "fail")
    .map(
      (item) =>
        `${item.name}: ${item.value}${item.fix ? ` · fix: ${item.fix}` : ""}`,
    )
    .join("; ");
}
