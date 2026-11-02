import {
  BRANDS,
  type Brand,
  PERSONA_LABELS,
  PERSONAS,
  type Persona,
} from "@northstar/architecture";
import { useEffect, useState } from "react";
import { useScope } from "./scope";

/**
 * The brand and role every page, chat message and tool call follows. Choosing a brand also
 * withholds the other brands' tools from the model, and the role sets the emphasis of its answers
 * and which decisions the Architecture workspaces offer. Neither changes what Salesforce allows.
 */
export function ScopeBar() {
  const { scope, setBrand, setPersona } = useScope();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    fetch("/api/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((session: { principal?: { role?: string } } | null) =>
        setAdmin(session?.principal?.role === "demo-admin"),
      )
      .catch(() => setAdmin(false));
  }, []);
  // A role the signed-in person may not take is dropped back to the default.
  useEffect(() => {
    if (scope.persona === "admin" && !admin) setPersona("marketer");
  }, [admin, scope.persona, setPersona]);
  return (
    <fieldset className="scope-bar">
      <legend className="sr-only">Brand and role</legend>
      <label>
        <span>Brand</span>
        <select
          value={scope.brand}
          onChange={(event) => setBrand(event.target.value as Brand | "all")}
        >
          <option value="all">All brands</option>
          {BRANDS.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Run as</span>
        <select
          value={scope.persona}
          onChange={(event) => setPersona(event.target.value as Persona)}
        >
          {PERSONAS.filter((persona) => persona !== "admin" || admin).map((persona) => (
            <option key={persona} value={persona}>
              {PERSONA_LABELS[persona]}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
