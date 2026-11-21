// The campaign team's reference evals. Runs each reference brief on each provider, in each mode,
// against a running workbench, plays the people the team stops for, and writes every run's
// scorecard and a per-provider, per-mode comparison to artifacts/reports/WU-076/team-evals.json.
//
// Usage: pnpm eval:team [--base http://localhost:5174] [--providers cloudflare,anthropic,openai]
//                       [--briefs coastline-winter-warmup,...] [--modes squad,lifecycle]
//                       [--feedback]
//
// squad runs every reference brief; lifecycle runs the prescription brand's brief through all six
// phases, choosing the first option at each choice (the analyst's recommendation at the last).
// --feedback has each person ask for changes once before approving, which tests whether the team
// can act on a person's notes. Runs use real models and cost money on paid providers.
import { report } from "./lib/report.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith("--") ? args[at + 1] : fallback;
};
const base = option("base", "http://localhost:5174").replace(/\/$/, "");
const feedback = args.includes("--feedback");

/** The notes a person gives when asked to review, by gate. */
const NOTES = {
  compliance:
    "State that rates or results are not guaranteed, and keep the disclosure on every placement.",
  client:
    "Put more of the budget where the primary audience responds best, and make the headlines more specific.",
  focus: "Tie each focus area to one measurable outcome from last year's results.",
  concept: "Show the safety profile as prominently as the efficacy data.",
  medical: "Give the safety claim equal prominence, and keep the opening to the occasion only.",
  legal: "Check every comparison against the label, and name the meeting correctly.",
  regulatory: "Make sure the PI link is visible in the display banner.",
  audience: "Leave out low-decile general cardiologists.",
  "go-live": "Price email from the benchmark and keep about 10% in reserve.",
  "fda-2253": "Attach the current PI version to the form.",
  "next-action": "Explain the recommendation against last year's results.",
};

/** The option a person picks at a choice: the first, or the one the analyst recommends. */
const pick = (waiting) =>
  waiting.options?.find((option) => option.detail?.includes("recommends"))?.id ??
  waiting.options?.[0]?.id;

async function call(path, { persona = "marketer", body } = {}) {
  const response = await fetch(`${base}/api/arch${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-persona": persona, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path}: ${response.status} ${text.slice(0, 300)}`);
  }
  return response;
}

