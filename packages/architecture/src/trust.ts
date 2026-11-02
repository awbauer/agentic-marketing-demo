import { PROOF_RETENTION } from "./retention.ts";

/** Live counts the Trust view reads from the running system. Anything not measured is null. */
export type TrustEvidence = {
  gateway: {
    total: number;
    allowed: number;
    denied: number;
    recentDenies: Array<{ action: string; principal: string; policyId: string; at: string }>;
  };
  /** Calls with a gateway span over every architecture call, as a share. */
  traceCoverage: { withSpan: number; total: number };
  gapRecords: number;
  groundingMean: number | null;
  farmFindings: { block: number; warn: number };
  piiMean: number | null;
  transitions: number;
  deniedDecisions: number;
  constrainedAgents: string[];
  driftedAgents: string[];
  agentsWithBaselines: number;
};

export type EvidenceCell = {
  label: string;
  value: string;
  detail: string;
  state: "ok" | "attention" | "none";
};
export type RiskRow = {
  threat: string;
  control: string;
  mechanisms: string[];
  evidence: EvidenceCell[];
};

const pct = (value: number | null) =>
  value === null ? "no samples yet" : `${Math.round(value * 100)}%`;

export function buildRiskMatrix(evidence: TrustEvidence): RiskRow[] {
  const coverage = evidence.traceCoverage.total
    ? evidence.traceCoverage.withSpan / evidence.traceCoverage.total
    : null;
  return [
    {
      threat: "Hallucination",
      control:
        "Cite or refuse as a hard rule; grounding evaluators; a gap record instead of an invention.",
      mechanisms: ["Module authoring agent", "Prompt catalog hard rules", "Grounding evaluator"],
      evidence: [
        {
          label: "Grounding",
          value: pct(evidence.groundingMean),
          detail: "Mean over sampled agent turns.",
          state:
            evidence.groundingMean === null
              ? "none"
              : evidence.groundingMean >= 0.95
                ? "ok"
                : "attention",
        },
        {
          label: "Gap records",
          value: String(evidence.gapRecords),
          detail: "Statements the agent refused to write.",
          state: "ok",
        },
      ],
    },
    {
      threat: "Prompt injection",
      control:
        "Gateway-mediated calls only; least-privilege Cedar-style grants; the adversarial farm probes drafts.",
      mechanisms: ["Agentic gateway", "Default-deny policies", "Adversarial farm"],
      evidence: [
        {
          label: "Denied calls",
          value: String(evidence.gateway.denied),
          detail: `Of ${evidence.gateway.total} gateway decisions.`,
          state: "ok",
        },
        {
          label: "Farm findings",
          value: `${evidence.farmFindings.block} blocking, ${evidence.farmFindings.warn} warning`,
          detail: "Across drafts the farm has probed.",
          state: evidence.farmFindings.block > 0 ? "attention" : "ok",
        },
      ],
    },
    {
      threat: "Data leakage",
      control:
        "Scoped retrieval by brand; no PII in prompts by construction (variables resolve to allowed fields).",
      mechanisms: ["Brand-scoped gateway", "Prompt variable allowlists", "PII evaluator"],
      evidence: [
        {
          label: "PII evaluator",
          value: pct(evidence.piiMean),
          detail: "Share of sampled turns with no personal data.",
          state: evidence.piiMean === null ? "none" : evidence.piiMean === 1 ? "ok" : "attention",
        },
      ],
    },
    {
      threat: "Unauthorized action",
      control:
        "Default-deny grants; a person at every consequential step; approval only through the state machine.",
      mechanisms: ["Forbid agent decisions", "Governance state machine", "Confirmed writes"],
      evidence: [
        {
          label: "Transitions recorded",
          value: String(evidence.transitions),
          detail: "Each attributed and immutable.",
          state: "ok",
        },
        {
          label: "Denied decision attempts",
          value: String(evidence.deniedDecisions),
          detail: "Decision actions refused at the gateway.",
          state: "ok",
        },
      ],
    },
    {
      threat: "Drift and degradation",
      control:
        "Evaluation baselines per agent; drift watch in production; constrain through the registry before harm.",
      mechanisms: ["Thirteen evaluators", "Drift watch", "Registry constrain stage"],
      evidence: [
        {
          label: "Baselines",
          value: String(evidence.agentsWithBaselines),
          detail: "Agents with a baseline.",
          state: "ok",
        },
        {
          label: "Constrained agents",
          value: evidence.constrainedAgents.length ? evidence.constrainedAgents.join(", ") : "none",
          detail: evidence.driftedAgents.length
            ? `Drifting: ${evidence.driftedAgents.join(", ")}.`
            : "No agent is drifting.",
          state:
            evidence.constrainedAgents.length || evidence.driftedAgents.length ? "attention" : "ok",
        },
      ],
    },
    {
      threat: "Audit gaps",
      control:
        "Every architecture call routes through the gateway; state history and gateway log are the inspection-ready record.",
      mechanisms: ["Gateway log", "Immutable transition history"],
      evidence: [
        {
          label: "Decision coverage",
          value: pct(coverage),
          detail: `${evidence.traceCoverage.withSpan} of ${evidence.traceCoverage.total} decisions taken by a person or an agent have a matching gateway allow. Confirmed Salesforce writes are audited separately by the confirmation audit.`,
          state: coverage === null ? "none" : coverage === 1 ? "ok" : "attention",
        },
      ],
    },
  ];
}

export const RETENTION_CONFIG = PROOF_RETENTION;
