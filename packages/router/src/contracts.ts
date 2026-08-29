export interface Route {
  readonly name: string;
  readonly pattern: string;
}

export interface RouteMatch {
  readonly route: Route;
  readonly params: Readonly<Record<string, string>>;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
}

export interface Router {
  add(route: Route): void;
  resolve(url: string): RouteMatch | undefined;
  current(): RouteMatch | undefined;
  push(url: string): RouteMatch | undefined;
  back(): RouteMatch | undefined;
  subscribe(listener: (match: RouteMatch | undefined) => void): () => void;
}

export class RouterError extends Error {
  public readonly code = "INVALID_ROUTE_PATTERN";

  public constructor(message: string) {
    super(message);
    this.name = "RouterError";
  }
}
