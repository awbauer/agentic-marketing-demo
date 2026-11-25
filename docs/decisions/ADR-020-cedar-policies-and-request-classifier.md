# ADR-020: Cedar policies decide the tools on offer; a classifier supplies the context

Status: accepted

Date: 2026-11-25

## Context

ADR-019 stopped forcing tool calls and scoped tools by context, but the scoping lived in TypeScript (scenario toolsets, the pharma lifecycle's `STEP_READS`, agent grants), apart from the gateway that checks each call. The gateway's policies were Cedar-shaped but ran on a hand-written evaluator. Andrew asked for Cedar policies to show the right tools by context, and for a lightweight classifier so the right tools are used for the right things: anything about claims starts with the claims check. A request with nothing to do with the workbench, such as lottery numbers, should get a plain answer from the model, with no tools.

## Decision

- **Real Cedar.** The gateway evaluates Cedar with `@cedar-policy/cedar-wasm` 4.15.0 on both hosts: in workerd through the web build's `initSync` with the WASM imported as a module, in Node through the `nodejs` build (a `#cedar-runtime` import condition picks the loader). The policies are files in `packages/architecture/policies/` (schema, guards, personas, agents, team, squad, lifecycle, orchestrator), each with an `@id` and an `@note`, checked against the schema by `pnpm policies:check`; `policies.generated.ts` carries them into every bundle.
- **One decision for offering and calling.** One action, `call`; what is called is the resource (`Tool`, `TeamTool`, `Capability`). Context: brand, role, surface, chat scenario, pharma stage, the classifier's `intents`, the tools `done` so far, and a chat scenario's drafting `prerequisites`. Before a model step, each candidate tool is evaluated and only the permitted ones are offered (`toolsAllowed`, `chatToolsAllowed`); when the model calls one, the gateway evaluates it again in the same context. Offered and allowed can't drift apart.
- **Policies replace the TypeScript tables.** The pharma lifecycle's per-stage reads (`lifecycle.cedar`), the squad's spoke tools (`squad.cedar`), registry grants (`agents.cedar`, a template linked per live agent) and the chat rules (`orchestrator.cedar`):
  - `orchestrator-claims-check-first`: a request labelled `claims` is offered only the claims check until it has run.
  - `orchestrator-ground-before-drafting`: Marketing Cloud's drafting agents only once the scenario's checks have worked.
  - `orchestrator-off-topic`: nothing for a request labelled `off-topic`.
  - Guards (`guards.cedar`): out-of-brand calls, agents taking decision actions, and withheld agents are forbidden, whatever any permit says.
- **The request classifier** (`apps/edge/src/classifier.ts`) labels each chat request from a fixed list. Rules (the intent router's scenario patterns plus a claims detector) label instantly; a small model call, started while the turn connects its tools and limited to 8 seconds, adds labels the rules missed and never removes one. `off-topic` stands only when the model says so, alone, and no rule matched. The labels go into the Cedar context and the turn trace (`intents`, `classifiedBy`), and show on the route map as a Classifier hop.
- **Still nothing forced.** The candidates are the scenario's tools (plus the claims check whenever the request is labelled claims); Cedar narrows them; the model chooses among what is on offer. The first step must call one of them, the last writes the answer.

## Consequences

- Verified on live Vertex AI gpt-oss-120b: "Which hospitals should Lumera target for Cardivance, and can our email say it cuts heart deaths by a fifth?" was labelled `target-list` by the rules and `claims` by the model; the claims check ran first, then the target list, and the answer covered both. A paraphrased claims question only the model labelled ran the claims check; "What are this week's winning lottery numbers?" was labelled `off-topic`, got no tools, and was answered with what the workbench can do; the Fed question ran both Fed tools.
- The Worker bundle grows from about 1.3 MB to 2.8 MB gzipped (the Cedar WASM is 1.4 MB gzipped), close to Workers Free's 3 MB limit; the proof account is on Workers Paid. The GCP server installs the package beside its bundle (about 13 MB). A decision takes about 0.1 ms; the first in a process about 35 ms.
- A classified chat turn makes one extra small model call. It overlaps tool setup, so most turns don't wait for it; it is skipped where no model is bound.
- `stepToolChoice` no longer gates Marketing Cloud; the policy does. The live evaluation runner, which has no gateway, offers the scenario's candidates without that gate.

## Supersedes

ADR-019's TypeScript scoping (scenario toolsets as the final word, `STEP_READS`), and the hand-written Cedar-shaped evaluator from WU-053.
