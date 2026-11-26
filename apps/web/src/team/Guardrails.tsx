// Guardrails at work: every time a rule check, the policy gateway or a tool's input contract stopped
// an agent, shown as it happens and explained. A refusal is the system doing its job, so the demo
// puts it in view rather than burying it in the tool log.
import {
  TEAM_AGENTS,
  TEAM_LIMITS,
  type TeamAgentId,
  type TeamLimit,
} from "@northstar/architecture";
import type { GuardrailHit } from "./team-state";

export const KINDS: Record<GuardrailHit["kind"], { label: string; explain: string }> = {
  rule: {
    label: "Rule check refused the save",
    explain:
      "Code checks every piece of work against the rules, whatever the model wrote. The save was refused, nothing reached the campaign file, and the agent got every problem back to fix.",
  },
  gateway: {
    label: "Policy gateway denied the call",
    explain:
      "Cedar policies decide which tools each agent may use, and at which step. This call wasn't permitted, so it never ran.",
  },
  limit: {
    label: "A hard limit stopped the work",
    explain:
      "Above the per-step checks, the squad has hard limits on tool calls per assignment, failed calls, calls per lead turn, and model calls and tokens per run. Hitting one stops that work and says why, so a model that keeps calling tools without finishing can't spin through the run.",
  },
  contract: {
    label: "Tool contract rejected the call",
    explain:
      "The input didn't match the tool's schema, so it was rejected before it ran. The model has to send what the tool defines.",
  },
};

/** What each save's rule check protects, in a reviewer's words. */
export const PROTECTS: Record<string, string> = {
  report_research: "Findings must cite real data ids from the semantic layer: cite or refuse.",
  propose_creative:
    "The palette and imagery must come from the brand book, and nothing it forbids.",
  write_copy:
    "Copy must fit each placement's character limits, avoid banned phrases and carry any required disclosure.",
  plan_media: "The channel plan must respect minimum spends, the budget and the brief's window.",
  propose_focus_areas: "Each focus area must rest on real data and say how success is measured.",
  propose_concepts:
    "Medical/Legal/Regulatory: a concept may rest only on claims approved for this campaign and on images that are approved and still in rights.",
  draft_modules:
    "Medical/Legal/Regulatory: modules use approved claims word for word, never next to a claim they must not appear with.",
  build_audience:
    "The audience must be built from real segments in the HCP universe, with their decile bands.",
};

/** Each hard limit in words. */
export const LIMIT_NAMES: Record<TeamLimit, string> = {
  assignmentToolCalls: "tool calls in one assignment",
  assignmentFailures: "failed tool calls in one assignment",
  sameRefusals: "the same refusal in a row",
  leadToolCallsPerTurn: "the lead's tool calls in one turn",
  runModelCalls: "model calls in the run",
  runTokens: "tokens in the run",
};

const agentName = (id: TeamAgentId) => TEAM_AGENTS.find((agent) => agent.id === id)?.name ?? id;

export function GuardrailPanel({ hits }: { hits: readonly GuardrailHit[] }) {
  if (hits.length === 0) return null;
  const caught = hits.reduce((sum, hit) => sum + hit.count, 0);
  return (
    <section className="team-guardrails" aria-labelledby="team-guardrails-title" aria-live="polite">
      <h4 id="team-guardrails-title">
        <span aria-hidden="true">🛡</span> Guardrails at work · {caught} caught
      </h4>
      <p className="arch-note">
        Each of these is the system doing its job: a model's mistake was stopped before it reached
        the campaign, and the agent was told exactly what to fix.
      </p>
      <ol>
        {hits.map((hit, index) => (
          <li
            // The log only grows or merges at its end, so a hit keeps its position.
            key={`${hit.agent}:${hit.tool}:${index}`}
            className={`team-guardrail ${hit.kind} ${hit.fixed ? "fixed" : "open"}`}
          >
            <p className="team-guardrail-head">
              <strong>{KINDS[hit.kind].label}</strong>
              {hit.count > 1 ? <span className="team-guardrail-count"> ×{hit.count}</span> : null}
              <span className="team-guardrail-status">
                {hit.kind === "limit"
                  ? "stopped"
                  : hit.fixed
                    ? "✓ fixed on a later try"
                    : "not fixed yet"}
              </span>
            </p>
            <p>
              {hit.kind === "limit" ? (
                <>
                  {agentName(hit.agent)} reached the limit on{" "}
                  {LIMIT_NAMES[hit.tool as TeamLimit] ?? hit.tool} (
                  {TEAM_LIMITS[hit.tool as TeamLimit]?.toLocaleString("en-US")}).{" "}
                </>
              ) : (
                <>
                  {agentName(hit.agent)} called <code>{hit.tool}</code>.{" "}
                </>
              )}
              {PROTECTS[hit.tool] ? `${PROTECTS[hit.tool]} ` : ""}
              {KINDS[hit.kind].explain}
              {hit.count > 2 && !hit.fixed
                ? " The model kept repeating the same mistake, so the campaign lead has to step in."
                : ""}
            </p>
            <details>
              <summary>
                What the guardrail said{hit.policyId ? ` (policy ${hit.policyId})` : ""}
              </summary>
              <p className="team-guardrail-detail">{hit.detail}</p>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
