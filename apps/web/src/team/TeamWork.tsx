// Each spoke's saved work, and the proposal the client gets, drawn from the typed outputs rather
// than raw JSON.
import {
  ASSET_LIBRARY,
  type CampaignBrief,
  type CampaignStrategy,
  type CopyPackage,
  type CreativeConcept,
  MEDIA_CHANNEL_LABELS,
  type MediaPlan,
  type MediaProjection,
  projectMedia,
  type ResearchReport,
  type TeamSpecialist,
  teamMarket,
} from "@northstar/architecture";

const usd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const count = (value: number) => value.toLocaleString("en-US");

function segmentName(brief: CampaignBrief, id: string) {
  return teamMarket(brief.brand).segments.find((segment) => segment.id === id)?.name ?? id;
}

function Research({ work, brief }: { work: ResearchReport; brief: CampaignBrief }) {
  return (
    <div className="team-work">
      <p>
        <strong>Win first:</strong> {segmentName(brief, work.primarySegmentId)}
        {work.secondarySegmentIds.length > 0 && (
          <>
            {" "}
            · <strong>Also:</strong>{" "}
            {work.secondarySegmentIds.map((id) => segmentName(brief, id)).join(", ")}
          </>
        )}
      </p>
      <h5>Findings</h5>
      <ul>
        {work.insights.map((insight) => (
          <li key={insight.text}>
            {insight.text}{" "}
            {insight.sources.map((source) => (
              <code key={source} className="team-source">
                {source}
              </code>
            ))}
          </li>
        ))}
      </ul>
      <h5>Openings</h5>
      <ul>
        {work.opportunities.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {work.competitorWatch.length > 0 && (
        <>
          <h5>Rivals to watch</h5>
          <ul>
            {work.competitorWatch.map((item) => (
              <li key={item.competitorId}>
                <code className="team-source">{item.competitorId}</code> {item.implication}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Creative({ work, brief }: { work: CreativeConcept; brief: CampaignBrief }) {
  const names = new Map(
    teamMarket(brief.brand).guidelines.palette.map((color) => [
      color.hex.toLowerCase(),
      color.name,
    ]),
  );
  return (
    <div className="team-work">
      <p className="team-concept">
        <strong>{work.name}</strong> — {work.bigIdea}
      </p>
      <ul className="team-palette" aria-label="Palette">
        {work.palette.map((hex) => (
          <li key={hex} className="team-swatch">
            <i style={{ background: hex }} aria-hidden="true" />
            {names.get(hex.toLowerCase()) ?? hex} <code>{hex}</code>
          </li>
        ))}
      </ul>
      <p>
        <strong>Look:</strong> {work.visualDirection} <strong>Mood:</strong> {work.mood}
      </p>
      <h5>Approved assets used</h5>
      <ApprovedAssets picks={work.assets ?? []} />
      <p className="arch-note">{work.rationale}</p>
    </div>
  );
}

/**
 * The approved images a concept uses, as the asset library holds them: its library ID, its
 * approval and its rights. The swatch stands in for the image; nothing is generated.
 */
export function ApprovedAssets({
  picks,
}: {
  picks: ReadonlyArray<{ assetId: string; use: string }>;
}) {
  if (picks.length === 0) return <p className="arch-note">No assets chosen.</p>;
  return (
    <ul className="team-assets">
      {picks.map((pick) => {
        const asset = ASSET_LIBRARY.find((item) => item.id === pick.assetId);
        if (!asset)
          return (
            <li key={pick.assetId}>
              <code>{pick.assetId}</code> (not in the library)
            </li>
          );
        return (
          <li key={pick.assetId}>
            <div
              className="team-asset-swatch"
              style={{
                background: `linear-gradient(135deg, ${asset.palette[0]}, ${asset.palette[1]})`,
              }}
              role="img"
              aria-label={asset.alt}
            >
              <span>{asset.kind}</span>
            </div>
            <div>
              <strong>{asset.title}</strong>
              <small>{asset.alt}</small>
              <small>
                {asset.source} {asset.sourceId} · {asset.approval.status}
                {asset.approval.id ? ` ${asset.approval.id}` : ""}
                {asset.rightsUntil ? ` · rights to ${asset.rightsUntil}` : ""}
              </small>
              {pick.use && <small className="team-asset-use">Used for: {pick.use}</small>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Copy({ work }: { work: CopyPackage }) {
  return (
    <div className="team-work">
      <p className="team-concept">
        <strong>“{work.tagline}”</strong>
      </p>
      <p>
        <strong>Recurring themes:</strong> {work.pillars.join(" · ")}
      </p>
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col">Headline</th>
              <th scope="col">Body</th>
              <th scope="col">Call to action</th>
            </tr>
          </thead>
          <tbody>
            {work.assets.map((asset) => (
              <tr key={asset.channel}>
                <th scope="row">{MEDIA_CHANNEL_LABELS[asset.channel] ?? asset.channel}</th>
                <td>{asset.headline}</td>
                <td>
                  {asset.body}
                  {asset.disclosure && (
                    <small className="team-disclosure">{asset.disclosure}</small>
                  )}
                </td>
                <td>{asset.cta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MediaLines({
  lines,
  brief,
  totalUsd,
}: {
  lines: MediaProjection[];
  brief: CampaignBrief;
  totalUsd: number;
}) {
  const share = Math.min(1, totalUsd / brief.budgetUsd);
  return (
    <>
      <meter
        className="team-budget"
        aria-label="Budget used"
        min={0}
        max={brief.budgetUsd}
        value={totalUsd}
      />
      <p className="arch-note">
        {usd(totalUsd)} of {usd(brief.budgetUsd)} ({Math.round(share * 100)}%) ·{" "}
        {usd(brief.budgetUsd - totalUsd)} held in reserve
      </p>
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col">Budget</th>
              <th scope="col">Flight</th>
              <th scope="col">Audience</th>
              <th scope="col">Impressions</th>
              <th scope="col">Clicks</th>
              <th scope="col">Cost per click</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={`${line.channel}-${line.start}`}>
                <th scope="row">{MEDIA_CHANNEL_LABELS[line.channel] ?? line.channel}</th>
                <td>{usd(line.budgetUsd)}</td>
                <td>
                  {line.start} → {line.end}
                </td>
                <td>{segmentName(brief, line.segmentId)}</td>
                <td>{count(line.impressions)}</td>
                <td>{count(line.clicks)}</td>
                <td>{line.costPerClickUsd ? `$${line.costPerClickUsd.toFixed(2)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Media({ work, brief }: { work: MediaPlan; brief: CampaignBrief }) {
  const projected = projectMedia(brief, work);
  return (
    <div className="team-work">
      <MediaLines lines={projected.lines} brief={brief} totalUsd={projected.totalUsd} />
      <p>
        <strong>KPIs:</strong> {work.kpis.join(" · ")}
      </p>
      <p className="arch-note">{work.rationale}</p>
    </div>
  );
}

/** A spoke's saved work, drawn by its kind. */
export function TeamWorkView({
  agent,
  work,
  brief,
}: {
  agent: TeamSpecialist;
  work: unknown;
  brief: CampaignBrief;
}) {
  if (!work) return <p className="arch-note">Nothing saved yet.</p>;
  if (agent === "audience-analyst") return <Research work={work as ResearchReport} brief={brief} />;
  if (agent === "art-director") return <Creative work={work as CreativeConcept} brief={brief} />;
  if (agent === "copy-lead") return <Copy work={work as CopyPackage} />;
  return <Media work={work as MediaPlan} brief={brief} />;
}

/** The proposal, as the client receives it. */
export function StrategyView({
  strategy,
  brief,
}: {
  strategy: CampaignStrategy;
  brief: CampaignBrief;
}) {
  return (
    <article className="team-strategy" aria-labelledby="team-strategy-title">
      <header>
        <p className="kicker">Proposal sent to the client · theirs to approve</p>
        <h3 id="team-strategy-title">{strategy.title}</h3>
        <p className="team-positioning">{strategy.positioning}</p>
        <dl className="team-stats">
          <div>
            <dt>Media spend</dt>
            <dd>
              {usd(strategy.media.totalUsd)} <small>of {usd(strategy.media.budgetUsd)}</small>
            </dd>
          </div>
          <div>
            <dt>Projected impressions</dt>
            <dd>{count(strategy.media.impressions)}</dd>
          </div>
          <div>
            <dt>Projected clicks</dt>
            <dd>{count(strategy.media.clicks)}</dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd>
              {brief.start} → {brief.end}
            </dd>
          </div>
        </dl>
      </header>
      <section>
        <h4>Who it is for</h4>
        <p>
          <strong>{strategy.audience.primary}</strong>
          {strategy.audience.secondary.length > 0 && (
            <>, then {strategy.audience.secondary.join(", ")}</>
          )}
        </p>
        <ul>
          {strategy.audience.insights.map((insight) => (
            <li key={insight.text}>{insight.text}</li>
          ))}
        </ul>
      </section>
      <section>
        <h4>The look</h4>
        <Creative work={strategy.creative} brief={brief} />
      </section>
      <section>
        <h4>Line, themes and copy</h4>
        <Copy work={strategy.messaging} />
      </section>
      <section>
        <h4>Where the money goes, and what it should return</h4>
        <MediaLines lines={strategy.media.lines} brief={brief} totalUsd={strategy.media.totalUsd} />
      </section>
      {strategy.timeline.length > 0 && (
        <section>
          <h4>Timeline</h4>
          <ol className="team-timeline">
            {strategy.timeline.map((item) => (
              <li key={`${item.date}-${item.label}`}>
                <time dateTime={item.date}>{item.date}</time> {item.label}
              </li>
            ))}
          </ol>
        </section>
      )}
      {strategy.successMetrics.length > 0 && (
        <section>
          <h4>How we will know it worked</h4>
          <ul>
            {strategy.successMetrics.map((metric) => (
              <li key={metric}>{metric}</li>
            ))}
          </ul>
        </section>
      )}
      {strategy.resolutions.length > 0 && (
        <section>
          <h4>Clashes the lead resolved</h4>
          <ul>
            {strategy.resolutions.map((item) => (
              <li key={item.conflict}>
                {item.conflict} <strong>Resolution:</strong> {item.resolution}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