/** Reads a streamed run to the end, and returns its events. */
async function stream(response) {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function runOne(briefId, provider, mode) {
  const started = Date.now();
  let events = await stream(await call("/team/runs", { body: { briefId, provider, mode } }));
  const id = events.find((event) => event.type === "start")?.id;
  const asked = new Set();
  for (let round = 0; round < 24; round += 1) {
    // A run waiting for a person has a request no decision or end has followed. (The lifecycle's
    // request can come before the model's last metering events, so it isn't always second to last.)
    const at = events.findLastIndex((event) => event.type === "await-person");
    const waiting =
      at >= 0 &&
      !events.slice(at + 1).some((event) => ["decided", "done", "error"].includes(event.type))
        ? events[at]
        : null;
    if (!waiting) break;
    const ask = feedback && !asked.has(waiting.gate);
    asked.add(waiting.gate);
    console.log(`    ${waiting.gate}: ${ask ? "asks for changes" : "approves"}`);
    const more = await stream(
      await call(`/team/runs/${encodeURIComponent(id)}/decide`, {
        persona: waiting.persona,
        body: ask
          ? { gate: waiting.gate, decision: "changes", note: NOTES[waiting.gate] }
          : {
              gate: waiting.gate,
              decision: "approve",
              note: "",
              ...(waiting.options?.length ? { choice: pick(waiting) } : {}),
            },
      }),
    );
    events = [...events, ...more];
  }
  const scorecard = [...events].reverse().find((event) => event.type === "evaluation")?.scorecard;
  const error = events.find((event) => event.type === "error")?.message;
  return {
    id,
    briefId,
    provider,
    mode,
    wallMs: Date.now() - started,
    scorecard: scorecard ?? null,
    error,
  };
}

const mean = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const fixed = (value, digits = 0) => (value === null ? "—" : value.toFixed(digits));

const roster = await (await call("/team")).json();
const available = roster.providers.filter((item) => item.available).map((item) => item.id);
const providers = option("providers", available.join(",")).split(",").filter(Boolean);
const briefs = option("briefs", roster.briefs.map((brief) => brief.id).join(","))
  .split(",")
  .filter(Boolean);
const modes = option("modes", "squad").split(",").filter(Boolean);
// The lifecycle runs for a prescription brand only.
const PHARMA = new Set(
  roster.briefs.filter((brief) => brief.brand === "Lumera Therapeutics").map((brief) => brief.id),
);
const unavailable = providers.filter((id) => !available.includes(id));
if (unavailable.length) {
  console.error(`Not available here: ${unavailable.join(", ")}.`);
  process.exit(1);
}

console.log(
  `Campaign team evals: ${modes.join(" and ")} on ${providers.join(", ")} against ${base}${feedback ? "; people ask for changes once" : ""}.`,
);
const runs = [];
for (const provider of providers)
  for (const mode of modes)
    for (const briefId of briefs.filter((id) => mode !== "lifecycle" || PHARMA.has(id))) {
      console.log(`  ${provider} · ${mode} · ${briefId}`);
      try {
        const run = await runOne(briefId, provider, mode);
        runs.push(run);
        console.log(
          run.scorecard
            ? `    score ${run.scorecard.overall}${run.scorecard.costUsd === null ? "" : `, $${run.scorecard.costUsd.toFixed(2)}`}, ${Math.round(run.wallMs / 1000)} s`
            : `    no scorecard${run.error ? `: ${run.error}` : ""}`,
        );
      } catch (error) {
        runs.push({
          briefId,
          provider,
          mode,
          scorecard: null,
          error: String(error?.message ?? error),
        });
        console.log(`    failed: ${error?.message ?? error}`);
      }
    }

const summary = providers.flatMap((provider) =>
  modes.map((mode) => {
    const cards = runs
      .filter((run) => run.provider === provider && run.mode === mode && run.scorecard)
      .map((run) => run.scorecard);
    const checks = {};
    for (const card of cards)
      for (const check of card.checks)
        if (check.score !== null) {
          checks[check.id] ??= [];
          checks[check.id].push(check.score);
        }
    return {
      provider,
      mode,
      runs: runs.filter((run) => run.provider === provider && run.mode === mode).length,
      scored: cards.length,
      overall: mean(cards.map((card) => card.overall)),
      judge: mean(
        cards.flatMap((card) =>
          card.judge?.scores.length ? [mean(card.judge.scores.map((item) => item.score))] : [],
        ),
      ),
      costUsd: mean(cards.flatMap((card) => (card.costUsd === null ? [] : [card.costUsd]))),
      modelSeconds: mean(cards.map((card) => card.modelMs / 1000)),
      checks: Object.fromEntries(Object.entries(checks).map(([id, scores]) => [id, mean(scores)])),
    };
  }),
);

console.log("\nProvider    Mode       scored  score  judge  cost/run  model s");
for (const row of summary)
  console.log(
    [
      row.provider.padEnd(11),
      row.mode.padEnd(10),
      String(row.scored).padStart(6),
      fixed(row.overall).padStart(6),
      fixed(row.judge, 1).padStart(6),
      (row.costUsd === null ? "—" : `$${row.costUsd.toFixed(2)}`).padStart(9),
      fixed(row.modelSeconds).padStart(8),
    ].join(" "),
  );
const path = await report(
  providers.length === 1 ? `team-evals-${providers[0]}` : "team-evals",
  { base, feedback, briefs, providers, modes, summary, runs },
  "WU-076",
);
console.log(`\nWrote ${path}`);
if (runs.some((run) => !run.scorecard)) process.exitCode = 1;
