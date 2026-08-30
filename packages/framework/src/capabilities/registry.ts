import {
  FrameworkError,
  type FrameworkCapabilityPlatform,
  type FrameworkPlatform,
} from "../contracts/platform.js";

export interface CapabilityDescriptor {
  readonly id: string;
  readonly platform: FrameworkCapabilityPlatform;
  readonly version?: string;
  readonly permissions?: readonly string[];
  readonly experimental?: boolean;
}

export interface RequiredCapability {
  readonly id: string;
  readonly platform?: FrameworkPlatform;
  readonly minVersion?: string;
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function validateDescriptor(descriptor: CapabilityDescriptor): void {
  if (!descriptor.id.trim())
    throw new FrameworkError(
      "FRAMEWORK_CAPABILITY_ID",
      "Capability ids must be non-empty.",
    );
  if (
    descriptor.version !== undefined &&
    !/^\d+(?:\.\d+){0,2}$/.test(descriptor.version)
  )
    throw new FrameworkError(
      "FRAMEWORK_CAPABILITY_VERSION",
      "Invalid capability version for " + descriptor.id + ".",
    );
  if (
    descriptor.permissions?.some(
      (permission) => !permission.trim() || permission.length > 128,
    )
  )
    throw new FrameworkError(
      "FRAMEWORK_CAPABILITY_PERMISSION",
      "Invalid permission declaration for " + descriptor.id + ".",
    );
}

export class CapabilityRegistry {
  private readonly descriptors = new Map<string, CapabilityDescriptor>();

  public register(descriptor: CapabilityDescriptor): void {
    validateDescriptor(descriptor);
    const previous = this.descriptors.get(descriptor.id);
    if (previous) {
      if (
        previous.platform !== descriptor.platform ||
        previous.version !== descriptor.version
      )
        throw new FrameworkError(
          "FRAMEWORK_CAPABILITY_CONFLICT",
          "Capability " +
            descriptor.id +
            " is already registered with a different contract.",
          { previous, descriptor },
        );
      return;
    }
    this.descriptors.set(descriptor.id, {
      ...descriptor,
      permissions: descriptor.permissions
        ? [...new Set(descriptor.permissions)]
        : undefined,
    });
  }

  public list(): readonly CapabilityDescriptor[] {
    return [...this.descriptors.values()].map((descriptor) => ({
      ...descriptor,
      permissions: descriptor.permissions
        ? [...descriptor.permissions]
        : undefined,
    }));
  }

  public require(requirement: RequiredCapability): CapabilityDescriptor {
    const descriptor = this.descriptors.get(requirement.id);
    const platformMatches =
      descriptor &&
      (descriptor.platform === "all" ||
        requirement.platform === undefined ||
        descriptor.platform === requirement.platform);
    const versionMatches =
      descriptor &&
      (requirement.minVersion === undefined ||
        (descriptor.version !== undefined &&
          compareVersions(descriptor.version, requirement.minVersion) >= 0));
    if (!descriptor || !platformMatches || !versionMatches)
      throw new FrameworkError(
        "FRAMEWORK_CAPABILITY_MISSING",
        "Required capability " + requirement.id + " is not available.",
        { requirement, available: descriptor ?? null },
      );
    return descriptor;
  }
}
