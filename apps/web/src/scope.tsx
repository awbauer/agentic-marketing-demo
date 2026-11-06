import {
  BRAND_PLACEHOLDER,
  type Brand,
  DEFAULT_SCOPE,
  type Persona,
  parseScope,
  type WorkbenchScope,
} from "@northstar/architecture";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export { BRAND_PLACEHOLDER };

const KEY = "northstar.scope";

/** The brand graph node for each brand, so the graph explorer can follow the header. */
export const BRAND_NODE_IDS: Record<Brand, string> = {
  "Coastline Kitchen": "brand-coastline-kitchen",
  "Harborstone Wealth": "brand-harborstone",
  "Lumera Therapeutics": "brand-lumera",
};
export const brandForNode = (nodeId: string | null): Brand | "all" =>
  (Object.entries(BRAND_NODE_IDS).find(([, id]) => id === nodeId)?.[0] as Brand | undefined) ??
  "all";

/** A starting image concept for the chosen brand; the box stays editable. */
export const BRAND_IMAGE_CONCEPT: Record<Brand | "all", string> = {
  all: "A quiet trailhead at golden hour with layered hiking gear and room for campaign copy",
  "Coastline Kitchen":
    "A steaming bowl of clam chowder on a rainy window table with room for campaign copy",
  "Harborstone Wealth":
    "A calm morning desk with a notebook and a coffee, soft light, room for campaign copy",
  "Lumera Therapeutics":
    "A clinician-education scene: a cardiologist reviewing a chart with a colleague, no patient imagery, room for campaign copy",
};

function load(): WorkbenchScope {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored ? parseScope(JSON.parse(stored)) : DEFAULT_SCOPE;
  } catch {
    return DEFAULT_SCOPE;
  }
}

type ScopeContextValue = {
  scope: WorkbenchScope;
  setBrand: (brand: Brand | "all") => void;
  setPersona: (persona: Persona) => void;
};
const ScopeContext = createContext<ScopeContextValue>({
  scope: DEFAULT_SCOPE,
  setBrand: () => undefined,
  setPersona: () => undefined,
});

/** The brand and role chosen in the header. Every page and every chat message reads from here. */
export function ScopeProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: WorkbenchScope;
}) {
  const [scope, setScope] = useState<WorkbenchScope>(() => initial ?? load());
  const update = useCallback((next: WorkbenchScope) => {
    setScope(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private windows and blocked storage just don't remember the choice.
    }
  }, []);
  const value = useMemo<ScopeContextValue>(
    () => ({
      scope,
      setBrand: (brand) => update({ ...scope, brand }),
      setPersona: (persona) => update({ ...scope, persona }),
    }),
    [scope, update],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export const useScope = () => useContext(ScopeContext);
