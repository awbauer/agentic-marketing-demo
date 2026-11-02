// A workspace is a manifest: the roles, objects, tiles, agents and services it composes. One
// renderer resolves any manifest against the world, so the next workspace is data, not a new screen.
import { checkReadiness, claimPacket, performance } from "./agents.ts";
import { dataReadiness, farmBlockers, runFarm } from "./farm.ts";
import { STAGE_LABELS, STAGE_OWNERS, STAGES, type Stage } from "./registry.ts";
import {
  allowedTransitions,
  PERSONA_LABELS,
  PERSONAS,
  type Persona,
  TRANSITIONS,
} from "./state-machine.ts";
import {
  type ApprovalState,
  attributesOf,
  type Brand,
  type GovernedObject,
  type ObjectKind,
  type ResultAttributes,
} from "./types.ts";
import { listObjects, refreshReasons, type World } from "./world.ts";

export type TileSpec = {
  id: string;
  title: string;
  type: "stage-board" | "object-table" | "metrics" | "stage-readiness";
  kinds?: readonly ObjectKind[];
  states?: readonly ApprovalState[];
};

export type WorkspaceManifest = {
  id: string;
  title: string;
  summary: string;
  personas: readonly Persona[];
  objectKinds: readonly ObjectKind[];
  tiles: readonly TileSpec[];
  agents: readonly string[];
  services: readonly string[];
};

export const WORKSPACES: readonly WorkspaceManifest[] = [
  {
    id: "command-center",
    title: "Command Center",
    summary: "Every governed object by stage, with the next human decision waiting on it.",
    personas: PERSONAS,
    objectKinds: ["content-plan", "brief", "module", "claim", "result", "gap"],
    tiles: [
      { id: "counts", title: "At a glance", type: "metrics" },
      { id: "board", title: "The lifecycle", type: "stage-board" },
      { id: "readiness", title: "Data readiness by stage", type: "stage-readiness" },
    ],
    agents: ["data-readiness"],
    services: ["governance-api", "claims"],
  },
  {
    id: "brief-builder",
    title: "Brief Builder",
    summary: "Plans and the briefs that inherit them.",
    personas: ["brand-planner", "marketer", "admin"],
    objectKinds: ["content-plan", "brief"],
    tiles: [
      { id: "plans", title: "Content plans", type: "object-table", kinds: ["content-plan"] },
      { id: "briefs", title: "Briefs", type: "object-table", kinds: ["brief"] },
    ],
    agents: ["content-plan", "scenario", "brief"],
    services: ["workflow"],
  },
  {
    id: "module-library",
    title: "Module Library",
    summary: "Modules and variants, with claims, refresh flags and gaps.",
    personas: ["marketer", "content-lab", "compliance", "admin"],
    objectKinds: ["module", "gap"],
    tiles: [
      { id: "modules", title: "Modules", type: "object-table", kinds: ["module"] },
      { id: "gaps", title: "Gap records", type: "object-table", kinds: ["gap"] },
    ],
    agents: ["reuse", "module-authoring", "atomization"],
    services: ["content", "claims"],
  },
  {
    id: "approvals",
    title: "Approvals",
    summary: "The queue for reviewers: what is waiting, and the transitions you may take.",
    personas: ["reviewer", "senior", "compliance", "admin"],
    objectKinds: ["module", "claim", "content-plan", "brief"],
    tiles: [
      {
        id: "queue",
        title: "Waiting for a decision",
        type: "object-table",
        states: ["draft", "submitted", "in_review", "changes_requested", "escalated"],
      },
      {
        id: "decided",
        title: "Decided",
        type: "object-table",
        states: ["approved", "rejected", "expired", "withdrawn"],
      },
    ],
    agents: ["substantiation", "readiness", "adversarial-farm"],
    services: ["governance-api", "audit"],
  },
  {
    id: "performance",
    title: "Performance Dashboard",
    summary: "Results by module and claim, and the plan changes they cause.",
    personas: ["brand-lead", "brand-planner", "admin"],
    objectKinds: ["result", "module"],
    tiles: [
      { id: "results", title: "Results", type: "object-table", kinds: ["result"] },
      { id: "perf-counts", title: "At a glance", type: "metrics" },
    ],
    agents: ["attribution", "optimization"],
    services: ["attribution"],
  },
];

export const workspaceById = (id: string) => WORKSPACES.find((workspace) => workspace.id === id);

export type WorkspaceContext = { persona: Persona; brand?: Brand | undefined };

export type Row = {
  urn: string;
  kind: ObjectKind;
  title: string;
  brand: Brand;
  state: ApprovalState;
  owner: string;
  updatedAt: string;
  version: number;
  stage: Stage;
  flags: string[];
  /** Transitions the viewer's persona may take now. */
  allowed: ApprovalState[];
  /** Who holds the next decision, whoever the viewer is. */
  waitingOn: string | null;
};

export type ResolvedTile =
  | {
      id: string;
      title: string;
      type: "metrics";
      metrics: Array<{ label: string; value: string; detail?: string }>;
    }
  | { id: string; title: string; type: "object-table"; rows: Row[]; empty: string }
  | {
      id: string;
      title: string;
      type: "stage-board";
      stages: Array<{ stage: Stage; label: string; owner: string; rows: Row[] }>;
    }
  | {
      id: string;
      title: string;
      type: "stage-readiness";
      stages: ReturnType<typeof dataReadiness>;
    };

