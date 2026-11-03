import { type Brand, PERSONA_LABELS } from "@northstar/architecture";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useScope } from "../scope";
import { AgentForm, FORMS } from "./AgentConsole";
import { AgentsPanel } from "./AgentsPanel";
import { ArchApiError, archFetch, type Scope, shortUrn, useArch } from "./api";
import { EvaluationsPanel, ModelsPanel, PromptsPanel } from "./CatalogsPanel";
import { PERSONA_FLOW, TAB_GUIDES, TAB_ORDER, type Tab } from "./guide";
import { ObjectInspector } from "./ObjectInspector";
import { ArchitectureIntro, TabGuideCard, useIntro } from "./Orientation";
import { ErrorNote, Panel } from "./Shared";
import { TrustPanel } from "./TrustPanel";
import { WorkspaceRenderer } from "./WorkspaceRenderer";
import "./architecture.css";

const GROUPS = [
  { id: "work", label: "Do the work" },
  { id: "hood", label: "Under the hood" },
] as const;

type Proposals = {
  result: Array<{
    id: string;
    action: string;
    reason: string;
    moduleUrn: string;
    brand: Brand;
    index: number | null;
  }>;
};

function Proposals({
  scope,
  refreshKey,
  onChanged,
  onOpen,
}: {
  scope: Scope;
  refreshKey: number;
  onChanged: () => void;
  onOpen: (urn: string) => void;
}) {
  const { data, error, reload } = useArch<Proposals>("/optimizations", scope, refreshKey);
  const [state, setState] = useState<{ busy?: string; error?: ArchApiError; done?: string }>({});
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  return (
    <Panel title="Optimization proposals" kicker="Performance re-enters planning">
      <p className="arch-note">
        The optimization agent proposes; the brand lead disposes. Accepting revises the plan as a
        new version that cites the result.
      </p>
      {data?.result.length === 0 && <p className="arch-note">Nothing to propose.</p>}
      <ul className="arch-proposals">
        {data?.result.map((item) => (
          <li key={item.id}>
            <span className="arch-flag">{item.action}</span>{" "}
            <button type="button" className="arch-link" onClick={() => onOpen(item.moduleUrn)}>
              {shortUrn(item.moduleUrn)}
            </button>{" "}
            <small>{item.reason}</small>
            <button
              type="button"
              className="arch-secondary"
              disabled={Boolean(state.busy)}
              onClick={async () => {
                setState({ busy: item.id });
                try {
                  const result = await archFetch<{ plan: { urn: string } }>(
                    "/optimizations/accept",
                    scope,
                    { body: { proposalId: item.id } },
                  );
                  setState({ done: result.plan.urn });
                  onChanged();
                } catch (failure) {
                  setState({ error: failure instanceof ArchApiError ? failure : undefined });
                }
              }}
            >
              Accept as {PERSONA_LABELS[scope.persona]}
            </button>
          </li>
        ))}
      </ul>
      {state.error && <ErrorNote error={state.error} />}
      {state.done && (
        <p className="arch-result">
          Plan revised:{" "}
          <button type="button" className="arch-link" onClick={() => onOpen(state.done as string)}>
            {shortUrn(state.done)}
          </button>
          . It is a draft until it is approved.
        </p>
      )}
    </Panel>
  );
}

const SEARCH_EXAMPLE: Record<Brand | "all", string> = {
  all: "e.g. which claims are approved for use",
  "Harborstone Wealth": "e.g. what backs our sweep account rate",
  "Coastline Kitchen": "e.g. which soup is on the menu this week",
  "Lumera Therapeutics": "e.g. what supports the heart failure outcomes claim",
};

