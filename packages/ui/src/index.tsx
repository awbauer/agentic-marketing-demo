import { type InsightTile, type RecordRef, systemLabel } from "@northstar/contracts";

const SALESFORCE_SANDBOX_ORIGIN = "https://pu1788182184076.my.salesforce.com";

export function salesforceRecordUrl(objectApiName: string, recordId: string) {
  const objectName = encodeURIComponent(objectApiName);
  const id = encodeURIComponent(recordId);
  return `${SALESFORCE_SANDBOX_ORIGIN}/lightning/r/${objectName}/${id}/view`;
}

/** A link to a record in its own system, when that system has one. */
export function recordUrl(ref: RecordRef & { url?: string }) {
  if (ref.url) return ref.url;
  // A Marketing Cloud campaign flow opens in Flow Builder by its version id.
  if (ref.system === "salesforce" && ref.objectType === "Flow" && /^301/.test(ref.recordId))
    return `${SALESFORCE_SANDBOX_ORIGIN}/builder_platform_interaction/flowBuilder.app?flowId=${encodeURIComponent(ref.recordId)}`;
  if (ref.system === "salesforce") return salesforceRecordUrl(ref.objectType, ref.recordId);
  return undefined;
}

/** "just now", "4 min ago", "2 h ago" relative to `now`. */
export function relativeTime(iso: string, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** Recovers answer text from JSON envelopes some models emit, keeping Markdown intact. */
export function unwrapAssistantText(text: string) {
  let normalized = text.trim();
  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    try {
      const parsed = JSON.parse(normalized) as unknown;
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const candidate = record.message ?? record.text ?? record.response;
        if (typeof candidate === "string") normalized = candidate;
      }
    } catch {
      // Fall through to the partial-envelope recovery below.
    }
  }
  const partial = normalized.match(/^\{\s*"(?:message|text|response)"\s*:\s*"([\s\S]*)$/);
  if (partial) {
    let fragment = (partial[1] ?? "").replace(/"\s*\}\s*$/, "");
    try {
      fragment = JSON.parse(`"${fragment.replace(/"$/, "")}"`) as string;
    } catch {
      fragment = fragment
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    normalized = fragment;
  }
  return normalized.trim();
}

/** Plain-text form for places that cannot render Markdown, such as trace details. */
export function normalizeAssistantText(text: string) {
  const normalized = unwrapAssistantText(text);
  return normalized
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\|{2,}/g, "\n")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/(?:\s*·?\s*-{3,}){2,}\s*·?\s*/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function shouldShowChatError(
  hasError: boolean,
  messages: readonly {
    role: string;
    text: string;
    hasCompletedToolOutput?: boolean;
  }[] = [],
) {
  if (!hasError) return false;
  const latestUserIndex = messages.map((message) => message.role).lastIndexOf("user");
  return !messages
    .slice(latestUserIndex + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        (message.hasCompletedToolOutput || normalizeAssistantText(message.text).length > 0),
    );
}

export function toolFreeTraceDetail(text: string) {
  return /tool catalog is not ready|salesforce.*unavailable/i.test(normalizeAssistantText(text))
    ? "No Salesforce tool completed; the response shows the connection recovery step"
    : "Completed without an external tool because no Salesforce action was needed";
}

const labels = {
  loading: "Loading",
  empty: "No insight",
  error: "Unavailable",
  stale: "Needs refresh",
  "permission-denied": "Access required",
  ready: "Current",
} as const;

export function resolveTileRenderMode(
  tile: InsightTile,
  availableResources: readonly string[] = [],
) {
  if (
    tile.presentation?.kind === "hxl" &&
    tile.presentation.sourceStatus === "deployed" &&
    availableResources.includes(tile.presentation.resourceUri)
  )
    return "hxl" as const;
  return "native" as const;
}

/** "2027-06-12" as "Jun 12, 2027"; anything else as it is. */
export function shortDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** What a tool found, one row each: a status label, the item, its ID and the date that matters. */
function TileItems({ items }: { items: NonNullable<InsightTile["items"]> }) {
  return (
    <ul className="tile-items">
      {items.map((item) => (
        <li key={`${item.title}-${item.id ?? ""}`} className={`tile-item status-${item.status}`}>
          <span className="tile-item-status">{item.label}</span>
          <span className="tile-item-title">{item.title}</span>
          {(item.id || item.date) && (
            <span className="tile-item-meta">
              {item.id && <code>{item.id}</code>}
              {item.date && (
                <span>
                  {item.date.label}{" "}
                  <time dateTime={item.date.value}>{shortDate(item.date.value)}</time>
                </span>
              )}
            </span>
          )}
          {item.note && <span className="tile-item-note">{item.note}</span>}
        </li>
      ))}
    </ul>
  );
}

export function InsightCard({
  tile,
  availableResources = [],
}: {
  tile: InsightTile;
  availableResources?: readonly string[];
}) {
  const renderMode = resolveTileRenderMode(tile, availableResources);
  const link = tile.recordRef ? recordUrl(tile.recordRef) : undefined;
  return (
    <article
      className={`insight-card state-${tile.state}`}
      data-hxl-resource={tile.presentation?.resourceUri}
      data-render-mode={renderMode}
      data-testid={`tile-${tile.kind}`}
    >
      <div className="card-topline">
        <span>{tile.eyebrow}</span>
        <span>
          {tile.presentation && (
            <span className="render-mode">{renderMode === "hxl" ? "HXL" : "Native fallback"}</span>
          )}
          <span className="state-chip">{labels[tile.state]}</span>
        </span>
      </div>
      <h3>{tile.title}</h3>
      {tile.metric && (
        <div className="metric">
          <strong>{tile.metric}</strong>
          <span>{tile.trend}</span>
        </div>
      )}
      <p>{tile.summary}</p>
      {tile.items && tile.items.length > 0 && <TileItems items={tile.items} />}
      {tile.details.length > 0 && (
        <ul>
          {tile.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
      <footer>
        <span>{tile.source.label}</span>
        {tile.updatedAt ? (
          <time dateTime={tile.updatedAt}>{relativeTime(tile.updatedAt)}</time>
        ) : (
          <time>{tile.source.freshness}</time>
        )}
        {tile.recordRef && link && (
          <a href={link} target="_blank" rel="noreferrer">
            Open in {systemLabel(tile.recordRef.system)} <span aria-hidden="true">↗</span>
          </a>
        )}
      </footer>
    </article>
  );
}

export function InsightBoard({
  tiles,
  availableResources = [],
}: {
  tiles: InsightTile[];
  availableResources?: readonly string[];
}) {
  if (tiles.length === 0)
    return (
      <div className="empty-state">
        <strong>No context yet</strong>
        <span>Data your chat's tools return appears here.</span>
      </div>
    );
  return (
    <div className="insight-grid">
      {tiles.map((tile) => (
        <InsightCard key={tile.id} tile={tile} availableResources={availableResources} />
      ))}
    </div>
  );
}
