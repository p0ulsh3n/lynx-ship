import {
  PermissionError,
  type PermissionAdapter,
  type PermissionClient,
  type PermissionName,
  type PermissionResult,
} from "./contracts.js";

const unavailable = (name: PermissionName): PermissionResult => ({
  name,
  state: "unavailable",
  canAskAgain: false,
});

export function createPermissionClient(
  adapter: PermissionAdapter | undefined,
): PermissionClient {
  const requireAdapter = (): PermissionAdapter => {
    if (!adapter)
      throw new PermissionError(
        "No native permission adapter was provided by the host.",
      );
    return adapter;
  };
  return {
    check: async (name) => (adapter ? adapter.check(name) : unavailable(name)),
    request: async (name) => requireAdapter().request(name),
    requestMany: async (names) => {
      const unique = [...new Set(names)];
      const results: PermissionResult[] = [];
      for (const name of unique)
        results.push(await requireAdapter().request(name));
      return results;
    },
    openSettings: async () => {
      const host = requireAdapter();
      if (!host.openSettings)
        throw new PermissionError("This host cannot open system settings.");
      await host.openSettings();
    },
  };
}
