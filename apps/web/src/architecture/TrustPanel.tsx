import { type ChainHop, PERSONA_LABELS, type Persona, type RiskRow } from "@northstar/architecture";
import { relative, type Scope, useArch } from "./api";
import { ErrorNote, Loading, Panel } from "./Shared";

type Trust = {
  matrix: RiskRow[];
  chains: Array<{
    id: string;
    at: string;
    action: string;
    principal: string;
    decision: string;
    correlationId: string;
    chain: ChainHop[];
  }>;
  gateway: { total: number; allowed: number; denied: number };
  retention: {
    transcriptsAndAuditHours: number;
    imageObjectsDays: number;
    memoryDays: number;
    region: string;
  };
};

export function TrustPanel({ scope, refreshKey }: { scope: Scope; refreshKey: number }) {
  const { data, error, loading, reload } = useArch<Trust>("/trust", scope, refreshKey);
  if (loading && !data) return <Loading label="trust evidence" />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="arch-trust">
      <p className="arch-lede">
        Every claim here reads from the running system. {data.gateway.total} gateway decisions so
        far: {data.gateway.allowed} allowed, {data.gateway.denied} denied. Where nothing has been
        measured yet it says so.
      </p>
      <Panel title="AI risk to control" kicker="Each agentic threat with its named control">
        <div className="arch-risks">
          {data.matrix.map((row) => (
            <article key={row.threat} className="arch-risk">
              <h4>{row.threat}</h4>
              <p>{row.control}</p>
              <small>{row.mechanisms.join(" · ")}</small>
              <div className="arch-evidence">
                {row.evidence.map((cell) => (
                  <div key={cell.label} className={`arch-cell ${cell.state}`}>
                    <strong>{cell.value}</strong>
                    <span>{cell.label}</span>
                    <small>{cell.detail}</small>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Panel>
      <Panel title="One identity chain, every hop verified" kicker="Recent gateway calls">
        {data.chains.length === 0 && (
          <p className="arch-note">No calls yet. Open an object or run an agent, then come back.</p>
        )}
        {data.chains.map((entry) => (
          <details key={entry.id} className="arch-chain-entry">
            <summary>
              <span className={`arch-flag ${entry.decision === "allow" ? "ok" : ""}`}>
                {entry.decision}
              </span>{" "}
              {entry.action}{" "}
              <small>
                {entry.principal} · {relative(entry.at)}
              </small>
            </summary>
            <ol className="arch-chain" aria-label="Identity chain">
              {entry.chain.map((hop) => (
                <li key={hop.hop} className={hop.verified ? "verified" : "unverified"}>
                  <strong>{hop.label}</strong>
                  <span>{hop.identity}</span>
                  <small>{hop.detail}</small>
                </li>
              ))}
            </ol>
            <small>Correlation {entry.correlationId}</small>
          </details>
        ))}
      </Panel>
      <Panel title="Retention and residency" kicker="Configuration, not code">
        <ul>
          <li>Transcripts and audit events: {data.retention.transcriptsAndAuditHours} hours.</li>
          <li>Generated image objects: {data.retention.imageObjectsDays} days.</li>
          <li>Long-term graph memory: {data.retention.memoryDays} days.</li>
          <li>{data.retention.region}</li>
        </ul>
        <p className="arch-note">Viewing as {PERSONA_LABELS[scope.persona as Persona]}.</p>
      </Panel>
    </div>
  );
}
