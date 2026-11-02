// One approval card, composed once and rendered into every surface. Brand rules are applied in the
// composition, so changing one rule changes React, Adaptive Card, LWC and MCP Apps renderings together.
import { checkReadiness } from "./agents.ts";
import { farmBlockers, runFarm } from "./farm.ts";
import { allowedTransitions, PERSONA_LABELS, type Persona } from "./state-machine.ts";
import type { ApprovalState, Brand, ModuleAttributes } from "./types.ts";
import { attributesOf } from "./types.ts";
import { getObject, refreshReasons, type World } from "./world.ts";

export type BrandRules = {
  accent: string;
  /** The label the card puts on required disclosures. */
  disclosureLabel: string;
  /** Bumped whenever a rule changes; every rendering shows it. */
  version: string;
};

/** Brand, market and regulatory rules, versioned by brand. */
export const BRAND_RULES: Record<Brand, BrandRules> = {
  "Harborstone Wealth": {
    accent: "#0b3d5c",
    disclosureLabel: "Required disclosures",
    version: "hs-2026.3",
  },
  "Coastline Kitchen": { accent: "#c2410c", disclosureLabel: "Notes", version: "ck-2026.1" },
};

export type ApprovalCard = {
  id: string;
  urn: string;
  title: string;
  subtitle: string;
  brand: Brand;
  state: ApprovalState;
  accent: string;
  rulesVersion: string;
  facts: Array<{ label: string; value: string }>;
  blockers: string[];
  actions: Array<{ id: string; label: string; to: ApprovalState }>;
  source: string;
  updatedAt: string;
};

const ACTION_LABELS: Partial<Record<ApprovalState, string>> = {
  submitted: "Submit",
  in_review: "Start review",
  changes_requested: "Request changes",
  approved: "Approve",
  rejected: "Reject",
  escalated: "Escalate",
  withdrawn: "Withdraw",
};

/** Composes the card once, from the object, the readiness check and the viewer's persona. */
export function buildApprovalCard(
  world: World,
  urn: string,
  persona: Persona,
  rules: Record<Brand, BrandRules> = BRAND_RULES,
): ApprovalCard {
  const object = getObject(world, urn);
  if (!object) throw new Error(`${urn} is not in the graph.`);
  const brand = rules[object.brand];
  const facts: ApprovalCard["facts"] = [
    { label: "Kind", value: object.kind },
    { label: "Version", value: String(object.version) },
    { label: "Owner", value: PERSONA_LABELS[object.owner as Persona] ?? object.owner },
    { label: "Classification", value: object.classification },
  ];
  let blockers: string[] = [];
  if (object.kind === "module") {
    const attributes = attributesOf<ModuleAttributes>(object);
    facts.push({ label: "Channel", value: attributes.channel });
    facts.push({
      label: brand.disclosureLabel,
      value: String(attributes.requiredDisclosures.length),
    });
    const readiness = checkReadiness(world, urn, {
      farmBlockers: farmBlockers(runFarm(world, urn)),
    });
    blockers = [...readiness.blockers.map((item) => item.message), ...refreshReasons(world, urn)];
    blockers = [...new Set(blockers)];
  }
  return {
    id: urn.split(":").at(-1) ?? urn,
    urn,
    title: object.title,
    subtitle: `${object.brand} · ${object.approvalState.replace("_", " ")}`,
    brand: object.brand,
    state: object.approvalState,
    accent: brand.accent,
    rulesVersion: brand.version,
    facts,
    blockers,
    // A card never offers approval while it has blockers; the server refuses it as well.
    actions: allowedTransitions(object.approvalState, persona)
      .filter((to) => to !== "approved" || blockers.length === 0)
      .map((to) => ({ id: `transition:${to}`, label: ACTION_LABELS[to] ?? to, to })),
    source: "Northstar workbench governance API",
    updatedAt: object.updatedAt,
  };
}

export const emitReact = (card: ApprovalCard) => ({
  component: "ApprovalCard" as const,
  props: card,
});

/** Adaptive Card 1.5 JSON, for Teams, Outlook and Copilot. */
export function emitAdaptiveCard(card: ApprovalCard) {
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      {
        type: "TextBlock",
        text: card.title,
        weight: "Bolder",
        size: "Large",
        wrap: true,
        color: "Accent",
      },
      { type: "TextBlock", text: card.subtitle, isSubtle: true, spacing: "None", wrap: true },
      {
        type: "FactSet",
        facts: card.facts.map((fact) => ({ title: fact.label, value: fact.value })),
      },
      ...(card.blockers.length
        ? [
            { type: "TextBlock", text: "Blockers", weight: "Bolder", color: "Attention" },
            ...card.blockers.map((text) => ({ type: "TextBlock", text: `• ${text}`, wrap: true })),
          ]
        : []),
      {
        type: "TextBlock",
        text: `${card.source} · rules ${card.rulesVersion}`,
        isSubtle: true,
        size: "Small",
        wrap: true,
      },
    ],
    actions: card.actions.map((action) => ({
      type: "Action.Submit",
      title: action.label,
      data: { urn: card.urn, to: action.to },
    })),
  };
}

/** The data a generic Lightning Web Component binds to. */
export function emitLwc(card: ApprovalCard) {
  return {
    component: "c-northstar-approval-card",
    cardTitle: card.title,
    subtitle: card.subtitle,
    accent: card.accent,
    rulesVersion: card.rulesVersion,
    rows: card.facts,
    blockers: card.blockers,
    buttons: card.actions.map((action) => ({ name: action.to, label: action.label })),
  };
}

/** An MCP Apps resource: structured content plus a text fallback for hosts that cannot render it. */
export function emitMcpApp(card: ApprovalCard) {
  const text = [
    `${card.title} (${card.subtitle})`,
    ...card.facts.map((fact) => `${fact.label}: ${fact.value}`),
    ...(card.blockers.length ? ["Blockers:", ...card.blockers.map((item) => `- ${item}`)] : []),
    `Rules ${card.rulesVersion}`,
  ].join("\n");
  return {
    resource: { uri: `ui://northstar/approval/${card.id}`, mimeType: "text/html;profile=mcp-app" },
    structuredContent: card,
    content: [{ type: "text" as const, text }],
  };
}

export type ChannelId = "react" | "adaptive-card" | "lwc" | "mcp-app";
export const CHANNELS_EMITTED: readonly { id: ChannelId; label: string }[] = [
  { id: "react", label: "React (this app)" },
  { id: "adaptive-card", label: "Adaptive Card (Teams, Outlook, Copilot)" },
  { id: "lwc", label: "Lightning Web Component data" },
  { id: "mcp-app", label: "MCP Apps (Claude and other MCP clients)" },
];

export function emitAll(card: ApprovalCard) {
  return {
    react: emitReact(card),
    "adaptive-card": emitAdaptiveCard(card),
    lwc: emitLwc(card),
    "mcp-app": emitMcpApp(card),
  };
}
