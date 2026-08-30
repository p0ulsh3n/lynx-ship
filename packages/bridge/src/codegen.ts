import type { BridgeMethod, BridgeValue } from "./contracts.js";
import { validateEvent, validateMethod } from "./validation.js";
import { BridgeError } from "./errors.js";

export const LYNXSHIP_BRIDGE_IDL_VERSION = 1 as const;

export type BridgeSchema =
  | {
      readonly type: "string";
      readonly enum?: readonly string[];
      readonly minLength?: number;
      readonly maxLength?: number;
    }
  | {
      readonly type: "number";
      readonly integer?: boolean;
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | { readonly type: "boolean" }
  | { readonly type: "null" }
  | {
      readonly type: "array";
      readonly items: BridgeSchema;
      readonly minItems?: number;
      readonly maxItems?: number;
    }
  | {
      readonly type: "object";
      readonly properties: Readonly<Record<string, BridgeSchema>>;
      readonly required?: readonly string[];
      readonly additionalProperties?: boolean;
    }
  | { readonly type: "union"; readonly anyOf: readonly BridgeSchema[] };

type SchemaDepth = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type PreviousDepth = [0, 0, 1, 2, 3, 4, 5];

export type BridgeSchemaType<
  Schema extends BridgeSchema,
  Depth extends SchemaDepth = 6,
> = Depth extends 0
  ? BridgeValue
  : Schema extends { readonly type: "string" }
    ? string
    : Schema extends { readonly type: "number" }
      ? number
      : Schema extends { readonly type: "boolean" }
        ? boolean
        : Schema extends { readonly type: "null" }
          ? null
          : Schema extends {
                readonly type: "array";
                readonly items: infer Item extends BridgeSchema;
              }
            ? readonly BridgeSchemaType<Item, PreviousDepth[Depth]>[]
            : Schema extends {
                  readonly type: "object";
                  readonly properties: infer Properties extends Record<
                    string,
                    BridgeSchema
                  >;
                  readonly required?: infer Required extends readonly string[];
                }
              ? ObjectSchemaType<
                  Properties,
                  Required[number],
                  PreviousDepth[Depth]
                >
              : Schema extends {
                    readonly type: "union";
                    readonly anyOf: readonly (infer Item extends
                      BridgeSchema)[];
                  }
                ? BridgeSchemaType<Item, PreviousDepth[Depth]>
                : BridgeValue;

type ObjectSchemaType<
  Properties extends Record<string, BridgeSchema>,
  Required extends string,
  Depth extends SchemaDepth,
> = Partial<{
  readonly [Key in keyof Properties]: BridgeSchemaType<Properties[Key], Depth>;
}> &
  RequiredProperties<Properties, Required, Depth>;

type RequiredProperties<
  Properties extends Record<string, BridgeSchema>,
  Required extends string,
  Depth extends SchemaDepth,
> = {
  readonly [Key in Required & keyof Properties]: BridgeSchemaType<
    Properties[Key],
    Depth
  >;
};

export interface BridgeIdlMethod {
  readonly descriptor: BridgeMethod;
  readonly params: BridgeSchema;
  readonly result: BridgeSchema;
}

export interface BridgeIdlEvent {
  readonly name: string;
  readonly payload: BridgeSchema;
}

export interface BridgeIdlDocument {
  readonly version: typeof LYNXSHIP_BRIDGE_IDL_VERSION;
  readonly methods: readonly BridgeIdlMethod[];
  readonly events?: readonly BridgeIdlEvent[];
}

export interface GeneratedBridgeArtifacts {
  readonly manifest: readonly BridgeMethod[];
  readonly source: string;
}

/** Validates a bridge IDL before it can generate a native-facing contract. */
export function validateBridgeIdl(document: BridgeIdlDocument): void {
  if (!document || document.version !== LYNXSHIP_BRIDGE_IDL_VERSION)
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Unsupported LynxShip bridge IDL version.",
    );
  if (!Array.isArray(document.methods))
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge IDL methods must be an array.",
    );
  const methodNames = new Set<string>();
  for (const method of document.methods) {
    validateMethod(method.descriptor);
    if (methodNames.has(method.descriptor.name))
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "Bridge IDL method names must be unique.",
        { method: method.descriptor.name },
      );
    methodNames.add(method.descriptor.name);
    validateSchema(method.params, `methods.${method.descriptor.name}.params`);
    validateSchema(method.result, `methods.${method.descriptor.name}.result`);
  }
  if (document.events !== undefined) {
    if (!Array.isArray(document.events))
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "Bridge IDL events must be an array.",
      );
    const eventNames = new Set<string>();
    for (const event of document.events) {
      validateEvent(event.name);
      if (eventNames.has(event.name))
        throw new BridgeError(
          "BRIDGE_INVALID_CONTRACT",
          "Bridge IDL event names must be unique.",
          { event: event.name },
        );
      eventNames.add(event.name);
      validateSchema(event.payload, `events.${event.name}.payload`);
    }
  }
}