function Search({ scope, onOpen }: { scope: Scope; onOpen: (urn: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{
    object: { urn: string; title: string; kind: string; brand: string };
    score: number;
  }> | null>(null);
  const [error, setError] = useState<ArchApiError | null>(null);
  return (
    <Panel title="Intelligent search" kicker="By meaning, scoped to your brands">
      <form
        className="arch-search"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            setResults(
              (
                await archFetch<{ results: NonNullable<typeof results> }>(
                  `/search?q=${encodeURIComponent(query)}`,
                  scope,
                )
              ).results,
            );
          } catch (failure) {
            setError(failure instanceof ArchApiError ? failure : null);
          }
        }}
      >
        <input
          aria-label="Search governed objects"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={SEARCH_EXAMPLE[scope.brand]}
          minLength={2}
          required
        />
        <button type="submit" className="arch-primary">
          Search
        </button>
      </form>
      {error && <ErrorNote error={error} />}
      {results?.length === 0 && <p className="arch-note">Nothing matched.</p>}
      <ul>
        {results?.map((item) => (
          <li key={item.object.urn}>
            <button type="button" className="arch-link" onClick={() => onOpen(item.object.urn)}>
              {item.object.title}
            </button>{" "}
            <small>
              {item.object.kind} · {item.object.brand} · {item.score}
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The architecture workspaces: one object model, many composed screens, every call through the gateway. */
export function ArchitectureView({ onClose }: { onClose: () => void }) {
  // The brand and role come from the header, so this view always agrees with the rest of the app.
  const { scope } = useScope();
  const [tab, setTab] = useState<Tab>(PERSONA_FLOW[scope.persona].start);
  const [open, setOpen] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Running as a different role opens that role's workspace.
  const lastPersona = useRef(scope.persona);
  useEffect(() => {
    if (lastPersona.current === scope.persona) return;
    lastPersona.current = scope.persona;
    setTab(PERSONA_FLOW[scope.persona].start);
  }, [scope.persona]);
  const intro = useIntro();
  const changed = () => setRefreshKey((value) => value + 1);
  const forms = (...names: Array<keyof typeof FORMS>): ReactNode =>
    names.map((name) => {
      const form = FORMS[name];
      return form ? (
        <AgentForm key={name} form={form} scope={scope} onDone={changed} onOpen={setOpen} />
      ) : null;
    });

  const workspace = (id: string, extra?: ReactNode) => (
    <>
      <WorkspaceRenderer id={id} scope={scope} refreshKey={refreshKey} onOpen={setOpen} />
      {extra}
    </>
  );

  return (
    <section className="evaluations-view arch-view" aria-labelledby="arch-title">
      <div className="section-header">
        <div>
          <p className="kicker">Architecture · one model, workspaces on top</p>
          <h2 id="arch-title">From plan to proof</h2>
        </div>
        <div className="arch-header-actions">
          {!intro.open && (
            <button type="button" className="text-button" onClick={() => intro.setOpen(true)}>
              What is this?
            </button>
          )}
          <button type="button" className="text-button" onClick={onClose}>
            Back to workspace
          </button>
        </div>
      </div>
      {intro.open && (
        <ArchitectureIntro scope={scope} onGo={setTab} onClose={() => intro.setOpen(false)} />
      )}
      <p className="arch-scope" role="status">
        Showing <strong>{scope.brand === "all" ? "all brands" : scope.brand}</strong> as{" "}
        <strong>{PERSONA_LABELS[scope.persona]}</strong>. Change the brand or role in the header;
        the decisions you may take follow the role, and the gateway enforces both on the server.
      </p>
      <div className="arch-tabgroups">
        {GROUPS.map((group) => (
          <div
            key={group.id}
            role="tablist"
            aria-label={group.label}
            className={`arch-tabs arch-tabs-${group.id}`}
          >
            <span className="arch-tabgroup-label" aria-hidden="true">
              {group.label}
            </span>
            {TAB_ORDER.filter((id) => TAB_GUIDES[id].group === group.id).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {TAB_GUIDES[id].label}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className={`arch-body ${open ? "with-inspector" : ""}`}>
        <div className="arch-main" role="tabpanel" aria-label={TAB_GUIDES[tab].label}>
          <TabGuideCard tab={tab} scope={scope} />
          {tab === "command-center" &&
            workspace(
              "command-center",
              <Panel title="Data readiness agent" kicker="Platform agent">
                {forms("data")}
              </Panel>,
            )}
          {tab === "brief-builder" &&
            workspace(
              "brief-builder",
              <Panel title="Plan, scenario and brief agents" kicker="Plan → Brief">
                {forms("plan", "scenario", "brief")}
              </Panel>,
            )}
          {tab === "module-library" &&
            workspace(
              "module-library",
              <>
                <Search scope={scope} onOpen={setOpen} />
                <Panel title="Reuse, author, atomize" kicker="Brief → Create">
                  {forms("reuse", "author", "atomize")}
                </Panel>
              </>,
            )}
          {tab === "approvals" &&
            workspace(
              "approvals",
              <Panel title="Substantiate, probe, propose" kicker="Substantiate → Approve">
                {forms("evidence", "readiness", "farm", "propose")}
              </Panel>,
            )}
          {tab === "performance" &&
            workspace(
              "performance",
              <>
                <Proposals
                  scope={scope}
                  refreshKey={refreshKey}
                  onChanged={changed}
                  onOpen={setOpen}
                />
                <Panel title="Attribution" kicker="Deploy & learn">
                  {forms("attribution")}
                </Panel>
              </>,
            )}
          {tab === "agents" && (
            <AgentsPanel
              scope={scope}
              refreshKey={refreshKey}
              onChanged={changed}
              onOpen={setOpen}
            />
          )}
          {tab === "catalogs" && (
            <>
              <PromptsPanel scope={scope} />
              <ModelsPanel scope={scope} />
            </>
          )}
          {tab === "evaluations" && (
            <EvaluationsPanel scope={scope} refreshKey={refreshKey} onChanged={changed} />
          )}
          {tab === "trust" && <TrustPanel scope={scope} refreshKey={refreshKey} />}
        </div>
        {open && (
          <ObjectInspector
            urn={open}
            scope={scope}
            refreshKey={refreshKey}
            onOpen={setOpen}
            onClose={() => setOpen(null)}
            onChanged={changed}
          />
        )}
      </div>
    </section>
  );
}
