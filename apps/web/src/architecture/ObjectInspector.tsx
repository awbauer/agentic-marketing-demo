import type { ApprovalCard, ChainHop, GovernedObject } from "@northstar/architecture";
import { useState } from "react";
import { Chain } from "./AgentConsole";
import { ArchApiError, archFetch, kindOfUrn, relative, type Scope, shortUrn, useArch } from "./api";
import { ErrorNote, Json, Loading, StateChip } from "./Shared";

type Neighbor = {
  type: string;
  from: string;
  to: string;
  target?: { urn: string; kind: string; title: string; approvalState: string };
  source?: { urn: string; kind: string; title: string; approvalState: string };
};
type Detail = {
  object: GovernedObject;
  lineage: { outgoing: Neighbor[]; incoming: Neighbor[] };
  versions: Array<{ urn: string; version: number; approvalState: string }>;
  history: Array<{
    id: string;
    from: string;
    to: string;
    actor: string;
    actorType: string;
    reason: string | null;
    at: string;
  }>;
  allowed: string[];
  brief?: {
    objective: string;
    inheritedFrom?: { urn: string; version: number; supersededBy?: string };
    wave?: {
      theme: string;
      segment: string;
      audienceSize: number;
      channel: string;
      sendOn: string;
    };
  };
  claim?: {
    status: string;
    issues: string[];
    evidence: Array<{ urn: string; source: string; expiresOn: string; expired: boolean }>;
  };
  packet?: {
    complete: boolean;
    claims: Array<{ claimUrn: string; text: string; status: string; issues: string[] }>;
  };
  findings?: Array<{ probe: string; severity: string; message: string }>;
  chain: ChainHop[];
};
type Channels = {
  emitted: {
    react: { props: ApprovalCard };
    "adaptive-card": unknown;
    lwc: unknown;
    "mcp-app": unknown;
  };
};

const NEEDS_REASON = new Set(["rejected", "escalated", "changes_requested", "withdrawn"]);
const VERB: Record<string, string> = {
  submitted: "Submit",
  in_review: "Start review",
  changes_requested: "Request changes",
  approved: "Approve",
  rejected: "Reject",
  escalated: "Escalate",
  withdrawn: "Withdraw",
};

