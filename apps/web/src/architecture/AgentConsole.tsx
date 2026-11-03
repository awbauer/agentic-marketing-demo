import { BRANDS, type Brand, type ChainHop, type ObjectKind } from "@northstar/architecture";
import { type FormEvent, useState } from "react";
import { ArchApiError, archFetch, type Scope, shortUrn, useArch } from "./api";
import { ErrorNote, Json } from "./Shared";

type Field =
  | { name: string; label: string; type: "brand" }
  | { name: string; label: string; type: "text"; placeholder?: string; value?: string }
  | { name: string; label: string; type: "select"; options: string[] }
  | { name: string; label: string; type: "urn"; kind: ObjectKind; optional?: boolean }
  | {
      name: string;
      label: string;
      type: "checks";
      options: string[];
      /** When the header names a brand, only that brand's options are offered. */
      byBrand?: Record<Brand, string[]>;
    };

export type ActionForm = {
  agent: string;
  action: string;
  label: string;
  blurb: string;
  fields: Field[];
  build?: (values: Record<string, string | string[]>) => Record<string, unknown>;
};

const TOPICS_BY_BRAND: Record<Brand, string[]> = {
  "Harborstone Wealth": ["sweep-apy", "fdic-coverage", "fee-waiver", "fomc-date", "wire-fees"],
  "Coastline Kitchen": ["chowder-price", "soup-hours"],
  // Includes a rejected and a draft claim, so the refusal path can be shown for pharma too.
  "Lumera Therapeutics": [
    "cardivance-mortality",
    "cardivance-safety",
    "cardivance-superior",
    "cardivance-hfpef",
    "glucora-a1c",
    "neurelva-days",
  ],
};
const TOPICS = Object.values(TOPICS_BY_BRAND).flat();

export const FORMS: Record<string, ActionForm> = {
  plan: {
    agent: "content-plan",
    action: "plan_content",
    label: "Propose a content plan",
    blurb:
      "Reads the calendar and past results and drafts structured demand. A brand planner approves it.",
    fields: [{ name: "brand", label: "Brand", type: "brand" }],
  },
  scenario: {
    agent: "scenario",
    action: "run_scenario",
    label: "Run a what-if",
    blurb: "Estimates what a change does to expected clicks, with its basis.",
    fields: [
      { name: "planUrn", label: "Plan", type: "urn", kind: "content-plan" },
      {
        name: "type",
        label: "Change",
        type: "select",
        options: ["move-send", "drop-channel", "change-audience"],
      },
      { name: "waveId", label: "Wave", type: "text", value: "w1" },
      { name: "days", label: "Days to move", type: "text", value: "3" },
      {
        name: "channel",
        label: "Channel to drop",
        type: "select",
        options: ["push", "email", "sms"],
      },
      { name: "audienceSize", label: "New audience size", type: "text", value: "900" },
    ],
    build: (v) => ({
      planUrn: v.planUrn,
      change:
        v.type === "move-send"
          ? { type: "move-send", waveId: v.waveId, days: Number(v.days) }
          : v.type === "drop-channel"
            ? { type: "drop-channel", channel: v.channel }
            : {
                type: "change-audience",
                waveId: v.waveId,
                segment: "custom",
                audienceSize: Number(v.audienceSize),
              },
    }),
  },
  brief: {
    agent: "brief",
    action: "draft_brief",
    label: "Draft a brief from a plan wave",
    blurb: "The brief references the plan by urn. Audience, channel and timing are never copied.",
    fields: [
      { name: "planUrn", label: "Plan", type: "urn", kind: "content-plan" },
      { name: "waveId", label: "Wave", type: "text", value: "w1" },
    ],
  },
  reuse: {
    agent: "reuse",
    action: "reuse_modules",
    label: "Find modules to reuse",
    blurb: "Ranks existing modules by meaning and past results, and flags any that need a refresh.",
    fields: [
      { name: "briefUrn", label: "Brief", type: "urn", kind: "brief" },
      { name: "query", label: "Or search for", type: "text", placeholder: "optional" },
    ],
  },
  author: {
    agent: "module-authoring",
    action: "author_module",
    label: "Author a module (cite or refuse)",
    blurb:
      "Writes only from approved, substantiated claims. Anything it cannot cite becomes a gap record.",
    fields: [
      { name: "briefUrn", label: "Brief", type: "urn", kind: "brief" },
      {
        name: "topics",
        label: "Facts to state",
        type: "checks",
        options: TOPICS,
        byBrand: TOPICS_BY_BRAND,
      },
      { name: "channel", label: "Channel", type: "select", options: ["email", "push", "sms"] },
    ],
  },
  atomize: {
    agent: "atomization",
    action: "atomize_module",
    label: "Atomize into channel variants",
    blurb: "Variants keep every claim whole and use the short form of each disclosure.",
    fields: [
      { name: "moduleUrn", label: "Master module", type: "urn", kind: "module" },
      { name: "channels", label: "Channels", type: "checks", options: ["email", "push", "sms"] },
    ],
  },
  evidence: {
    agent: "substantiation",
    action: "assemble_evidence",
    label: "Assemble the evidence packet",
    blurb: "One packet per cited claim: evidence, expiry, supersession and conflicts.",
    fields: [{ name: "moduleUrn", label: "Module", type: "urn", kind: "module" }],
  },
  readiness: {
    agent: "readiness",
    action: "check_readiness",
    label: "Check readiness",
    blurb: "Blocks until every claim is substantiated and every disclosure is present.",
    fields: [{ name: "moduleUrn", label: "Module", type: "urn", kind: "module" }],
  },
  propose: {
    agent: "readiness",
    action: "propose_transition",
    label: "Propose a draft for review",
    blurb: "Submits a draft only if readiness passes. A person decides everything after that.",
    fields: [{ name: "moduleUrn", label: "Module", type: "urn", kind: "module" }],
  },
  farm: {
    agent: "adversarial-farm",
    action: "run_farm",
    label: "Probe a draft",
    blurb: "Four red-team probes. They report; they change nothing.",
    fields: [{ name: "moduleUrn", label: "Module", type: "urn", kind: "module" }],
  },
  data: {
    agent: "data-readiness",
    action: "check_data_readiness",
    label: "Check data readiness",
    blurb: "Scores the inputs each stage depends on.",
    fields: [{ name: "brand", label: "Brand", type: "brand" }],
  },
  attribution: {
    agent: "attribution",
    action: "attribute_result",
    label: "Attribute a result",
    blurb: "Traces a result to the module and claim that carried it.",
    fields: [{ name: "resultUrn", label: "Result", type: "urn", kind: "result" }],
  },
};

