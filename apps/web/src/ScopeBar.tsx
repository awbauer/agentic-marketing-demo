import {
  BRANDS,
  type Brand,
  PERSONA_LABELS,
  PERSONAS,
  type Persona,
} from "@northstar/architecture";
import { isAiPlatformId } from "@northstar/contracts";
import { useEffect, useState } from "react";
import { useAiPlatform } from "./ai-platform";
import { useScope } from "./scope";

/**
 * The brand and role every page, chat message and tool call follows. Choosing a brand also
 * withholds the other brands' tools from the model, and the role sets the emphasis of its answers
 * and which decisions the Architecture workspaces offer. Neither changes what Salesforce allows.
 * The AI platform picks where the models run (ADR-021); the server lists only what it can reach.
 */
export function ScopeBar() {
  const { scope, setBrand, setPersona } = useScope();
  const ai = useAiPlatform();
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
      <legend className="sr-only">Brand, role and AI platform</legend>
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
      {ai.options && ai.options.platforms.length > 0 ? (
        <label>
          <span>AI platform</span>
          <select
            value={ai.platform ?? ""}
            disabled={ai.options.platforms.filter((platform) => platform.available).length < 2}
            title={ai.options.platforms
              .filter((platform) => !platform.available && platform.reason)
              .map((platform) => `${platform.label}: ${platform.reason}`)
              .join("\n")}
            onChange={(event) => {
              const next = event.target.value;
              if (isAiPlatformId(next)) ai.setPlatform(next);
            }}
          >
            {ai.options.platforms.map((platform) => (
              <option key={platform.id} value={platform.id} disabled={!platform.available}>
                {platform.available ? platform.label : `${platform.label} (not set up)`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </fieldset>
  );
}
