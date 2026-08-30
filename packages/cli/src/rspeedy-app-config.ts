import { join } from "node:path";
import { createJiti } from "jiti";
import { LynxShipError } from "@lynxship/contracts";
import type { LoadedLynxShipAppConfig } from "./app-config.js";

interface RspeedyInstance {
  build: () => Promise<unknown>;
}

interface RspeedyModule {
  createRspeedy: (options: {
    cwd: string;
    rspeedyConfig: unknown;
    callerName: string;
  }) => Promise<RspeedyInstance>;
}

function buildError(code: string, message: string): LynxShipError {
  return new LynxShipError(code, message);
}

async function loadProjectRspeedy(root: string): Promise<RspeedyModule> {
  try {
    const jiti = createJiti(join(root, "package.json"), {
      fsCache: false,
      moduleCache: false,
      sourceMaps: false,
    });
    const module = (await jiti.import(
      "@lynx-js/rspeedy",
    )) as Partial<RspeedyModule>;
    if (typeof module.createRspeedy !== "function")
      throw new Error("@lynx-js/rspeedy does not expose createRspeedy");
    return module as RspeedyModule;
  } catch (error) {
    throw buildError(
      "CLI_RSPEEDY_REQUIRED",
      `A Lynx app.config was found, but @lynx-js/rspeedy could not be loaded from the project: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Build the `lynxConfig` exported by app.config without generating a proxy file. */
export async function buildRspeedyAppConfig(
  root: string,
  appConfig: LoadedLynxShipAppConfig,
): Promise<void> {
  const { createRspeedy } = await loadProjectRspeedy(root);
  const instance = await createRspeedy({
    cwd: root,
    rspeedyConfig: appConfig.config.lynxConfig,
    callerName: "lynxship",
  });
  await instance.build();
}
