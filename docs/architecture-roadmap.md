# Architecture roadmap: one model underneath, workspaces on top

Status: plan, not demonstrated behavior. Tracking issue: [#91](https://github.com/awbauer/agentic-marketing-demo/issues/91). Each work unit below is a GitHub issue; this page is the map that ties them together.

Source: the five architecture slides (layer rings, logical architecture, agent domains 1/2 and 2/2, security and compliance). This roadmap extends the current workbench toward them on Cloudflare instead of AWS.

## 1. What the workbench already has

The slides are not starting from zero. These pieces already exist and the roadmap builds on them rather than replacing them:

| Slide concept | Already in the workbench |
| --- | --- |
| Semantic data & object model | Neo4j knowledge graph (34 node labels, 53 relationships), graph explorer, GraphRAG tools, long-term graph memory with `SUPERSEDES` and `RECORDED_IN` |
| Agents (commercial) | One orchestrator plus Salesforce Campaign Creation, Content Builder, Account Discovery, and the custom readiness agent over Hosted MCP |
| Shared services | Brand-rule validation, consent coverage, readiness checks, content lineage, image rendering (Workers AI + R2) |
| Governance | Server-side confirmations, idempotency, D1 audit, authoritative read-back, kill switches (`WRITES_ENABLED`, `DISABLED_TOOLS`, `MEMORY_ENABLED`) |
| Evaluations | 20-case evaluation set, rubric criteria, judged quality dimensions, multi-model comparison, live-evals workflow |
| Regulated content | Harborstone Wealth: `Approval`, `Disclosure`, `APPROVED_UNDER`, `REQUIRES`, `APPROVED_FOR`, embargoed release order |
| Observability | Technical trace per turn, turn history, audit export, Workers traces |
| Identity | Cloudflare Access, per-user Salesforce OAuth, cross-user isolation |
| Channels | React workbench, HXL/MCP Apps cards with native fallbacks |

What is missing is the *shape*: objects with lifelong identity and governance attributes, many narrow agents instead of one orchestrator with many tools, one gateway every call passes through, a registry and catalogs that govern agents, prompts and models, an approval state machine, workspaces composed rather than hand-built, and rendering into more than one surface.

## 2. AWS to Cloudflare

| Slide (AWS / Microsoft) | Workbench (Cloudflare) |
| --- | --- |
| Entra ID SSO, conditional access | Cloudflare Access (already), with role, brand and market resolved at sign-in |
| AgentCore Registry | Agent registry: source-controlled manifest, seeded into D1, served by the Worker |
| AgentCore Identity workload tokens | Per-invocation agent tokens minted by the gateway with `jose` (RFC 8693-style `act` claim for the user) |
| Agentic Gateway | A single `gateway.invoke()` choke point in the Worker in front of every tool, MCP, A2A and service call; Cloudflare MCP server portal and AI Gateway stay behind it |
| Cedar policy | Cedar, evaluated in the Worker with `@cedar-policy/cedar-wasm` (spike first; fall back to a typed default-deny evaluator) |
| Bedrock / SageMaker model catalog | Workers AI models through AI Gateway (dynamic routes for routing and champion/challenger) |
| AgentCore Evaluations, MLflow | The existing evals package and report, extended to named evaluators, per-agent baselines and drift |
| Prompt Catalog, prompt caching | Versioned prompt catalog in source, published to KV; AI Gateway caching |
| Feature store, data lake | R2 (and R2 Data Catalog if a table format is needed) |
| Session / global / semantic cache | Durable Object state / KV / Vectorize + AI Gateway cache |
| Governance API state machine | A Durable Object per governed object, history in D1 |
| Aprimo as MLR system of record | Salesforce stays the system of record; the workbench holds references and state, never a second records store |
| Veeva, IQVIA, medical affairs, MLR | Harborstone Wealth compliance: claims, disclosures, approvals, embargoes |
| Adaptive Cards (Teams, Copilot), LWC | Rendered from the same composition: React, MCP Apps/HXL, Adaptive Card JSON, LWC data |

## 3. Guardrails that still hold

- Section 17 of the [workbench plan](agentic-marketing-workbench-plan.md) stays in force unless a work unit records an ADR that changes it. Two work units here do: model routing (WU-062) changes the fixed orchestrator model, and channels (WU-066) must not publish to a real Teams or Copilot tenant.
- No new Salesforce write types. Plans, modules, claims and approval states live in the workbench (graph, D1, Durable Objects). Salesforce writes stay the confirmed set.
- Agents propose; people decide. No agent may approve, publish, send or activate. The human gate on each lifecycle stage cannot be configured away.
- Every new tool, graph label, relationship, operator control and code file updates Learn (`pnpm learn:check`).
- Sample data only. Harborstone Wealth carries the regulated (MLR-like) story; Coastline Kitchen carries the performance loop.

## 4. Work units

Numbering continues from WU-051. Each is one vertical slice that shows up in the UI.

### Phase A: foundation (meaning layer, gateway, registry, workspaces)

| WU | Title | Slide | Depends on |
| --- | --- | --- | --- |
| [WU-052](https://github.com/awbauer/agentic-marketing-demo/issues/92) | Governed object model: lifelong IDs, governance attributes, object inspector | Rings: meaning layer | none |
| [WU-053](https://github.com/awbauer/agentic-marketing-demo/issues/93) | Agentic gateway: one choke point, Cedar default-deny, workload tokens, identity chain | Agent domains 1/2, Security | none |
| [WU-054](https://github.com/awbauer/agentic-marketing-demo/issues/94) | Agent registry: three domains, five lifecycle stages, partner agents over A2A | Agent domains 2/2 | WU-053 |
| [WU-055](https://github.com/awbauer/agentic-marketing-demo/issues/95) | Workspace composition and the Command Center | Rings: experience layer | WU-052 |

### Phase B: the lifecycle (Plan → Audience → Brief → Create → Substantiate → Approve → Deploy & Learn)

| WU | Title | Lifecycle stage | Depends on |
| --- | --- | --- | --- |
| [WU-056](https://github.com/awbauer/agentic-marketing-demo/issues/96) | Content plan and scenario agents; the brief inherits the plan | Plan, Brief | WU-052, WU-054, WU-055 |
| [WU-057](https://github.com/awbauer/agentic-marketing-demo/issues/97) | Module library: reuse, cite-or-refuse authoring, atomization, intelligent search | Brief, Create | WU-056 |
| [WU-058](https://github.com/awbauer/agentic-marketing-demo/issues/98) | Claims and substantiation; readiness blocks until it passes | Substantiate | WU-057 |
| [WU-059](https://github.com/awbauer/agentic-marketing-demo/issues/99) | Governance state machine (11 transitions) and the Approvals workspace | Approve | WU-052, WU-053 |
| [WU-060](https://github.com/awbauer/agentic-marketing-demo/issues/100) | Attribution and optimization close the loop into the plan | Deploy & Learn | WU-057, WU-059 |

### Phase C: mechanisms that govern how agents operate and evolve

| WU | Title | Slide | Depends on |
| --- | --- | --- | --- |
| [WU-061](https://github.com/awbauer/agentic-marketing-demo/issues/101) | Prompt catalog with CI evaluation gates | Prompts: a catalog, not files | WU-054 |
| [WU-062](https://github.com/awbauer/agentic-marketing-demo/issues/102) | Model catalog and routing with champion/challenger | Models: routed, not wired | WU-061 |
| [WU-063](https://github.com/awbauer/agentic-marketing-demo/issues/103) | Thirteen evaluators, drift watch, staged autonomy | Evaluations, Humans: staged autonomy | WU-054, WU-061 |
| [WU-064](https://github.com/awbauer/agentic-marketing-demo/issues/104) | Platform agents: adversarial farm and data readiness | Marketing platform agents | WU-054, WU-057 |

### Phase D: reach and trust

| WU | Title | Slide | Depends on |
| --- | --- | --- | --- |
| [WU-065](https://github.com/awbauer/agentic-marketing-demo/issues/105) | Trust view: identity chain and AI risk-to-control matrix with live evidence | Security, identity and compliance | WU-053, WU-063, WU-064 |
| [WU-066](https://github.com/awbauer/agentic-marketing-demo/issues/106) | Channels: one composition rendered to React, MCP Apps, Adaptive Cards and LWC | Rings: reach layer | WU-055, WU-059 |

## 5. Suggested order

A-phase units WU-052 and WU-053 can run in parallel; everything else hangs off them. The shortest path to a demo that *looks* like slide 3 is WU-052 → WU-053 → WU-054 → WU-055 → WU-059, which yields the object model, the gateway, the registry swimlane, the Command Center and a working approval state machine. The lifecycle agents then fill in the swimlane one column at a time.

## 6. Demo storyline once complete

A Harborstone brand planner opens the Command Center, approves a quarterly content plan, and the brief agent inherits it by ID. The reuse agent finds two approved modules; the module authoring agent writes a third and refuses one claim it cannot cite, leaving a gap record. The substantiation agent assembles evidence; the adversarial farm probes the draft; readiness passes. A compliance reviewer moves it through the state machine in the Approvals workspace, seen identically as a React card, an Adaptive Card and an LWC payload. After send, attribution ties results back to the module and claim, and optimization proposes refreshing a module whose claim was superseded, which re-enters next quarter's plan. The Trust view shows every hop of that run, the policy that allowed each call, and the evaluator scores that set each agent's autonomy.