export function stageOf(object: GovernedObject): Stage {
  switch (object.kind) {
    case "content-plan":
      return "plan";
    case "brief":
      return "brief";
    case "module":
      return ["submitted", "in_review", "escalated", "changes_requested"].includes(
        object.approvalState,
      )
        ? "approve"
        : "create";
    case "gap":
      return "create";
    case "result":
      return "deploy";
    default:
      return "substantiate";
  }
}

/** The person whose decision this object is waiting on, if it is waiting. */
function waitingOn(object: GovernedObject): string | null {
  const next = TRANSITIONS.filter(
    (item) =>
      (item.from === object.approvalState && !item.actors.includes("system")) ||
      (item.from === object.approvalState && item.actors.includes("admin")),
  );
  const first = next[0];
  if (!first) return null;
  const actor = first.actors[0];
  if (actor === "author") return PERSONA_LABELS[STAGE_OWNERS[stageOf(object)]];
  if (actor === "reviewer") return PERSONA_LABELS.reviewer;
  if (actor === "senior") return PERSONA_LABELS.senior;
  return PERSONA_LABELS.admin;
}

export function toRow(world: World, object: GovernedObject, persona: Persona): Row {
  const flags: string[] = [];
  if (object.kind === "module") {
    if (refreshReasons(world, object.urn).length) flags.push("needs refresh");
    if (object.approvalState !== "approved") {
      const readiness = checkReadiness(world, object.urn, {
        farmBlockers: farmBlockers(runFarm(world, object.urn)),
      });
      if (!readiness.ready)
        flags.push(
          `${readiness.blockers.length} blocker${readiness.blockers.length === 1 ? "" : "s"}`,
        );
    }
  }
  if (object.kind === "claim") {
    const status = claimPacket(world, object).status;
    if (status !== "substantiated" && object.approvalState === "approved")
      flags.push(status.replace("-", " "));
  }
  if (object.kind === "result") {
    const result = performance(world).find((item) => item.result.urn === object.urn);
    if (result) flags.push(`${result.index.toFixed(2)}× baseline`);
  }
  if (object.kind === "gap") flags.push("open gap");
  return {
    urn: object.urn,
    kind: object.kind,
    title: object.title,
    brand: object.brand,
    state: object.approvalState,
    owner: object.owner,
    updatedAt: object.updatedAt,
    version: object.version,
    stage: stageOf(object),
    flags,
    allowed: allowedTransitions(object.approvalState, persona),
    waitingOn: waitingOn(object),
  };
}

export function resolveWorkspace(
  manifest: WorkspaceManifest,
  world: World,
  context: WorkspaceContext,
) {
  const objects = (kinds: readonly ObjectKind[], states?: readonly ApprovalState[]) =>
    kinds
      .flatMap((kind) =>
        listObjects(world, { kind, ...(context.brand ? { brand: context.brand } : {}) }),
      )
      .filter((object) => !states || states.includes(object.approvalState))
      .map((object) => toRow(world, object, context.persona))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  const scoped = objects(manifest.objectKinds);
  const tiles: ResolvedTile[] = manifest.tiles.map((tile): ResolvedTile => {
    if (tile.type === "object-table") {
      const rows = objects(tile.kinds ?? manifest.objectKinds, tile.states);
      return { id: tile.id, title: tile.title, type: "object-table", rows, empty: "Nothing here." };
    }
    if (tile.type === "stage-board")
      return {
        id: tile.id,
        title: tile.title,
        type: "stage-board",
        stages: STAGES.map((stage) => ({
          stage,
          label: STAGE_LABELS[stage],
          owner: PERSONA_LABELS[STAGE_OWNERS[stage]],
          rows: scoped.filter((row) => row.stage === stage),
        })),
      };
    if (tile.type === "stage-readiness")
      return {
        id: tile.id,
        title: tile.title,
        type: "stage-readiness",
        stages: dataReadiness(world, context.brand ?? "Harborstone Wealth"),
      };
    const waiting = scoped.filter((row) => row.allowed.length > 0 && row.waitingOn).length;
    const results = listObjects(world, {
      kind: "result",
      ...(context.brand ? { brand: context.brand } : {}),
    });
    const clicks = results.reduce(
      (sum, item) => sum + attributesOf<ResultAttributes>(item).clicks,
      0,
    );
    return {
      id: tile.id,
      title: tile.title,
      type: "metrics",
      metrics: [
        { label: "Objects", value: String(scoped.length), detail: manifest.objectKinds.join(", ") },
        {
          label: "Approved",
          value: String(scoped.filter((row) => row.state === "approved").length),
        },
        {
          label: "Waiting on you",
          value: String(waiting),
          detail: `As ${PERSONA_LABELS[context.persona]}`,
        },
        {
          label: "Flagged",
          value: String(scoped.filter((row) => row.flags.length > 0).length),
          detail: "Refresh, blockers or open gaps",
        },
        { label: "Clicks recorded", value: String(clicks) },
      ],
    };
  });
  return { manifest, persona: context.persona, brand: context.brand ?? null, tiles };
}
