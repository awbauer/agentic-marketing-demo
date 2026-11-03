import type { Brand, Persona } from "@northstar/architecture";
import type { Tab } from "./guide";

// Sample user flows: a few pieces of real work, run step by step against the same API the
// workspaces use. Each step is played by the role that would do it, so the hand-offs are visible.

export type Call = { path: string; body?: Record<string, unknown> };
export type Link = { urn: string; label: string };
export type Outcome = {
  /** What happened, in a sentence or two. */
  text: string;
  /** Extra lines, such as each refused fact or each blocker. */
  details?: string[];
  links?: Link[];
  /** Values later steps read, such as the brief or module this step created. */
  outputs?: Record<string, string>;
  tone: "done" | "stopped";
};
export type StepContext = { brand: Brand; tag: string; outputs: Record<string, string> };

export type FlowStep = {
  id: string;
  title: string;
  persona: Persona;
  /** Who does the work: an agent, or the person in the role. */
  actor: string;
  what: string;
  why: string;
  /** The workspace where this step happens day to day. */
  tab: Tab;
  calls: (context: StepContext) => Call[];
  summarize: (responses: unknown[], context: StepContext) => Outcome;
};

export type SampleFlow = {
  id: string;
  brand: Brand;
  title: string;
  situation: string;
  steps: FlowStep[];
};

// Response shapes, as far as the summaries read them.
type Run<T> = { result: T };
type Obj = { urn: string; title: string; attributes?: Record<string, unknown> };
type Authored = {
  module?: Obj & { attributes: { blocks: Array<{ claimUrn?: string; disclosureUrn?: string }> } };
  refused: Array<{ topic: string; reason: string }>;
  gaps: Obj[];
};
type Packet = {
  claims: Array<{
    text: string;
    status: string;
    evidence: Array<{ source: string; expiresOn: string }>;
    issues: string[];
  }>;
};
type Proposal = {
  proposed: boolean;
  reason: string;
  blockers: Array<{ message: string }>;
};
type Finding = { probe: string; severity: string; message: string };
type Card = { card: { state: string; title: string } };
type Variant = { variant: Obj };
type Attribution = { narrative: string; index: number; carriedBy?: Obj };
type Scenario = {
  expectedClicksBefore: number;
  expectedClicksAfter: number;
  delta: number;
  notes: string[];
};
type Optimization = { action: string; reason: string; moduleUrn: string; brand: Brand };

const result = <T>(responses: unknown[], index = 0) => (responses[index] as Run<T>).result;
const quoted = (text: string) => `“${text}”`;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const need = (context: StepContext, key: string) => {
  const value = context.outputs[key];
  if (!value) throw new Error(`Run the earlier steps first: ${key} is missing.`);
  return value;
};
const agent = (id: string, action: string, input: Record<string, unknown>): Call => ({
  path: `/agents/${id}/run`,
  body: { action, input },
});

// Steps most flows share ------------------------------------------------------------------------

const briefStep = (planUrn: string, waveId: string, from: string): FlowStep => ({
  id: "brief",
  title: "Draft the brief from the plan",
  persona: "marketer",
  actor: "Brief agent",
  what: `The brief agent drafts a brief for wave ${waveId} of ${from}.`,
  why: "The brief points at the plan instead of copying it, so the audience, channel and send date can never drift from what was approved.",
  tab: "brief-builder",
  calls: ({ tag }) => [agent("brief", "draft_brief", { planUrn, waveId, runTag: tag })],
  summarize: (responses) => {
    const { brief } = result<{ brief: Obj }>(responses);
    return {
      text: `Drafted ${quoted(brief.title)}. Its audience, channel and date are read from the plan, not retyped.`,
      links: [{ urn: brief.urn, label: brief.title }],
      outputs: { briefUrn: brief.urn },
      tone: "done",
    };
  },
});

