import {
  MediaCapabilityError,
  type MediaAdapter,
  type MediaClient,
  type MediaKind,
} from "./contracts.js";
import { createMediaTransferMethods } from "./transfer.js";
import { createMediaSelectionMethods } from "./selection.js";

export function createMediaClient(adapter: MediaAdapter): MediaClient {
  const requireCapability = (
    kind: MediaKind,
    capability: "enumerate" | "capture" | "pick",
  ) => {
    if (!adapter.has(kind, capability))
      throw new MediaCapabilityError(
        `The host does not support '${capability}' for '${kind}'.`,
      );
  };
  return {
    has: (kind, capability) => adapter.has(kind, capability),
    requestAccess: (kind) => adapter.requestAccess(kind),
    listDevices: async () => {
      requireCapability("camera", "enumerate");
      if (!adapter.listDevices)
        throw new MediaCapabilityError(
          "The host did not provide listDevices().",
        );
      return adapter.listDevices();
    },
    capture: async (options) => {
      requireCapability(options.kind, "capture");
      if (!adapter.capture)
        throw new MediaCapabilityError("The host did not provide capture().");
      return adapter.capture(options);
    },
    pick: async (options) => {
      requireCapability(options.kind, "pick");
      if (!adapter.pick)
        throw new MediaCapabilityError("The host did not provide pick().");
      return adapter.pick(options);
    },
    ...createMediaSelectionMethods(adapter),
    startRecording: async () => {
      requireCapability("microphone", "capture");
      if (!adapter.startRecording)
        throw new MediaCapabilityError(
          "The host did not provide lifecycle audio recording.",
        );
      return adapter.startRecording();
    },
    stopRecording: async () => {
      requireCapability("microphone", "capture");
      if (!adapter.stopRecording)
        throw new MediaCapabilityError(
          "The host did not provide lifecycle audio recording.",
        );
      return adapter.stopRecording();
    },
    ...createMediaTransferMethods(adapter),
  };
}
