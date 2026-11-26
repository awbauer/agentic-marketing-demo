// Every source ID the squad's agents cite (segments, competitors, signals, past results, images,
// evidence, disclosures, modules and claims) opens a card with what it is. The details come first
// from what the run's own tools returned, so they match what the agents saw, then from the demo's
// seed data for an ID no tool in this run returned. Claims keep their own card (Claims.tsx).
import {
  ASSET_LIBRARY,
  type GovernedObject,
  SEED_OBJECTS,
  TEAM_MARKETS,
} from "@northstar/architecture";
import { createContext, useContext } from "react";
import { Claim, useClaims } from "./Claims";
import { IdCard } from "./IdCard";
import type { TeamState } from "./team-state";

export type SourceInfo = {
  id: string;
  /** What kind of thing it is: "Segment", "Competitor", "Image", … */
  kind: string;
  title: string;
  fields: Array<[string, string]>;
  /** Where the details came from: a tool this run called, or the demo's data. */
  from: string;
  /** It can't be used here (an unapproved or out-of-rights image, say). */
  warn?: boolean;
};

export type SourceIndex = ReadonlyMap<string, SourceInfo>;

/** A data ID as the agents write it: brand prefix, kind, name. */
export const SOURCE_ID = /^(?:lt|ck|hs)-[a-z]+-[a-z0-9-]+$/;
const ID_KEYS = ["id", "assetId", "segmentId", "competitorId", "signalId", "resultId"];

const KINDS: Record<string, string> = {
  seg: "Segment",
  sig: "Market signal",
  comp: "Competitor",
  result: "Past result",
  img: "Image",
  disc: "Disclosure",
  ev: "Evidence",
  mod: "Module",
  claim: "Claim",
};
const kindOf = (id: string) => KINDS[id.split("-")[1] ?? ""] ?? "Source";

/** Field names as words: "shareOfVoice" and "share_of_voice" read as "Share of voice". */
const words = (key: string) => {
  const text = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const show = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number")
    return Number.isInteger(value) ? value.toLocaleString("en-US") : String(value);
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value.map(show).filter((item): item is string => item !== null);
    return items.length ? items.join(", ") : null;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const text = show(item);
        return text === null ? null : `${words(key)}: ${text}`;
      })
      .filter((item): item is string => item !== null);
    return entries.length ? entries.join(" · ") : null;
  }
  return null;
};

const TITLE_KEYS = ["name", "title", "signal", "label", "text", "summary", "headline"];

function fromObject(id: string, value: Record<string, unknown>, from: string): SourceInfo {
  const titleKey = TITLE_KEYS.find((key) => typeof value[key] === "string" && value[key]);
  const fields: Array<[string, string]> = [];
  for (const [key, item] of Object.entries(value)) {
    if (ID_KEYS.includes(key) || key === titleKey || key === "palette" || key === "image") continue;
    const text = show(item);
    if (text !== null) fields.push([words(key), text]);
  }
  const usable = value.usable;
  return {
    id,
    kind: kindOf(id),
    title: titleKey ? String(value[titleKey]) : id,
    fields,
    from,
    ...(usable === false ? { warn: true } : {}),
  };
}

/** Every JSON object in a tool's output, even one recorded cut short. */
export function objectsIn(output: unknown): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      found.push(value as Record<string, unknown>);
      Object.values(value).forEach(walk);
    }
  };
  if (typeof output !== "string") {
    walk(output);
    return found;
  }
  try {
    walk(JSON.parse(output));
    return found;
  } catch {
    // Truncated: read every complete object, at any depth.
  }
  for (let start = output.indexOf("{"); start >= 0; start = output.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < output.length; index += 1) {
      const char = output[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            found.push(JSON.parse(output.slice(start, index + 1)) as Record<string, unknown>);
          } catch {
            // Not an object after all.
          }
          break;
        }
      }
    }
  }
  return found;
}

const idOf = (value: Record<string, unknown>) => {
  for (const key of ID_KEYS) {
    const id = value[key];
    if (typeof id === "string" && SOURCE_ID.test(id.replace(/‑/g, "-")))
      return id.replace(/‑/g, "-");
  }
  return null;
};

const objectId = (object: GovernedObject) => object.urn.split(":").at(-1) ?? object.urn;

/** The demo's own records for every source ID, before any run reads them. */
function fromSeed(): Map<string, SourceInfo> {
  const index = new Map<string, SourceInfo>();
  for (const [brand, market] of Object.entries(TEAM_MARKETS))
    for (const item of [...market.segments, ...market.competitors, ...market.signals])
      index.set(
        item.id,
        fromObject(item.id, item as Record<string, unknown>, `${brand} market data`),
      );
  for (const asset of ASSET_LIBRARY)
    index.set(asset.id, {
      ...fromObject(
        asset.id,
        asset as unknown as Record<string, unknown>,
        `${asset.source} library`,
      ),
      warn: asset.approval.status !== "Approved",
    });
  for (const object of SEED_OBJECTS) {
    const id = objectId(object);
    if (index.has(id)) continue;
    const info = fromObject(
      id,
      {
        ...(object.attributes as Record<string, unknown>),
        approval: object.approvalState,
      },
      `${object.brand ?? "workspace"} governed object`,
    );
    index.set(id, { ...info, kind: words(object.kind) });
  }
  return index;
}

const SEED = fromSeed();

/** Every source ID on the page: what this run's tools returned, over the demo's seed data. */
export function sourceIndex(state: Pick<TeamState, "agents">): SourceIndex {
  const index = new Map(SEED);
  for (const view of Object.values(state.agents))
    for (const step of view.tools) {
      if (!step.ok || step.output === undefined) continue;
      for (const object of objectsIn(step.output)) {
        const id = idOf(object);
        if (!id) continue;
        const seed = SEED.get(id);
        const info = fromObject(id, object, `${step.tool} in this run`);
        index.set(id, seed && info.fields.length < seed.fields.length ? seed : info);
      }
    }
  return index;
}

const SourcesContext = createContext<SourceIndex>(SEED);
export const SourcesProvider = SourcesContext.Provider;

/**
 * A source ID the agents cited. Click or tap it for what it is. A claim opens the claim card; an
 * ID the page knows nothing about stays plain text.
 */
export function SourceId({ id }: { id: string }) {
  const plain = id.replace(/‑/g, "-");
  const claims = useClaims();
  const info = useContext(SourcesContext).get(plain);
  // A claim's ID or topic opens the claim card, with its approved text and scope.
  if (claims.has(plain)) return <Claim id={plain} />;
  if (!info) return <code>{id}</code>;
  return (
    <IdCard
      label={id}
      cardLabel={`${info.kind} ${info.id}`}
      hint={`Show this ${info.kind.toLowerCase()}'s details`}
      tone={info.warn ? "warn" : undefined}
    >
      <strong>
        {info.title} · <code>{info.id}</code>
      </strong>
      <span className="team-claim-status">
        {info.kind} · from {info.from}
      </span>
      {info.fields.length > 0 && (
        <dl>
          {info.fields.map(([label, value]) => (
            <SourceField key={label} label={label} value={value} />
          ))}
        </dl>
      )}
    </IdCard>
  );
}

function SourceField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