const authorStep = (topics: string[], channel: string, asked: string): FlowStep => ({
  id: "author",
  title: "Write the content from approved claims",
  persona: "content-lab",
  actor: "Module authoring agent",
  what: `You ask for ${asked}. The authoring agent writes ${/^[aeiou]/.test(channel) ? "an" : "a"} ${channel} module from the brief.`,
  why: "It can only state a fact that is an approved claim, and it attaches the disclosures that claim requires. What it can’t back up becomes a gap record instead of copy.",
  tab: "module-library",
  calls: (context) => [
    agent("module-authoring", "author_module", {
      briefUrn: need(context, "briefUrn"),
      topics,
      channel,
    }),
  ],
  summarize: (responses) => {
    const authored = result<Authored>(responses);
    if (!authored.module)
      return {
        text: "Nothing was written: none of the facts asked for has an approved claim.",
        details: authored.refused.map((item) => `${item.topic}: ${item.reason}`),
        tone: "stopped",
      };
    const blocks = authored.module.attributes.blocks;
    const claims = blocks.filter((block) => block.claimUrn).length;
    const disclosures = blocks.filter((block) => block.disclosureUrn).length;
    return {
      text: `Wrote ${quoted(authored.module.title)}, citing ${plural(claims, "approved claim")}${disclosures ? ` with ${plural(disclosures, "required disclosure")} attached` : ""}.${authored.refused.length ? ` Refused ${plural(authored.refused.length, "fact")}${authored.gaps.length ? `, and filed ${plural(authored.gaps.length, "gap record")} so someone can source it` : ""}.` : ""}`,
      details: authored.refused.map((item) => `Refused ${item.topic}: ${item.reason}`),
      links: [
        { urn: authored.module.urn, label: authored.module.title },
        ...authored.gaps.map((gap) => ({ urn: gap.urn, label: gap.title })),
      ],
      outputs: { moduleUrn: authored.module.urn },
      tone: "done",
    };
  },
});

const probeStep: FlowStep = {
  id: "probe",
  title: "Red-team the draft",
  persona: "content-lab",
  actor: "Adversarial farm",
  what: "Four probes attack the draft: uncited statements, instruction-like text, off-brand language and consent gaps.",
  why: "Problems are found by software before a reviewer spends time on them. The probes report; they change nothing.",
  tab: "approvals",
  calls: (context) => [
    agent("adversarial-farm", "run_farm", { moduleUrn: need(context, "moduleUrn") }),
  ],
  summarize: (responses) => {
    const findings = result<Finding[]>(responses);
    return findings.length === 0
      ? {
          text: "No findings: every statement is cited, nothing reads like an instruction, and the language is on brand.",
          tone: "done",
        }
      : {
          text: `${plural(findings.length, "finding")}. Anything marked “block” stops approval.`,
          details: findings.map((item) => `${item.severity} · ${item.probe}: ${item.message}`),
          tone: findings.some((item) => item.severity === "block") ? "stopped" : "done",
        };
  },
};

const evidenceStep: FlowStep = {
  id: "evidence",
  title: "Assemble the evidence",
  persona: "compliance",
  actor: "Substantiation agent",
  what: "The substantiation agent builds one evidence packet per claim the draft cites.",
  why: "The packet a reviewer used to assemble by hand — source, date, expiry, conflicts — is ready before review starts. Compliance still decides whether it is enough.",
  tab: "approvals",
  calls: (context) => [
    agent("substantiation", "assemble_evidence", { moduleUrn: need(context, "moduleUrn") }),
  ],
  summarize: (responses) => {
    const packet = result<Packet>(responses);
    const backed = packet.claims.filter((claim) => claim.status === "substantiated").length;
    return {
      text: `${backed} of ${plural(packet.claims.length, "claim")} substantiated.`,
      details: packet.claims.map((claim) => {
        const latest = claim.evidence.at(-1);
        return `${quoted(claim.text)} — ${claim.status}${latest ? `, backed by ${latest.source} until ${latest.expiresOn}` : ""}${claim.issues.length ? `. ${claim.issues.join(" ")}` : ""}`;
      }),
      tone: backed === packet.claims.length ? "done" : "stopped",
    };
  },
};

