import { BridgeError } from "./errors.js";
import {
  createTypedBridge,
  type TypedBridgeClient,
  type TypedBridgeDefinitions,
  type TypedBridgeEventDefinitions,
  type TypedBridgeEventMap,
  type TypedBridgeMap,
} from "./typed.js";
import type { BridgeClient } from "./contracts.js";

export interface TypedBridgeMethodPackage<
  M extends TypedBridgeMap,
  E extends TypedBridgeEventMap = TypedBridgeEventMap,
> {
  readonly name: string;
  readonly definitions: TypedBridgeDefinitions<M>;
  readonly events?: TypedBridgeEventDefinitions<E>;
  create(client: BridgeClient): TypedBridgeClient<M, E>;
}

/**
 * Defines a reusable native-method package without creating a global bridge.
 * A package is only a typed view over the host's already allow-listed client.
 */
export function defineTypedBridgePackage<
  M extends TypedBridgeMap,
  E extends TypedBridgeEventMap = TypedBridgeEventMap,
>(
  name: string,
  definitions: TypedBridgeDefinitions<M>,
  options: { readonly events?: TypedBridgeEventDefinitions<E> } = {},
): TypedBridgeMethodPackage<M, E> {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(name))
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge method package names must be lowercase identifiers.",
      { name },
    );
  for (const [key, definition] of Object.entries(definitions))
    if (definition.descriptor.name !== key)
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "A bridge package definition key must match its method name.",
        { package: name, method: key },
      );
  return Object.freeze({
    name,
    definitions,
    ...(options.events ? { events: options.events } : {}),
    create(client: BridgeClient) {
      return createTypedBridge(client, definitions, options);
    },
  });
}
