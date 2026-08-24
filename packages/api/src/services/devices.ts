import { assert, type Platform } from "@lynxship/contracts";
import { IdGenerator } from "@lynxship/storage";

export interface Device {
  id: string;
  organizationId: string;
  projectId: string;
  platform: "ios";
  udid: string;
  name: string;
  status: "active" | "removed";
  registeredAt: string;
}

export class DeviceRegistry {
  readonly devices = new Map<string, Device>();

  register(input: {
    organizationId: string;
    projectId: string;
    platform: Platform;
    udid: string;
    name?: string;
  }): Device {
    assert(
      input.platform === "ios" && input.udid,
      "DEVICE_INPUT",
      "iOS device registration requires a UDID",
    );
    const device: Device = {
      id: IdGenerator.create("dev"),
      organizationId: input.organizationId,
      projectId: input.projectId,
      platform: "ios",
      udid: input.udid,
      name: input.name ?? input.udid,
      status: "active",
      registeredAt: new Date().toISOString(),
    };
    this.devices.set(device.id, device);
    return device;
  }

  remove(id: string): Device {
    const device = this.devices.get(id);
    assert(device, "DEVICE_NOT_FOUND", "Device not found");
    device.status = "removed";
    return device;
  }

  list(projectId?: string): Device[] {
    return [...this.devices.values()].filter(
      (device) =>
        (!projectId || device.projectId === projectId) &&
        device.status === "active",
    );
  }
}