/** Creates a bounded runtime guard for generated parameter/result validation. */
export function createSchemaGuard<Schema extends BridgeSchema>(
  schema: Schema,
): (value: BridgeValue) => value is BridgeSchemaType<Schema> {
  validateSchema(schema, "schema");
  return (value: BridgeValue): value is BridgeSchemaType<Schema> =>
    matchesSchema(schema, value);
}

/** Generates deterministic TypeScript for a typed method package. */
export function generateBridgeSource(
  document: BridgeIdlDocument,
  importPath = "@lynxship/bridge",
): GeneratedBridgeArtifacts {
  validateBridgeIdl(document);
  const methods = [...document.methods].sort((a, b) =>
    a.descriptor.name.localeCompare(b.descriptor.name),
  );
  const events = [...(document.events ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const methodSchemas = Object.fromEntries(
    methods.map((method) => [
      method.descriptor.name,
      {
        descriptor: method.descriptor,
        params: canonicalSchema(method.params),
        result: canonicalSchema(method.result),
      },
    ]),
  );
  const eventSchemas = Object.fromEntries(
    events.map((event) => [event.name, canonicalSchema(event.payload)]),
  );
  const methodTypes = methods
    .map(
      ({ descriptor }) =>
        `  ${JSON.stringify(descriptor.name)}: { params: BridgeSchemaType<typeof schemas.methods[${JSON.stringify(descriptor.name)}]["params"]>; result: BridgeSchemaType<typeof schemas.methods[${JSON.stringify(descriptor.name)}]["result"]> };`,
    )
    .join("\n");
  const eventTypes = events
    .map(
      ({ name }) =>
        `  ${JSON.stringify(name)}: { payload: BridgeSchemaType<typeof schemas.events[${JSON.stringify(name)}]> };`,
    )
    .join("\n");
  const eventDefinitions = events
    .map(
      ({ name }) =>
        `  ${JSON.stringify(name)}: { validatePayload: createSchemaGuard(schemas.events[${JSON.stringify(name)}]) },`,
    )
    .join("\n");
  const methodDefinitions = methods
    .map(
      ({ descriptor }) =>
        `  ${JSON.stringify(descriptor.name)}: defineTypedBridgeMethod({ descriptor: schemas.methods[${JSON.stringify(descriptor.name)}].descriptor, validateParams: createSchemaGuard(schemas.methods[${JSON.stringify(descriptor.name)}].params), validateResult: createSchemaGuard(schemas.methods[${JSON.stringify(descriptor.name)}].result) }),`,
    )
    .join("\n");
  const source = `// Generated by @lynxship/bridge. Do not edit by hand.\nimport { createSchemaGuard, createTypedBridge, defineTypedBridgeMethod, type BridgeClient, type BridgeSchemaType } from ${JSON.stringify(importPath)};\n\nexport const schemas = ${JSON.stringify({ methods: methodSchemas, events: eventSchemas }, null, 2)} as const;\nexport const methodManifest = Object.values(schemas.methods).map(({ descriptor }) => descriptor);\n\nexport interface Methods {\n${methodTypes}\n}\n\nexport interface Events {\n${eventTypes}\n}\n\nexport const definitions = {\n${methodDefinitions}\n} as const;\n\nexport const eventDefinitions = {\n${eventDefinitions}\n} as const;\n\nexport function createBridge(client: BridgeClient) {\n  return createTypedBridge<Methods, Events>(client, definitions, { events: eventDefinitions });\n}\n`;
  return {
    manifest: methods.map(({ descriptor }) => descriptor),
    source,
  };
}

function validateSchema(schema: BridgeSchema, path: string): void {
  if (!schema || typeof schema !== "object" || !("type" in schema))
    throw invalidSchema(path);
  switch (schema.type) {
    case "string":
      validateEnum(schema.enum, path);
      validateIntegerLimit(schema.minLength, path);
      validateIntegerLimit(schema.maxLength, path);
      if (
        schema.minLength !== undefined &&
        schema.maxLength !== undefined &&
        schema.minLength > schema.maxLength
      )
        throw invalidSchema(path);
      return;
    case "number":
      validateFiniteLimit(schema.minimum, path);
      validateFiniteLimit(schema.maximum, path);
      if (
        schema.minimum !== undefined &&
        schema.maximum !== undefined &&
        schema.minimum > schema.maximum
      )
        throw invalidSchema(path);
      return;
    case "boolean":
    case "null":
      return;
    case "array":
      validateIntegerLimit(schema.minItems, path);
      validateIntegerLimit(schema.maxItems, path);
      if (
        schema.minItems !== undefined &&
        schema.maxItems !== undefined &&
        schema.minItems > schema.maxItems
      )
        throw invalidSchema(path);
      validateSchema(schema.items, `${path}.items`);
      return;
    case "object": {
      const propertyNames = new Set(Object.keys(schema.properties));
      for (const name of propertyNames)
        if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(name))
          throw invalidSchema(`${path}.properties.${name}`);
      for (const name of schema.required ?? [])
        if (!propertyNames.has(name)) throw invalidSchema(`${path}.required`);
      for (const [name, child] of Object.entries(schema.properties))
        validateSchema(child, `${path}.properties.${name}`);
      return;
    }
    case "union":
      if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0)
        throw invalidSchema(path);
      schema.anyOf.forEach((child, index) =>
        validateSchema(child, `${path}.anyOf[${index}]`),
      );
      return;
    default:
      throw invalidSchema(path);
  }
}

