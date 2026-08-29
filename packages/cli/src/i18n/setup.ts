import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess, packageManagerInstallCommand } from "../process-runner.js";
import {
  createI18nSetupPlan,
  entryImportPath,
  renderPolyfillSource,
} from "./plan.js";
import type { I18nSetupResult } from "./types.js";
import { projectRelative } from "./discovery.js";

export async function setupI18n(options: {
  root: string;
  entry?: string;
  capabilities?: readonly import("@lynxship/i18n").IntlCapability[];
  locales?: readonly string[];
  persistence: boolean;
  dryRun: boolean;
  onOutput?: (line: string) => void;
}): Promise<I18nSetupResult> {
  const plan = await createI18nSetupPlan(options);
  if (options.dryRun)
    return {
      ...plan,
      status: "planned",
      installed: [],
      filesChanged: [],
    };

  if (plan.packages.length > 0) {
    const command = packageManagerInstallCommand(options.root, plan.packages);
    await runProcess(command.command, command.args, {
      cwd: options.root,
      onOutput: options.onOutput,
    });
  }

  const polyfillFile = join(options.root, plan.polyfillFile);
  await mkdir(join(options.root, "src", "lynxship"), { recursive: true });
  const generated = renderPolyfillSource(plan);
  const oldGenerated = await readFile(polyfillFile, "utf8").catch(() => "");
  if (oldGenerated !== generated)
    await writeFile(polyfillFile, generated, "utf8");

  const entryFile = join(options.root, plan.entryFile);
  const source = await readFile(entryFile, "utf8");
  const importLine = `import ${JSON.stringify(entryImportPath(plan))};`;
  const patched = source.includes(importLine)
    ? source
    : `${importLine}\n${source}`;
  if (patched !== source) await writeFile(entryFile, patched, "utf8");

  return {
    ...plan,
    status: "applied",
    installed: plan.packages,
    filesChanged: [
      ...(oldGenerated === generated
        ? []
        : [projectRelative(options.root, polyfillFile)]),
      ...(patched === source ? [] : [plan.entryFile]),
    ],
  };
}
