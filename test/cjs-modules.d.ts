declare module "*.cjs" {
  const moduleValue: {
    createBundlePlan(
      projectRoot: string,
      options?: { bundlePath?: string; embeddedBundle?: string },
    ): Promise<{
      sourceBundle: string;
      sourceDirectory: string;
      bundlePath: string;
      embeddedBundle: string;
      files: Array<{
        absolute: string;
        relative: string;
        destination: string;
      }>;
    }>;
    syncBundleDirectory(options: {
      projectRoot: string;
      plan: Awaited<ReturnType<typeof moduleValue.createBundlePlan>>;
      destinationRoot: string;
      manifestPath: string;
      platform: "android" | "ios";
    }): Promise<{
      platform: "android" | "ios";
      sourceBundle: string;
      destinationRoot: string;
      manifestPath: string;
      files: Array<{ path: string; size: number; sha256: string }>;
    }>;
    syncLynxAssets(
      projectRoot: string,
      options?: {
        platform?: "android" | "ios";
        bundlePath?: string;
        embeddedBundle?: string;
        iosSourceRoot?: string;
      },
    ): Promise<unknown>;
  };
  export default moduleValue;
}
