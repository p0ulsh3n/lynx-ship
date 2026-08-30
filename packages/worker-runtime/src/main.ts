import { pathToFileURL } from "node:url";
import type { BuildWorkerExecutor } from "@lynxship/worker-service";
import { loadHostedWorkerConfig } from "./config.js";
import { connectHostedWorker } from "./service.js";

const config = loadHostedWorkerConfig();
const executor = await loadExecutor();
const connected = await connectHostedWorker(config, executor);
const shutdown = async (): Promise<void> => {
  await connected.service.stop();
  await connected.queue.close();
};
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
await connected.service.start();

async function loadExecutor(): Promise<BuildWorkerExecutor> {
  const modulePath = process.env.LYNXSHIP_WORKER_EXECUTOR_MODULE;
  if (!modulePath)
    throw new Error(
      "LYNXSHIP_WORKER_EXECUTOR_MODULE is required; hosted workers must provide an explicit trusted platform executor",
    );
  const module = (await import(pathToFileURL(modulePath).href)) as {
    default?: BuildWorkerExecutor;
    createExecutor?: () => BuildWorkerExecutor | Promise<BuildWorkerExecutor>;
  };
  const executor = module.createExecutor
    ? await module.createExecutor()
    : module.default;
  if (!executor || typeof executor.execute !== "function")
    throw new Error(
      "LYNXSHIP_WORKER_EXECUTOR_MODULE must export an executor or createExecutor()",
    );
  return executor;
}