function UrnSelect({
  id,
  field,
  scope,
  value,
  onChange,
}: {
  id: string;
  field: Extract<Field, { type: "urn" }>;
  scope: Scope;
  value: string;
  onChange: (value: string) => void;
}) {
  const { data } = useArch<{ objects: Array<{ urn: string; title: string }> }>(
    `/objects?kind=${field.kind}`,
    scope,
  );
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={!field.optional}
    >
      <option value="">{data ? `Choose a ${field.kind}` : "Loading…"}</option>
      {data?.objects.map((object) => (
        <option key={object.urn} value={object.urn}>
          {object.title}
        </option>
      ))}
    </select>
  );
}

export function Chain({ chain }: { chain: ChainHop[] }) {
  return (
    <ol className="arch-chain" aria-label="Identity chain">
      {chain.map((hop) => (
        <li key={hop.hop} className={hop.verified ? "verified" : "unverified"}>
          <strong>{hop.label}</strong>
          <span>{hop.identity}</span>
          <small>{hop.detail}</small>
        </li>
      ))}
    </ol>
  );
}

type RunResult = {
  agentId: string;
  action: string;
  decision: { decision: string; policyId: string; reason: string };
  chain: ChainHop[];
  result: unknown;
  scores?: Record<string, number>;
  drift?: { drifted: boolean; samples: number };
};

type Packet = {
  claims: Array<{ claimUrn: string; text: string; status: string; issues: string[] }>;
};
type Blocker = { code: string; message: string; urn?: string };

