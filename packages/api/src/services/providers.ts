import { assert, type BuildJob, type Platform } from "@lynxship/contracts";

export interface ProviderDefinition {
  id: string;
  platform: Platform;
  mode: string;
  capabilities: Record<string, boolean>;
  execute: (job: BuildJob) => Promise<unknown>;
  status: "ready" | "draining";
}

export class ManagedProviderCatalog {
  readonly providers = new Map<string, ProviderDefinition>();

  register(input: {
    id: string;
    platform: Platform;
    mode?: string;
    capabilities?: Record<string, boolean>;
    execute: (job: BuildJob) => Promise<unknown>;
  }): Omit<ProviderDefinition, "execute"> {
    assert(
      input.id && input.platform && typeof input.execute === "function",
      "PROVIDER_INPUT",
      "Provider id, platform and execute function are required",
    );
    const provider: ProviderDefinition = {
      id: input.id,
      platform: input.platform,
      mode: input.mode ?? "managed",
      capabilities: input.capabilities ?? {},
      execute: input.execute,
      status: "ready",
    };
    this.providers.set(provider.id, provider);
    const { execute: _execute, ...safe } = provider;
    return safe;
  }

  select(input: {
    platform: Platform;
    required?: string[];
  }): ProviderDefinition | undefined {
    return [...this.providers.values()].find(
      (provider) =>
        provider.platform === input.platform &&
        provider.status === "ready" &&
        (input.required ?? []).every(
          (capability) => provider.capabilities[capability],
        ),
    );
  }

  drain(id: string): ProviderDefinition {
    const provider = this.providers.get(id);
    assert(provider, "PROVIDER_NOT_FOUND", "Provider not found");
    provider.status = "draining";
    return provider;
  }

  list(): Array<Omit<ProviderDefinition, "execute">> {
    return [...this.providers.values()].map(
      ({ execute: _execute, ...provider }) => provider,
    );
  }
}