function Channel({ urn, scope, refreshKey }: { urn: string; scope: Scope; refreshKey: number }) {
  const { data, error, loading } = useArch<Channels>(
    `/channels?urn=${encodeURIComponent(urn)}`,
    scope,
    refreshKey,
  );
  const [tab, setTab] = useState<"react" | "adaptive-card" | "lwc" | "mcp-app">("react");
  if (loading && !data) return <Loading label="channels" />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const card = data.emitted.react.props;
  return (
    <div className="arch-channels">
      <div role="tablist" aria-label="Channel preview" className="arch-tabs small">
        {(["react", "adaptive-card", "lwc", "mcp-app"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {id === "react"
              ? "React"
              : id === "adaptive-card"
                ? "Adaptive Card"
                : id === "lwc"
                  ? "LWC data"
                  : "MCP Apps"}
          </button>
        ))}
      </div>
      {tab === "react" ? (
        <div className="arch-approval-card" style={{ borderTopColor: card.accent }}>
          <strong>{card.title}</strong>
          <small>{card.subtitle}</small>
          <dl>
            {card.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          {card.blockers.length > 0 && (
            <ul className="arch-blockers">
              {card.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          <small>
            {card.source} · rules {card.rulesVersion}
          </small>
        </div>
      ) : (
        <pre className="arch-pre">{JSON.stringify(data.emitted[tab], null, 2)}</pre>
      )}
      <p className="arch-note">
        One composition, four renderings. Brand rules are applied before any of them.
      </p>
    </div>
  );
}

function Supersede({ urn, scope, onDone }: { urn: string; scope: Scope; onDone: () => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [expiresOn, setExpiresOn] = useState("");
  const [state, setState] = useState<{
    busy?: boolean;
    error?: ArchApiError;
    flagged?: Array<{ urn: string; title: string }>;
  }>({});
  return (
    <form
      className="arch-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setState({ busy: true });
        try {
          const result = await archFetch<{ flagged: Array<{ urn: string; title: string }> }>(
            `/objects/${encodeURIComponent(urn)}/supersede`,
            scope,
            { body: { text, evidence: { source, asOf, expiresOn } } },
          );
          setState({ flagged: result.flagged });
          onDone();
        } catch (error) {
          setState({ error: error instanceof ArchApiError ? error : undefined });
        }
      }}
    >
      <h4>Supersede this claim</h4>
      <p className="arch-note">
        Compliance owns the evidence. Every module citing this claim is flagged for refresh.
      </p>
      <div className="arch-fields">
        <label className="wide">
          <span>New claim text</span>
          <textarea required value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <label>
          <span>Evidence source</span>
          <input required value={source} onChange={(event) => setSource(event.target.value)} />
        </label>
        <label>
          <span>As of</span>
          <input
            type="date"
            required
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
          />
        </label>
        <label>
          <span>Expires on</span>
          <input
            type="date"
            required
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </label>
      </div>
      <button type="submit" className="arch-primary" disabled={state.busy}>
        Supersede
      </button>
      {state.error && <ErrorNote error={state.error} />}
      {state.flagged && (
        <p className="arch-result">
          Flagged for refresh:{" "}
          {state.flagged.length === 0
            ? "no modules cite it."
            : state.flagged.map((item) => item.title).join(", ")}
        </p>
      )}
    </form>
  );
}

/** Any object, by urn: identity, governance, lineage, versions, history, and the next decision. */
export function ObjectInspector({
  urn,
  scope,
  refreshKey,
  onOpen,
  onClose,
  onChanged,
}: {
  urn: string;
  scope: Scope;
  refreshKey: number;
  onOpen: (urn: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, error, loading, reload } = useArch<Detail>(
    `/objects/${encodeURIComponent(urn)}`,
    scope,
    refreshKey,
  );
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<{ busy?: boolean; error?: ArchApiError }>({});
  const link = (target: string) => (
    <button type="button" className="arch-link" onClick={() => onOpen(target)}>
      {shortUrn(target)}
    </button>
  );

  async function move(to: string) {
    setAction({ busy: true });
    try {
      await archFetch(`/objects/${encodeURIComponent(urn)}/transition`, scope, {
        body: { to, reason },
      });
      setReason("");
      setAction({});
      onChanged();
      reload();
    } catch (failure) {
      setAction({ error: failure instanceof ArchApiError ? failure : undefined });
    }
  }

  return (
    <aside className="arch-inspector" aria-label="Object inspector">
      <header>
        <div>
          <p className="kicker">{kindOfUrn(urn)}</p>
          <h3>{data?.object.title ?? shortUrn(urn)}</h3>
          <code>{urn}</code>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Close
        </button>
      </header>
      {loading && !data && <Loading label="object" />}
      {error && <ErrorNote error={error} onRetry={reload} />}
      {data && (
        <>
          <dl className="arch-attrs">
            {[
              ["State", <StateChip key="s" state={data.object.approvalState} />],
              ["Version", `v${data.object.version}`],
              ["Brand", data.object.brand],
              ["Market", data.object.market],
              ["Owner", data.object.owner],
              ["Classification", data.object.classification],
              ["Created by", data.object.createdBy],
              ["Updated", relative(data.object.updatedAt)],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          {data.brief?.inheritedFrom && (
            <section>
              <h4>Inherited, not copied</h4>
              <p>
                Plan {link(data.brief.inheritedFrom.urn)} v{data.brief.inheritedFrom.version}
                {data.brief.inheritedFrom.supersededBy && (
                  <> (superseded by {link(data.brief.inheritedFrom.supersededBy)})</>
                )}
              </p>
              {data.brief.wave && (
                <p className="arch-note">
                  Read from the plan just now: “{data.brief.wave.theme}” to{" "}
                  {data.brief.wave.segment} ({data.brief.wave.audienceSize}) by{" "}
                  {data.brief.wave.channel} on {data.brief.wave.sendOn}.
                </p>
              )}
            </section>
          )}

          {data.claim && (
            <section>
              <h4>Evidence</h4>
              <p>
                <span
                  className={data.claim.status === "substantiated" ? "arch-flag ok" : "arch-flag"}
                >
                  {data.claim.status.replace("-", " ")}
                </span>{" "}
                {data.claim.issues.join(" ")}
              </p>
              <ul>
                {data.claim.evidence.map((item) => (
                  <li key={item.urn}>
                    {link(item.urn)} {item.source}, expires {item.expiresOn}
                    {item.expired && " (expired)"}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.packet && (
            <section>
              <h4>Substantiation</h4>
              <p>
                {data.packet.complete
                  ? "Every cited claim is substantiated."
                  : "Not every cited claim is substantiated."}
              </p>
              <ul className="arch-claims">
                {data.packet.claims.map((claim) => (
                  <li key={claim.claimUrn}>
                    <span
                      className={claim.status === "substantiated" ? "arch-flag ok" : "arch-flag"}
                    >
                      {claim.status.replace("-", " ")}
                    </span>{" "}
                    {claim.text} {link(claim.claimUrn)}
                    {claim.issues.map((issue) => (
                      <small key={issue} className="arch-reason">
                        {issue}
                      </small>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.findings && (
            <section>
              <h4>Adversarial farm</h4>
              {data.findings.length === 0 ? (
                <p className="arch-note">No findings.</p>
              ) : (
                <ul>
                  {data.findings.map((item) => (
                    <li key={item.message}>
                      <span className="arch-flag">{item.severity}</span> {item.probe}:{" "}
                      {item.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section>
            <h4>Lineage</h4>
            {data.lineage.outgoing.length + data.lineage.incoming.length === 0 && (
              <p className="arch-note">No relationships.</p>
            )}
            <ul className="arch-lineage">
              {data.lineage.outgoing.map((edge) => (
                <li key={`o-${edge.type}-${edge.to}`}>
                  <b>{edge.type}</b> → {link(edge.to)}{" "}
                  {edge.target && <StateChip state={edge.target.approvalState} />}
                </li>
              ))}
              {data.lineage.incoming.map((edge) => (
                <li key={`i-${edge.type}-${edge.from}`}>
                  {link(edge.from)} → <b>{edge.type}</b>{" "}
                  {edge.source && <StateChip state={edge.source.approvalState} />}
                </li>
              ))}
            </ul>
          </section>

          {data.versions.length > 1 && (
            <section>
              <h4>Versions</h4>
              <ol>
                {data.versions.map((item) => (
                  <li key={item.urn}>
                    v{item.version} {link(item.urn)} <StateChip state={item.approvalState} />
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section>
            <h4>Decision</h4>
            {data.allowed.length === 0 ? (
              <p className="arch-note">
                As {scope.persona}, no transition is open from{" "}
                {data.object.approvalState.replace("_", " ")}. Agents can only propose; a person
                decides.
              </p>
            ) : (
              <>
                <label className="arch-reason-input">
                  <span>Reason (required to reject, escalate, request changes or withdraw)</span>
                  <input value={reason} onChange={(event) => setReason(event.target.value)} />
                </label>
                <div className="arch-actions">
                  {data.allowed.map((to) => (
                    <button
                      key={to}
                      type="button"
                      className={to === "approved" ? "arch-primary" : "arch-secondary"}
                      disabled={action.busy || (NEEDS_REASON.has(to) && !reason.trim())}
                      onClick={() => move(to)}
                    >
                      {VERB[to] ?? to}
                    </button>
                  ))}
                </div>
              </>
            )}
            {action.error && (
              <div role="alert" className="arch-error">
                <strong>
                  {action.error.code === "BLOCKED" ? "Readiness blocks approval" : "Could not move"}
                </strong>
                <p>{action.error.message}</p>
                {Array.isArray(action.error.extra.blockers) && (
                  <ul>
                    {(action.error.extra.blockers as Array<{ message: string }>).map((b) => (
                      <li key={b.message}>{b.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section>
            <h4>History</h4>
            {data.history.length === 0 ? (
              <p className="arch-note">
                No transitions yet. History is append-only and attributed.
              </p>
            ) : (
              <ol className="arch-history">
                {data.history.map((row) => (
                  <li key={row.id}>
                    <StateChip state={row.from} /> → <StateChip state={row.to} />{" "}
                    <small>
                      by {row.actor} ({row.actorType}), {relative(row.at)}
                      {row.reason && ` — ${row.reason}`}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {data.object.kind === "claim" &&
            (scope.persona === "compliance" || scope.persona === "admin") &&
            data.object.approvalState === "approved" && (
              <Supersede
                urn={urn}
                scope={scope}
                onDone={() => {
                  onChanged();
                  reload();
                }}
              />
            )}
          {["module", "claim", "content-plan", "brief"].includes(data.object.kind) && (
            <section>
              <h4>Channels</h4>
              <Channel urn={urn} scope={scope} refreshKey={refreshKey} />
            </section>
          )}
          <details>
            <summary>Identity chain for this read</summary>
            <Chain chain={data.chain} />
          </details>
          <Json value={data.object} label="Object" />
        </>
      )}
    </aside>
  );
}
