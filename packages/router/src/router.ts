import type { Route, RouteMatch, Router } from "./contracts.js";
import { matchRoute, validateRoute } from "./matcher.js";

export function createRouter(routes: readonly Route[] = []): Router {
  for (const route of routes) {
    validateRoute(route);
    matchRoute(route, "/");
  }
  const registered = [...routes];
  const history: RouteMatch[] = [];
  const listeners = new Set<(match: RouteMatch | undefined) => void>();
  const resolve = (url: string) =>
    registered
      .map((route) => matchRoute(route, url))
      .find((match): match is RouteMatch => Boolean(match));
  const notify = () =>
    listeners.forEach((listener) => listener(history.at(-1)));
  return {
    add: (route) => {
      validateRoute(route);
      matchRoute(route, "/");
      registered.push(route);
    },
    resolve,
    current: () => history.at(-1),
    push: (url) => {
      const match = resolve(url);
      if (match) {
        history.push(match);
        notify();
      }
      return match;
    },
    back: () => {
      history.pop();
      notify();
      return history.at(-1);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
