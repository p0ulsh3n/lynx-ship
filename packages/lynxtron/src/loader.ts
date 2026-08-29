import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { LynxtronArtifact, LynxtronLoadPlan } from "./contracts.js";

export async function verifyLynxtronArtifact(
  artifact: LynxtronArtifact,
): Promise<LynxtronLoadPlan> {
  const digest = createHash("sha256")
    .update((await readFile(artifact.path)).toString("latin1"), "latin1")
    .digest("hex");
  if (digest !== artifact.sha256.toLowerCase())
    throw new Error(`Lynxtron artifact hash mismatch for ${artifact.path}.`);
  return { artifact, target: artifact.target, verified: true };
}

export async function loadLynxtronArtifact(
  plan: LynxtronLoadPlan,
  host: {
    target: LynxtronArtifact["target"];
    loadBundle(path: string): Promise<void>;
  },
): Promise<void> {
  if (!plan.verified || plan.target !== host.target)
    throw new Error("Lynxtron artifact is not verified for this host target.");
  await host.loadBundle(plan.artifact.path);
}