const proposeStep = (urnKey = "moduleUrn", title = "Submit it for review"): FlowStep => ({
  id: urnKey === "moduleUrn" ? "propose" : `propose-${urnKey}`,
  title,
  persona: "content-lab",
  actor: "Readiness agent",
  what: "The readiness agent checks every claim and disclosure, then submits the draft only if nothing blocks it.",
  why: "Nothing reaches a reviewer with lapsed evidence or a missing disclosure. Submitting is the furthest an agent can move anything.",
  tab: "approvals",
  calls: (context) => [
    agent("readiness", "propose_transition", { moduleUrn: need(context, urnKey) }),
  ],
  summarize: (responses) => {
    const proposal = result<Proposal>(responses);
    return proposal.proposed
      ? {
          text: "Submitted for review: every claim is substantiated and every required disclosure is present.",
          tone: "done",
        }
      : {
          text: `Not submitted. ${proposal.reason}`,
          details: proposal.blockers.map((item) => item.message),
          tone: "stopped",
        };
  },
});

const reviewStep: FlowStep = {
  id: "review",
  title: "Review and approve",
  persona: "reviewer",
  actor: "You, as the reviewer",
  what: "A person picks the draft up for review and approves it. No agent can take this step.",
  why: "The decision is yours, and it is recorded with your role and the time in the module’s history. Approval re-checks readiness, so nothing that broke since submission gets through.",
  tab: "approvals",
  calls: (context) => {
    const urn = encodeURIComponent(need(context, "moduleUrn"));
    return [
      { path: `/objects/${urn}/transition`, body: { to: "in_review" } },
      { path: `/objects/${urn}/transition`, body: { to: "approved" } },
    ];
  },
  summarize: (responses) => {
    const { card } = responses.at(-1) as Card;
    return {
      text: `${quoted(card.title)} is ${card.state}. Open it to see the decision in its history.`,
      tone: "done",
    };
  },
};

const proposalsStep: FlowStep = {
  id: "learn",
  title: "See what the results suggest next",
  persona: "brand-lead",
  actor: "Optimization agent",
  what: "Once content has run, the optimization agent reads the results and proposes changes to the plan. Here it uses last quarter’s results.",
  why: "Results come back as proposals with the numbers behind them, not as a report after the fact. The brand lead accepts or ignores each one.",
  tab: "performance",
  calls: ({ brand }) => [{ path: `/optimizations?brand=${encodeURIComponent(brand)}` }],
  summarize: (responses) => {
    const proposals = result<Optimization[]>(responses);
    return {
      text:
        proposals.length === 0
          ? "No changes proposed: nothing has under-performed or gone stale."
          : `${plural(proposals.length, "proposal")} for the brand lead to accept or ignore in Performance.`,
      details: proposals.map((item) => `${item.action}: ${item.reason}`),
      links: proposals.map((item, index) => ({
        urn: item.moduleUrn,
        label: `The module to ${item.action}${proposals.length > 1 ? ` (${index + 1})` : ""}`,
      })),
      tone: "done",
    };
  },
};

// The flows -------------------------------------------------------------------------------------

