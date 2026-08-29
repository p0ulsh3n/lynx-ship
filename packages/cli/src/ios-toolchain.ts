export type {
  IosBuildTarget,
  IosToolchainCheck,
  IosToolchainReport,
  IosToolchainStatus,
} from "./ios-toolchain/types.js";

export { inspectIosToolchain } from "./ios-toolchain/inspection.js";

import type { IosToolchainReport } from "./ios-toolchain/types.js";

export function formatIosToolchainFailure(report: IosToolchainReport): string {
  return report.checks
    .filter((item) => item.status === "fail")
    .map(
      (item) =>
        `${item.name}: ${item.value}${item.fix ? ` · fix: ${item.fix}` : ""}`,
    )
    .join("; ");
}
