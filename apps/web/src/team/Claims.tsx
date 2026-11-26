// A claim anywhere on the squad page (a concept's topics, a module's claim IDs, placements, the
// claims trace, results by claim) opens a small card with what the claims library holds for it:
// its approved text, status, scope, label version, expiry, references and the disclosures it
// requires. The details come from the run's own get_claims_library reads, so they match what the
// agents saw; a claim no agent has read yet shows the library's record.
import { CLAIM_RECORDS, type LibraryClaim } from "@northstar/architecture";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import type { TeamState } from "./team-state";

export type ClaimInfo = Partial<LibraryClaim> & {
  topic: string;
  claimId: string | null;
  /** What kind of statement it is, from the library's record. */
  type?: string;
};

export type ClaimIndex = ReadonlyMap<string, ClaimInfo>;

function fromRecords(): Map<string, ClaimInfo> {
  const index = new Map<string, ClaimInfo>();
  for (const [topic, record] of Object.entries(CLAIM_RECORDS)) {
    const info: ClaimInfo = {
      topic,
      claimId: record.claimId,
      type: record.type,
      context: record.context,
      labelVersion: record.labelVersion,
      expiresOn: record.expiresOn,
      mustNotAppearWith: record.mustNotAppearWith,
      scope: {
        audiences: record.audiences,
        markets: record.markets,
        channels: record.channels,
        indication: record.indication,
      },
      references: record.anchors.map((item) => ({
        source: item.reference,
        asOf: "",
        expiresOn: "",
        anchor: item.anchor,
      })),
    };
    index.set(topic, info);
    index.set(record.claimId, info);
  }
  return index;
}

/**
 * The claims in a get_claims_library result. Tool outputs are recorded cut at a few thousand
 * characters, so a long library arrives as truncated JSON: every claim object that is complete is
 * read, and the rest fall back to the library's records.
 */
export function claimsIn(output: unknown): LibraryClaim[] {
  if (output && typeof output === "object") {
    const claims = (output as { claims?: unknown }).claims;
    return Array.isArray(claims) ? (claims as LibraryClaim[]) : [];
  }
  if (typeof output !== "string") return [];
  try {
    return claimsIn(JSON.parse(output));
  } catch {
    // Truncated: read the complete objects in the claims array, one by one.
  }
  const start = output.indexOf('"claims":[');
  if (start < 0) return [];
  const claims: LibraryClaim[] = [];
  let depth = 0;
  let from = -1;
  let inString = false;
  let escaped = false;
  for (let index = start + '"claims":['.length; index < output.length; index += 1) {
    const char = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) from = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && from >= 0) {
        try {
          claims.push(JSON.parse(output.slice(from, index + 1)) as LibraryClaim);
        } catch {
          // Skip an object that doesn't parse.
        }
      }
    } else if (char === "]" && depth === 0) break;
  }
  return claims;
}

/** Every claim the run's agents read, by topic and by claim ID, over the library's records. */
export function claimIndex(state: Pick<TeamState, "agents">): ClaimIndex {
  const index = fromRecords();
  for (const view of Object.values(state.agents))
    for (const step of view.tools) {
      if (step.tool !== "get_claims_library" || !step.ok) continue;
      for (const claim of claimsIn(step.output)) {
        const info: ClaimInfo = {
          ...(index.get(claim.topic) ?? {}),
          ...claim,
          type: CLAIM_RECORDS[claim.topic]?.type,
        };
        index.set(claim.topic, info);
        if (claim.claimId) index.set(claim.claimId, info);
      }
    }
  return index;
}

const ClaimsContext = createContext<ClaimIndex>(fromRecords());
export const ClaimsProvider = ClaimsContext.Provider;

const referenceText = (reference: NonNullable<ClaimInfo["references"]>[number]) =>
  `${reference.source}${reference.anchor ? `, ${reference.anchor}` : ""}${
    reference.expiresOn ? ` (until ${reference.expiresOn})` : ""
  }`;

/** A claim's topic or ID. Click it (or press Enter) for the library's details; Escape closes. */
export function Claim({ id, label }: { id: string; label?: string }) {
  const claim = useContext(ClaimsContext).get(id);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);
  if (!claim) return <code>{label ?? id}</code>;
  const status = claim.status
    ? `${claim.status} · ${claim.usable ? "usable in this campaign" : "not usable here"}`
    : "Not read by an agent in this run yet";
  return (
    <span className="team-claim" ref={box}>
      <button
        type="button"
        className={`team-claim-chip${claim.usable === false ? " unusable" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        title="Show this claim's details"
        onClick={() => setOpen((value) => !value)}
      >
        {label ?? id}
      </button>
      {open && (
        <span
          id={panelId}
          className="team-claim-card"
          role="dialog"
          aria-label={`Claim ${claim.claimId ?? claim.topic}`}
        >
          <strong>
            {claim.claimId ?? "No library ID"} · <code>{claim.topic}</code>
          </strong>
          {claim.text ? <q>{claim.text}</q> : null}
          <span className="team-claim-status">
            {status}
            {claim.type ? ` · ${claim.type}` : ""}
          </span>
          {claim.issues?.length ? (
            <span className="team-claim-issues">{claim.issues.join(" ")}</span>
          ) : null}
          <dl>
            {claim.scope && (
              <>
                <dt>Scope</dt>
                <dd>
                  {[
                    claim.scope.audiences.join(", "),
                    claim.scope.markets.join(", "),
                    claim.scope.channels.join(", "),
                    claim.scope.indication,
                  ].join(" · ")}
                </dd>
              </>
            )}
            {claim.labelVersion && (
              <>
                <dt>Label</dt>
                <dd>
                  {claim.labelVersion}
                  {claim.expiresOn ? ` · claim expires ${claim.expiresOn}` : ""}
                </dd>
              </>
            )}
            {claim.references?.length ? (
              <>
                <dt>References</dt>
                <dd>{claim.references.map(referenceText).join("; ")}</dd>
              </>
            ) : null}
            {claim.requires?.length ? (
              <>
                <dt>Requires</dt>
                <dd>{claim.requires.join(", ")}</dd>
              </>
            ) : null}
            {claim.mustNotAppearWith?.length ? (
              <>
                <dt>Never with</dt>
                <dd>{claim.mustNotAppearWith.join(", ")}</dd>
              </>
            ) : null}
            {claim.context && (
              <>
                <dt>Context</dt>
                <dd>{claim.context}</dd>
              </>
            )}
          </dl>
        </span>
      )}
    </span>
  );
}
