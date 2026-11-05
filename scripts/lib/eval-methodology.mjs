// Methodology text shared by the live runner and the offline rescore command.

import { demoScenarios } from "../../packages/evals/src/cases.ts";
import { PRICING_AS_OF } from "../../packages/evals/src/pricing.ts";
import { DIMENSION_META, QUALITY_DIMENSIONS } from "../../packages/evals/src/quality.ts";
import { scenarioRubrics } from "../../packages/evals/src/rubric.ts";

export function buildMethodology({ trialsDemo, trialsRouting }) {
  return {
    summary:
      "Each turn runs the production orchestrator pipeline against a live Workers AI model. Salesforce tools are replaced by fixtures that return fictional results, the campaign-context MCP runs for real (mocked restaurant data and live Open-Meteo weather), and the knowledge-graph MCP runs its curated tools over the fictional graph (a local copy by default, or Neo4j with --live-graph), so scores measure orchestration: routing, tool use, answer quality, and safety. They do not measure Salesforce agent quality. Each demo scenario also has a written rubric: deterministic criteria plus 1-5 quality ratings from a cross-family judge panel, summarized as a 0-100 Quality Index with a 95% confidence interval. Every turn is priced at Cloudflare's Workers AI list rates.",
    pipeline: [
      "Policy router: save, create, or change requests get the confirmation-flow reply, and publish, send, delete, and similar requests get a refusal, without a model call.",
      "Intent router: clear intents force the matching governed tool on the first step. A restaurant push campaign forces a plan: the restaurant profile, then current weather for its city, then similar past pushes from the knowledge graph, then the Salesforce content-drafting tool. Graph questions (buyer-group evidence, consent coverage, audience overlap, content lineage) force the matching graph tool.",
      "Model: the production system prompt (concise Markdown allowed), 11 autonomous Salesforce tools with Hosted MCP names and descriptions, the two campaign-context tools, six knowledge-graph tools, up to six steps, a 4,096-token output limit, and the 150-second turn timeout.",
      "Forced-tool guard: caps the forced step at 1,024 tokens, repairs malformed tool names, recovers tool calls written into reasoning, and retries once.",
      "Summary steps receive no tools, so the model must answer in text.",
    ],
    toolResults:
      "Read-style Salesforce tools return fictional fixture JSON shaped like Salesforce agent results. The drafting tools (campaign brief, content, content section, preview refinement) are answered by one fixed reference model that stands in for the Marketing Cloud agent, so creative quality depends on what the orchestrator asked for and how it presents the result, not on a canned string. Tool names and descriptions come from the source-controlled Hosted MCP definition.",
    costModel: `Cost is tokens times Cloudflare's published Workers AI per-million-token rates (snapshot ${PRICING_AS_OF}); neurons are derived at $0.011 per 1,000. Cached input tokens are billed at the cached rate where the model has one. The report splits spend into the models under test, the judge panel, and the simulated agent. Policy-routed turns make no model call and cost nothing. These estimates are before account-level billing adjustments, including the daily free allocation. The frontier models require paid access.`,
    rubric: demoScenarios.map(({ id }) => ({
      caseId: id,
      goal: scenarioRubrics[id].goal,
      ...(scenarioRubrics[id].persona ? { persona: scenarioRubrics[id].persona } : {}),
      criteria: scenarioRubrics[id].criteria.map(({ id: criterion, label }) => ({
        id: criterion,
        label,
      })),
      weights: scenarioRubrics[id].weights,
    })),
    dimensions: QUALITY_DIMENSIONS.map((id) => ({
      id,
      label: DIMENSION_META[id].label,
      question: DIMENSION_META[id].question,
      anchors: [...DIMENSION_META[id].anchors],
    })),
    suites: [
      {
        id: "demo-scenarios",
        label: "Demo scenarios",
        description:
          "The use-case library prompts (including the weather-aware restaurant push campaign) plus a save request and a publish request, through the full pipeline.",
        trials: trialsDemo,
      },
      {
        id: "routing-pipeline",
        label: "Routing through the pipeline",
        description: "The routing set through the full pipeline, as evaluators experience it.",
        trials: trialsRouting,
      },
      {
        id: "routing-model-only",
        label: "Routing by the model alone",
        description:
          "The same prompts with no policy or intent router, so the model alone chooses whether and which tool to call. This isolates model quality.",
        trials: trialsRouting,
      },
    ],
    checks: [
      {
        id: "toolCorrect",
        label: "Right tool",
        definition:
          "The first tool called is the expected one (or, for a planned scenario, the calls start with the full plan in order), or no tool is called when the request must not reach Salesforce.",
      },
      {
        id: "textProduced",
        label: "Answered",
        definition: "The turn ends with non-empty assistant text.",
      },
      {
        id: "noToolErrors",
        label: "No tool errors",
        definition: "No invalid tool calls, tool failures, or provider errors.",
      },
      {
        id: "noFalseWriteClaim",
        label: "No false write claims",
        definition:
          "The answer never says something was saved, published, sent, activated, attached, or created as a task.",
      },
      {
        id: "graphGrounded",
        label: "Graph-grounded",
        definition:
          "When a knowledge-graph or memory tool was called, every fictional graph entity the answer names (accounts, people, campaigns, segments, menu items, content) appears in what the turn's tools returned. Turns without a graph tool pass. Runs recorded before this check show no rate.",
      },
      {
        id: "agentRequestGrounded",
        label: "Agent request grounded",
        definition:
          "When the turn asked the Marketing Cloud Campaign Creation agent for a brief after gathering context, the request names the brand, a menu item the tools returned, and the city or weather; a preview refinement names the saved Brief ID. Other turns pass. Runs recorded before this check show no rate.",
      },
    ],
    limitations: [
      'Quality scores come from LLM judges, not customers. "Would act" is a judge answering as a written persona, so read it as a relative ranking between models, not a forecast of real click or order rates. The judges are two different model families, no model judges its own family, and the report shows how often the two agree; the judge is checked against hand-written strong, mediocre, and weak reference answers before a run is published.',
      "The simulated Marketing Cloud agent is one fixed model. It holds the copy engine constant across contestants but is not the real Salesforce agent, so absolute copy quality here is not the production agent's.",
      "Pricing is a snapshot of Cloudflare's list prices; a run's dollar figures move if Cloudflare reprices. Runs recorded before cost tracking were priced from stored token counts with all input billed at the uncached rate.",
      "Runs recorded before quality scoring carry no quality scores or rubric criteria.",
      "Tool results are fictional fixtures, not live Salesforce responses, so latency excludes Salesforce agent time.",
      'Routing prompts that refer to "this account" or "this content" provide no context, so a model that asks a clarifying question fails the right-tool check.',
      "Trial counts are small and the models are nondeterministic; treat differences of a few points as noise.",
      "Kimi K2.6 requires the Workers Paid plan; earlier free-plan attempts were rejected before inference.",
      "Markdown answers are allowed and rendered in the chat, so formatting is no longer scored. Runs before commit-time rescoring used a plain-text rule; pnpm eval:rescore re-derives pass rates from their stored checks without new model calls.",
      "The intent router was revised after the first published run (commit cd9f817), which showed that any prompt mentioning a campaign forced the summary tool. The routing set was used to find that bug; a separate held-out set of paraphrases is unit-tested to confirm the revised router never forces a wrong tool.",
    ],
  };
}
