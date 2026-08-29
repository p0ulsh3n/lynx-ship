import { RouterError, type Route, type RouteMatch } from "./contracts.js";

export function validateRoute(route: Route): void {
  if (typeof route !== "object" || route === null || Array.isArray(route))
    throw new RouterError("A route must be an object.");
  if (typeof route.name !== "string" || !route.name.trim())
    throw new RouterError("Route names must be non-empty strings.");
  if (route.name.length > 128)
    throw new RouterError("Route names must not exceed 128 characters.");
  if (typeof route.pattern !== "string" || !route.pattern.trim())
    throw new RouterError("Route patterns must be non-empty strings.");
  if (route.pattern.length > 2048)
    throw new RouterError("Route patterns must not exceed 2048 characters.");
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function compile(pattern: string): { regex: RegExp; names: string[] } {
  if (!pattern.startsWith("/"))
    throw new RouterError(`Route pattern must start with '/': ${pattern}`);
  if (pattern.includes("//"))
    throw new RouterError(
      `Route pattern cannot contain an empty segment: ${pattern}`,
    );
  const names: string[] = [];
  const expression = pattern
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      if (segment.startsWith(":")) {
        const name = segment.slice(1);
        if (!/^[$A-Z_a-z][$\w-]*$/.test(name))
          throw new RouterError(`Invalid route parameter: ${name}`);
        if (names.includes(name))
          throw new RouterError(`Duplicate route parameter: ${name}`);
        names.push(name);
        return "([^/]+)";
      }
      if (segment === "*") {
        if (names.includes("wildcard") || pattern.split("/").at(-1) !== "*")
          throw new RouterError(
            "A wildcard route parameter must be the final segment.",
          );
        names.push("wildcard");
        return "(.*)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${expression}/?$`), names };
}

export function matchRoute(
  route: Route,
  input: string,
): RouteMatch | undefined {
  validateRoute(route);
  if (typeof input !== "string")
    throw new RouterError("Route URLs must be strings.");
  let parsed: URL;
  try {
    parsed = new URL(input, "lynxship://router");
  } catch {
    throw new RouterError(`Invalid route URL: ${input}`);
  }
  const compiled = compile(route.pattern);
  const result = compiled.regex.exec(parsed.pathname);
  if (!result) return undefined;
  const params: Record<string, string> = {};
  compiled.names.forEach((name, index) => {
    params[name] = decode(result[index + 1] ?? "");
  });
  const query: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return { route, params, path: parsed.pathname, query };
}
