import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "@lynx-js/react";
import type { TFunction } from "i18next";
import type {
  LynxI18nextAdapter,
  LynxI18nextSnapshot,
} from "../i18next/contracts.js";

interface LynxI18nextContextValue {
  readonly adapter: LynxI18nextAdapter;
}

export interface LynxI18nextProviderProps {
  readonly adapter: LynxI18nextAdapter;
  readonly children?: ReactNode;
}

export interface LynxI18nextHookResult {
  readonly adapter: LynxI18nextAdapter;
  readonly snapshot: LynxI18nextSnapshot;
  readonly t: TFunction;
  readonly ready: boolean;
  readonly locale?: string;
  readonly direction: "ltr" | "rtl";
}

const LynxI18nextContext = createContext<LynxI18nextContextValue | null>(null);

export function LynxI18nextProvider({
  adapter,
  children,
}: LynxI18nextProviderProps): ReactElement {
  return createElement(
    LynxI18nextContext.Provider,
    { value: { adapter } },
    children,
  );
}

export function useLynxI18next(
  namespace?: string | readonly string[],
): LynxI18nextHookResult {
  const context = useContext(LynxI18nextContext);
  if (!context) {
    throw new Error("useLynxI18next must be used inside LynxI18nextProvider");
  }

  const { adapter } = context;
  const [snapshot, setSnapshot] = useState(adapter.snapshot());
  useEffect(() => {
    "background only";
    return adapter.subscribe(() => setSnapshot(adapter.snapshot()));
  }, [adapter]);

  const namespaceKey = Array.isArray(namespace)
    ? namespace.join("\u0000")
    : namespace;
  const t = useMemo(
    () =>
      namespace === undefined
        ? adapter.t
        : adapter.instance.getFixedT(null, namespace),
    [adapter, namespaceKey],
  );
  return {
    adapter,
    snapshot,
    t,
    ready: snapshot.status === "ready",
    ...((snapshot.resolvedLanguage ?? snapshot.language)
      ? { locale: snapshot.resolvedLanguage ?? snapshot.language }
      : {}),
    direction: snapshot.direction,
  };
}
