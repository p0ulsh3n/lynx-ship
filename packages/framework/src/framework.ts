import {
  FrameworkError,
  type FrameworkPlatform,
} from "./contracts/platform.js";
import {
  CapabilityRegistry,
  type CapabilityDescriptor,
  type RequiredCapability,
} from "./capabilities/registry.js";
import {
  LifecycleMachine,
  type FrameworkState,
  type FrameworkStateEvent,
} from "./lifecycle/machine.js";
import {
  type ContainerMountRequest,
  type ContainerUpdateRequest,
  type LynxShipContainer,
} from "./container/contracts.js";
import {
  validateBundleReference,
  validateContainerMountRequest,
} from "./container/validation.js";
import { ExclusiveOperationQueue, waitForPromise } from "./lifecycle/async.js";

export interface FrameworkOptions {
  readonly platform: FrameworkPlatform;
  readonly container: LynxShipContainer;
  readonly capabilities?: readonly CapabilityDescriptor[];
  /** Optional upper bound for a native first-screen callback. */
  readonly firstScreenTimeoutMs?: number;
}

export class LynxShipFramework {
  public readonly platform: FrameworkPlatform;

  public readonly lifecycle = new LifecycleMachine();

  public readonly capabilities = new CapabilityRegistry();

  private readonly container: LynxShipContainer;

  private readonly operations = new ExclusiveOperationQueue();

  private readonly firstScreenTimeoutMs?: number;

  public constructor(options: FrameworkOptions) {
    if (options.container.platform !== options.platform)
      throw new FrameworkError(
        "FRAMEWORK_PLATFORM_MISMATCH",
        "The container platform must match the framework platform.",
        { framework: options.platform, container: options.container.platform },
      );
    this.platform = options.platform;
    this.container = options.container;
    if (
      options.firstScreenTimeoutMs !== undefined &&
      (!Number.isInteger(options.firstScreenTimeoutMs) ||
        options.firstScreenTimeoutMs < 1 ||
        options.firstScreenTimeoutMs > 86_400_000)
    )
      throw new FrameworkError(
        "FRAMEWORK_TIMEOUT_CONFIG",
        "firstScreenTimeoutMs must be an integer between 1 and 86400000.",
      );
    this.firstScreenTimeoutMs = options.firstScreenTimeoutMs;
    for (const capability of options.capabilities ?? [])
      this.capabilities.register(capability);
  }

  public get state(): FrameworkState {
    return this.lifecycle.state;
  }

  public requireCapability(
    requirement: RequiredCapability,
  ): CapabilityDescriptor {
    return this.capabilities.require({
      ...requirement,
      platform: requirement.platform ?? this.platform,
    });
  }

  public subscribe(listener: (event: FrameworkStateEvent) => void): () => void {
    return this.lifecycle.subscribe(listener);
  }

  public start(request: ContainerMountRequest): Promise<void> {
    return this.operations.run(() => this.startInternal(request));
  }

  private async startInternal(request: ContainerMountRequest): Promise<void> {
    if (this.state !== "created" && this.state !== "failed")
      throw new FrameworkError(
        "FRAMEWORK_ALREADY_STARTED",
        "Cannot start from state " + this.state + ".",
      );
    validateContainerMountRequest(request);
    this.lifecycle.transition("resolving");
    try {
      this.lifecycle.transition("verified");
      this.lifecycle.transition("mounting");
      const result = await this.container.mount(request);
      for (const capability of result.capabilities ?? [])
        this.capabilities.register(capability);
      this.lifecycle.transition("first-screen");
      await waitForPromise(result.firstScreen, {
        signal: request.signal,
        timeoutMs: this.firstScreenTimeoutMs,
        onAbort: () =>
          new FrameworkError(
            "FRAMEWORK_ABORTED",
            "The framework start operation was aborted before first screen.",
          ),
        onTimeout: () =>
          new FrameworkError(
            "FRAMEWORK_FIRST_SCREEN_TIMEOUT",
            "The native container did not report first screen before the timeout.",
            { timeoutMs: this.firstScreenTimeoutMs },
          ),
      });
      this.lifecycle.transition("interactive");
    } catch (error) {
      if (this.lifecycle.state !== "disposed")
        this.lifecycle.transition("failed");
      throw error;
    }
  }

  public update(request: ContainerUpdateRequest): Promise<void> {
    return this.operations.run(() => this.updateInternal(request));
  }

  private async updateInternal(request: ContainerUpdateRequest): Promise<void> {
    if (this.state !== "interactive")
      throw new FrameworkError(
        "FRAMEWORK_NOT_INTERACTIVE",
        "Cannot update from state " +
          this.state +
          "; the container is not interactive.",
      );
    validateBundleReference(request.bundle);
    this.lifecycle.transition("updating");
    try {
      await this.container.update(request);
      this.lifecycle.transition("interactive");
    } catch (error) {
      this.lifecycle.transition("failed");
      throw error;
    }
  }

  public dispose(): Promise<void> {
    return this.operations.run(() => this.disposeInternal());
  }

  private async disposeInternal(): Promise<void> {
    if (this.state === "disposed") return;
    await this.container.unmount();
    this.lifecycle.transition("disposed");
  }
}

export function createFramework(options: FrameworkOptions): LynxShipFramework {
  return new LynxShipFramework(options);
}