export const SAMPLE_FLOWS: readonly SampleFlow[] = [
  {
    id: "lumera-congress",
    brand: "Lumera Therapeutics",
    title: "Get a Cardivance email ready for the heart failure congress",
    situation:
      "The congress is on November 10. Lumera’s approved Q4 plan calls for an outcomes email to 410 opted-in cardiology prescribers. Someone also wants to say Cardivance beats every ARB.",
    steps: [
      briefStep("urn:northstar:content-plan:lt-q4-hcp", "w1", "the approved Q4 HCP plan"),
      authorStep(
        ["cardivance-mortality", "cardivance-superior"],
        "email",
        "the outcomes result and the claim that Cardivance beats every ARB",
      ),
      probeStep,
      evidenceStep,
      proposeStep(),
      { ...reviewStep, actor: "You, as the MLR-style reviewer" },
      proposalsStep,
    ],
  },
  {
    id: "harborstone-rate",
    brand: "Harborstone Wealth",
    title: "Explain the new Sweep Account rate after the rate decision",
    situation:
      "The sweep rate moved to 4.35% APY on October 1, and the Q4 plan’s first wave explains it. Someone also wants to mention wire fees, and an older fee-waiver email is still sitting in draft.",
    steps: [
      briefStep(
        "urn:northstar:content-plan:hs-q4-rates",
        "w1",
        "the approved Q4 rates and cash plan",
      ),
      authorStep(["sweep-apy", "wire-fees"], "email", "the current sweep rate and wire fees"),
      evidenceStep,
      proposeStep(),
      reviewStep,
      {
        ...proposeStep("feeWaiverUrn", "Try to submit the old fee-waiver email"),
        what: "For contrast, the readiness agent tries to submit “Start with 90 days of no advisory fees”, a draft written months ago.",
        why: "Its evidence has expired. This is the check that keeps a stale claim from ever reaching a reviewer.",
        calls: () => [
          agent("readiness", "propose_transition", {
            moduleUrn: "urn:northstar:module:hs-mod-fee-waiver-email",
          }),
        ],
      },
      proposalsStep,
    ],
  },
  {
    id: "coastline-cold-front",
    brand: "Coastline Kitchen",
    title: "Turn the Bay Area cold front into a chowder push",
    situation:
      "A cold front reaches the Bay Area on November 9, and Coastline’s plan has a chowder push for it. The planner wonders whether to send two days early.",
    steps: [
      {
        id: "scenario",
        title: "Ask what happens if the push goes out two days early",
        persona: "brand-planner",
        actor: "Scenario agent",
        what: "The scenario agent estimates the effect of moving wave 1 two days earlier.",
        why: "Planning questions get an answer with its basis in seconds, before anyone commits to a change. It changes nothing.",
        tab: "brief-builder",
        calls: () => [
          agent("scenario", "run_scenario", {
            planUrn: "urn:northstar:content-plan:ck-q4-weather",
            change: { type: "move-send", waveId: "w1", days: -2 },
          }),
        ],
        summarize: (responses) => {
          const scenario = result<Scenario>(responses);
          return {
            text: `Expected clicks would go from ${scenario.expectedClicksBefore} to ${scenario.expectedClicksAfter} (${scenario.delta > 0 ? "+" : ""}${scenario.delta}). The planner keeps the date.`,
            details: scenario.notes,
            tone: "done",
          };
        },
      },
      briefStep("urn:northstar:content-plan:ck-q4-weather", "w1", "the approved Q4 weather plan"),
      authorStep(["chowder-price", "soup-hours"], "push", "the chowder price and the soup hours"),
      {
        id: "atomize",
        title: "Make email and SMS versions",
        persona: "content-lab",
        actor: "Atomization agent",
        what: "The atomization agent makes email and SMS versions of the push.",
        why: "One approved message becomes every channel’s version without anyone rewriting the claims, so each version says exactly what was approved.",
        tab: "module-library",
        calls: (context) => [
          agent("atomization", "atomize_module", {
            moduleUrn: need(context, "moduleUrn"),
            channels: ["email", "sms"],
          }),
        ],
        summarize: (responses) => {
          const variants = result<Variant[]>(responses);
          return {
            text: `Made ${plural(variants.length, "version")}, each keeping every claim whole. They are drafts until approved.`,
            links: variants.map((item) => ({ urn: item.variant.urn, label: item.variant.title })),
            tone: "done",
          };
        },
      },
      proposeStep(),
      reviewStep,
      {
        id: "attribute",
        title: "Trace last October’s chowder push to what carried it",
        persona: "brand-lead",
        actor: "Attribution agent",
        what: "The attribution agent traces last October’s chowder push result back to the module and the claim behind it.",
        why: "You can see which approved fact did the work, not just which send did, so the next plan builds on it.",
        tab: "performance",
        calls: () => [
          agent("attribution", "attribute_result", {
            resultUrn: "urn:northstar:result:ck-result-chowder-push",
          }),
        ],
        summarize: (responses) => {
          const attribution = result<Attribution>(responses);
          return {
            text: attribution.narrative,
            ...(attribution.carriedBy
              ? { links: [{ urn: attribution.carriedBy.urn, label: "The claim that carried it" }] }
              : {}),
            tone: "done",
          };
        },
      },
    ],
  },
];

export const flowsFor = (brand: Brand | "all") =>
  SAMPLE_FLOWS.filter((flow) => brand === "all" || flow.brand === brand);