function Summary({
  result,
  action,
  onOpen,
}: {
  result: unknown;
  action: string;
  onOpen: (urn: string) => void;
}) {
  const link = (urn: string) => (
    <button type="button" className="arch-link" onClick={() => onOpen(urn)}>
      {shortUrn(urn)}
    </button>
  );
  const r = result as Record<string, unknown>;
  if (action === "author_module") {
    const module = r.module as { urn: string } | undefined;
    const refused = r.refused as Array<{ topic: string; reason: string }>;
    return (
      <div>
        {module ? (
          <p>Drafted {link(module.urn)}. Every sentence cites a claim or a required disclosure.</p>
        ) : (
          <p>No module was written: nothing could be cited.</p>
        )}
        {refused.map((item) => (
          <p key={item.topic} className="arch-refusal">
            <strong>Refused “{item.topic}”.</strong> {item.reason} A gap record was written.
          </p>
        ))}
      </div>
    );
  }
  if (action === "reuse_modules")
    return (
      <ol className="arch-ranked">
        {(
          result as Array<{
            module: { urn: string; title: string };
            score: number;
            eligible: boolean;
            reasons: string[];
            performanceIndex: number | null;
          }>
        ).map((item) => (
          <li key={item.module.urn}>
            {link(item.module.urn)}{" "}
            <span className={item.eligible ? "arch-flag ok" : "arch-flag"}>
              {item.eligible ? `fits · ${item.score}` : "needs attention"}
            </span>
            {item.performanceIndex !== null && <small> {item.performanceIndex}× baseline</small>}
            {item.reasons.map((reason) => (
              <small key={reason} className="arch-reason">
                {reason}
              </small>
            ))}
          </li>
        ))}
      </ol>
    );
  if (action === "check_readiness" || action === "propose_transition") {
    const blockers = ((r.blockers as Blocker[]) ?? []) as Blocker[];
    const ready = r.ready as boolean | undefined;
    return (
      <div>
        {ready !== undefined && <p>{ready ? "Ready for review." : "Blocked."}</p>}
        {typeof r.reason === "string" && <p>{r.reason}</p>}
        <ul>
          {blockers.map((item) => (
            <li key={`${item.code}-${item.message}`}>{item.message}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (action === "assemble_evidence")
    return (
      <ul className="arch-claims">
        {(result as Packet).claims.map((claim) => (
          <li key={claim.claimUrn}>
            <span className={claim.status === "substantiated" ? "arch-flag ok" : "arch-flag"}>
              {claim.status.replace("-", " ")}
            </span>{" "}
            {claim.text}
            {claim.issues.map((issue) => (
              <small key={issue} className="arch-reason">
                {issue}
              </small>
            ))}
          </li>
        ))}
      </ul>
    );
  if (action === "run_farm") {
    const findings = result as Array<{ probe: string; severity: string; message: string }>;
    return findings.length === 0 ? (
      <p>No findings. Four probes ran clean.</p>
    ) : (
      <ul>
        {findings.map((item) => (
          <li key={item.message}>
            <span className="arch-flag">{item.severity}</span> {item.probe}: {item.message}
          </li>
        ))}
      </ul>
    );
  }
  if (action === "propose_optimization")
    return (
      <ul>
        {(result as Array<{ id: string; action: string; reason: string; moduleUrn: string }>).map(
          (item) => (
            <li key={item.id}>
              <strong>{item.action}</strong> {link(item.moduleUrn)} <small>{item.reason}</small>
            </li>
          ),
        )}
      </ul>
    );
  if (action === "plan_content" || action === "draft_brief" || action === "atomize_module") {
    const created = (r.plan ?? r.brief) as { urn: string } | undefined;
    if (created) return <p>Created {link(created.urn)} as a draft.</p>;
    if (Array.isArray(result))
      return (
        <ul>
          {(
            result as Array<{
              variant: { urn: string };
              fits: boolean;
              length: number;
              limit: number;
              blockers: string[];
            }>
          ).map((item) => (
            <li key={item.variant.urn}>
              {link(item.variant.urn)}{" "}
              {item.fits ? `fits (${item.length}/${item.limit})` : item.blockers.join(" ")}
            </li>
          ))}
        </ul>
      );
  }
  if (action === "run_scenario")
    return (
      <p>
        Expected clicks {String(r.expectedClicksBefore)} → {String(r.expectedClicksAfter)} (
        {Number(r.delta) >= 0 ? "+" : ""}
        {String(r.delta)}). {(r.notes as string[]).join(" ")} <small>{String(r.basis)}</small>
      </p>
    );
  if (action === "attribute_result") return <p>{String(r.narrative)}</p>;
  return null;
}

/** A form for one agent action. Every run goes through the gateway; a denial shows why. */
export function AgentForm({
  form,
  scope,
  onDone,
  onOpen,
}: {
  form: ActionForm;
  scope: Scope;
  onDone: () => void;
  onOpen: (urn: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(
      form.fields.map((f) => [
        f.name,
        f.type === "checks"
          ? []
          : f.type === "text"
            ? (f.value ?? "")
            : f.type === "select"
              ? (f.options[0] ?? "")
              : f.type === "brand"
                ? scope.brand === "all"
                  ? BRANDS[0]
                  : scope.brand
                : "",
      ]),
    ),
  );
  const [state, setState] = useState<{ busy: boolean; result?: RunResult; error?: ArchApiError }>({
    busy: false,
  });
  const set = (name: string, value: string | string[]) =>
    setValues((current) => ({ ...current, [name]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true });
    const input = form.build
      ? form.build(values)
      : Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
    try {
      const result = await archFetch<RunResult>(`/agents/${form.agent}/run`, scope, {
        body: { action: form.action, input },
      });
      setState({ busy: false, result });
      onDone();
    } catch (error) {
      setState({
        busy: false,
        error:
          error instanceof ArchApiError
            ? error
            : new ArchApiError(0, "NETWORK", "The workbench could not be reached.", {}),
      });
    }
  }

  return (
    <form className="arch-form" onSubmit={submit}>
      <h4>{form.label}</h4>
      <p className="arch-note">{form.blurb}</p>
      <div className="arch-fields">
        {form.fields.map((field) =>
          field.type === "checks" ? (
            <fieldset key={field.name} className="wide arch-checkset">
              <legend>{field.label}</legend>
              <span className="arch-checks">
                {(field.byBrand && scope.brand !== "all"
                  ? field.byBrand[scope.brand]
                  : field.options
                ).map((option) => (
                  <label key={option}>
                    <input
                      type="checkbox"
                      checked={(values[field.name] as string[]).includes(option)}
                      onChange={(event) =>
                        set(
                          field.name,
                          event.target.checked
                            ? [...(values[field.name] as string[]), option]
                            : (values[field.name] as string[]).filter((item) => item !== option),
                        )
                      }
                    />
                    {option}
                  </label>
                ))}
              </span>
            </fieldset>
          ) : (
            <label key={field.name} htmlFor={`${form.action}-${field.name}`}>
              <span>{field.label}</span>
              {field.type === "brand" && (
                <select
                  id={`${form.action}-${field.name}`}
                  value={String(values[field.name])}
                  onChange={(event) => set(field.name, event.target.value)}
                >
                  {BRANDS.map((brand) => (
                    <option key={brand}>{brand}</option>
                  ))}
                </select>
              )}
              {field.type === "text" && (
                <input
                  id={`${form.action}-${field.name}`}
                  value={String(values[field.name])}
                  placeholder={field.placeholder}
                  onChange={(event) => set(field.name, event.target.value)}
                />
              )}
              {field.type === "select" && (
                <select
                  id={`${form.action}-${field.name}`}
                  value={String(values[field.name])}
                  onChange={(event) => set(field.name, event.target.value)}
                >
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              )}
              {field.type === "urn" && (
                <UrnSelect
                  id={`${form.action}-${field.name}`}
                  field={field}
                  scope={scope}
                  value={String(values[field.name])}
                  onChange={(value) => set(field.name, value)}
                />
              )}
            </label>
          ),
        )}
      </div>
      <button type="submit" className="arch-primary" disabled={state.busy}>
        {state.busy ? "Running…" : "Run through the gateway"}
      </button>
      {state.error && (
        <div className="arch-result denied" role="alert">
          <ErrorNote error={state.error} />
          {Array.isArray(state.error.extra.chain) && (
            <>
              <p className="arch-note">
                The gateway stopped this call. The step that failed is marked below.
              </p>
              <Chain chain={state.error.extra.chain as ChainHop[]} />
            </>
          )}
        </div>
      )}
      {state.result && (
        <div className="arch-result" aria-live="polite">
          <p className="arch-decision">
            <strong>Done.</strong> Here is what the agent did; nothing is approved until a person
            approves it.
          </p>
          <Summary result={state.result.result} action={form.action} onOpen={onOpen} />
          {state.result.drift?.drifted && (
            <p className="arch-refusal">
              This agent’s recent work scored below its bar, so it is now limited to suggesting
              until someone reviews it.
            </p>
          )}
          <details className="arch-how">
            <summary>
              How this was checked: {state.result.chain.filter((hop) => hop.verified).length} of{" "}
              {state.result.chain.length} identity steps verified, allowed by{" "}
              {state.result.decision.policyId}
            </summary>
            <p className="arch-note">
              The call ran as agent:{state.result.agentId} on behalf of your role. The gateway
              checked each step below before letting it through, and logged it in Trust.
            </p>
            <Chain chain={state.result.chain} />
          </details>
          {state.result.scores && (
            <p className="arch-scores">
              <span className="arch-scores-label">
                How the evaluators scored this run (1 is a pass; see Evaluations):
              </span>
              {Object.entries(state.result.scores).map(([id, score]) => (
                <span key={id} className={score < 1 ? "arch-flag" : "arch-flag ok"}>
                  {id} {score}
                </span>
              ))}
            </p>
          )}
          <Json value={state.result.result} />
        </div>
      )}
    </form>
  );
}