function matchesSchema(schema: BridgeSchema, value: BridgeValue): boolean {
  switch (schema.type) {
    case "string":
      return (
        typeof value === "string" &&
        (schema.enum === undefined || schema.enum.includes(value)) &&
        (schema.minLength === undefined || value.length >= schema.minLength) &&
        (schema.maxLength === undefined || value.length <= schema.maxLength)
      );
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (schema.integer === undefined ||
          !schema.integer ||
          Number.isInteger(value)) &&
        (schema.minimum === undefined || value >= schema.minimum) &&
        (schema.maximum === undefined || value <= schema.maximum)
      );
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return (
        Array.isArray(value) &&
        (schema.minItems === undefined || value.length >= schema.minItems) &&
        (schema.maxItems === undefined || value.length <= schema.maxItems) &&
        value.every((item) => matchesSchema(schema.items, item))
      );
    case "object":
      if (value === null || Array.isArray(value) || typeof value !== "object")
        return false;
      for (const required of schema.required ?? [])
        if (!(required in value)) return false;
      for (const [key, item] of Object.entries(value)) {
        const property = schema.properties[key];
        if (!property) {
          if (schema.additionalProperties === false) return false;
        } else if (!matchesSchema(property, item)) return false;
      }
      return true;
    case "union":
      return schema.anyOf.some((child) => matchesSchema(child, value));
  }
}

function canonicalSchema(schema: BridgeSchema): BridgeSchema {
  switch (schema.type) {
    case "array":
      return { ...schema, items: canonicalSchema(schema.items) };
    case "object":
      return {
        ...schema,
        properties: Object.fromEntries(
          Object.entries(schema.properties)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [key, canonicalSchema(value)]),
        ),
        required: schema.required ? [...schema.required].sort() : undefined,
      };
    case "union":
      return { ...schema, anyOf: schema.anyOf.map(canonicalSchema) };
    default:
      return schema;
  }
}

function validateEnum(
  value: readonly string[] | undefined,
  path: string,
): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) ||
      value.length === 0 ||
      new Set(value).size !== value.length)
  )
    throw invalidSchema(path);
}

function validateIntegerLimit(value: number | undefined, path: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
    throw invalidSchema(path);
}

function validateFiniteLimit(value: number | undefined, path: string): void {
  if (value !== undefined && !Number.isFinite(value)) throw invalidSchema(path);
}

function invalidSchema(path: string): BridgeError {
  return new BridgeError("BRIDGE_INVALID_CONTRACT", "Invalid bridge schema.", {
    path,
  });
}
