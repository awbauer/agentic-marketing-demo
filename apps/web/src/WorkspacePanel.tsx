import {
  FOCUS_KIND_LABELS,
  type FocusItem,
  type InsightTile,
  type MarketingPreviewStep,
  type WorkingRecord,
  type WorkingSet,
} from "@northstar/contracts";
import { InsightBoard, recordUrl, relativeTime } from "@northstar/ui";
import { useEffect, useState } from "react";
import { readableToolName } from "./turn-trace";

/** Records grouped by the system that holds them, in first-seen order. */
export function recordsBySystem(records: readonly WorkingRecord[]) {
  const groups = new Map<string, { label: string; records: WorkingRecord[] }>();
  for (const record of records) {
    const group = groups.get(record.system) ?? { label: record.systemLabel, records: [] };
    group.records.push(record);
    groups.set(record.system, group);
  }
  return [...groups.entries()].map(([system, group]) => ({ system, ...group }));
}

/**
 * The chat's working set: records it opened or created, in any connected system, and the
 * context its tools returned. It starts empty with each new chat.
 */
export type FocusAction = {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
};

/** Readable names for object types, such as Flow for a Marketing Cloud campaign flow. */
const OBJECT_LABELS: Record<string, string> = {
  Flow: "Campaign flow",
  ContentDocument: "File",
};
export const objectLabel = (objectType: string) =>
  OBJECT_LABELS[objectType] ?? objectType.replace(/__c$/, "").replaceAll("_", " ");

/** The authoritative lifecycle of the current focus version. */
export function focusLifecycle(focus: FocusItem) {
  if (!focus.saved) return "Draft in progress";
  if (focus.saved.version !== focus.current) return "Unsaved changes";
  return focus.saved.campaign
    ? "Campaign created in Marketing Cloud"
    : "Brief saved in Marketing Cloud";
}

const waitLabel = (step: MarketingPreviewStep) =>
  !step.waitNumber
    ? "right away"
    : `after ${step.waitNumber} ${String(step.waitUnit ?? "").toLowerCase()}`;

const RELATION_LABELS: Record<WorkingRecord["relation"], string> = {
  read: "Opened",
  created: "Created",
  updated: "Updated",
  remembered: "Remembered",
};

/** The draft the chat is building, with every version and what it was built from. */
export function FocusCard({
  focus,
  cards,
  action,
}: {
  focus: FocusItem;
  cards: readonly InsightTile[];
  action?: FocusAction;
}) {
  const [shown, setShown] = useState(focus.current);
  // A new version from the chat becomes the one shown.
  useEffect(() => setShown(focus.current), [focus.current]);
  const version =
    focus.versions.find((entry) => entry.version === shown) ??
    (focus.versions.at(-1) as FocusItem["versions"][number]);
  const isCurrent = version.version === focus.current;
  const lifecycle = focusLifecycle(focus);
  const savedRecordLink = focus.saved
    ? recordUrl({
        system: "salesforce",
        objectType: focus.saved.objectType,
        recordId: focus.saved.recordId,
      })
    : undefined;
  const sources = version.basedOn
    .map((id) => cards.find((card) => card.id === id))
    .filter((card): card is InsightTile => Boolean(card));
  return (
    <section className="focus-card" aria-labelledby="focus-title" data-testid="workspace-focus">
      <div className="focus-topline">
        <span className="focus-kind">{FOCUS_KIND_LABELS[focus.kind]}</span>
        <span className="focus-this" aria-live="polite">
          {lifecycle}
        </span>
      </div>
      <h3 id="focus-title">{version.title}</h3>
      {focus.versions.length > 1 && (
        <fieldset className="focus-versions">
          <legend className="sr-only">Versions</legend>
          {focus.versions.map((entry) => (
            <button
              type="button"
              key={entry.version}
              aria-pressed={entry.version === version.version}
              onClick={() => setShown(entry.version)}
            >
              v{entry.version}
              {entry.version === focus.current && <span className="sr-only"> (current)</span>}
            </button>
          ))}
        </fieldset>
      )}
      <p className="focus-meta">
        Version {version.version}
        {isCurrent ? " · current" : " · earlier version"} · {version.changeNote} ·{" "}
        <time dateTime={version.createdAt}>{relativeTime(version.createdAt)}</time>
      </p>
      {version.summary && <p className="focus-summary">{version.summary}</p>}
      <dl className="focus-fields">
        {version.fields.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      {sources.length > 0 && (
        <p className="focus-sources">
          Built from{" "}
          {sources.map((card, index) => (
            <span key={card.id}>
              {index > 0 && ", "}
              <span className="focus-source">
                {card.eyebrow}: {card.title}
              </span>
            </span>
          ))}
        </p>
      )}
      {focus.saved && (
        <div className="focus-saved">
          <p className="focus-saved-line">
            {focus.saved.version === focus.current
              ? `Saved in Marketing Cloud as version ${focus.saved.version}`
              : `Marketing Cloud has version ${focus.saved.version}; this version isn't saved yet`}
            {savedRecordLink && (
              <>
                {" · "}
                <a
                  className="focus-saved-link"
                  href={savedRecordLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open {objectLabel(focus.saved.objectType)} in Salesforce
                  <span aria-hidden="true"> ↗</span>
                </a>
              </>
            )}
          </p>
          {focus.saved.preview && focus.saved.preview.length > 0 && (
            <details className="focus-preview" open={!focus.saved.campaign}>
              <summary className="focus-preview-summary on-dark">
                Campaign preview · {focus.saved.preview.length} step
                {focus.saved.preview.length === 1 ? "" : "s"} from the Campaign Creation agent
              </summary>
              <ol>
                {focus.saved.preview.map((step) => (
                  <li key={step.stepNumber}>
                    <strong>
                      {step.channel ?? step.stepType} {step.stepNumber}
                    </strong>{" "}
                    <span className="focus-preview-wait focus-preview-light">
                      · {waitLabel(step)}
                    </span>
                    {step.subject && <p className="focus-preview-subject">{step.subject}</p>}
                    {step.preheader && (
                      <p className="focus-preview-meta focus-preview-light">{step.preheader}</p>
                    )}
                    {step.body && (
                      <p className="focus-preview-body focus-preview-light">{step.body}</p>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {focus.saved.campaign && (
            <p className="focus-campaign">
              Campaign{" "}
              <a
                className="focus-campaign-link"
                href={recordUrl({
                  system: "salesforce",
                  objectType: "Campaign",
                  recordId: focus.saved.campaign.id,
                })}
                target="_blank"
                rel="noreferrer"
              >
                {focus.saved.campaign.name} <span aria-hidden="true">↗</span>
              </a>
              {focus.saved.campaign.stage ? ` · ${focus.saved.campaign.stage}` : ""}
              {focus.saved.campaign.flow && (
                <>
                  {" · "}
                  {focus.saved.campaign.flow.label} (
                  {focus.saved.campaign.flow.active
                    ? "active"
                    : "draft; set its audience and activate it in Marketing Cloud"}
                  )
                </>
              )}
            </p>
          )}
        </div>
      )}
      {action && isCurrent && (
        <div className="focus-action">
          <button type="button" onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </button>
          <span>{action.hint}</span>
        </div>
      )}
    </section>
  );
}

export function WorkspacePanel({
  workingSet,
  focusAction,
}: {
  workingSet: WorkingSet;
  focusAction?: FocusAction;
}) {
  const { records, cards, focus } = workingSet;
  if (!focus && records.length === 0 && cards.length === 0)
    return (
      <div className="workspace-empty">
        <span className="workspace-empty-mark" aria-hidden="true">
          ◌
        </span>
        <strong>Nothing in this chat yet</strong>
        <p>
          As you chat, the draft you are working on, the records you open or create, and the data
          tools return, such as weather, restaurant details, graph evidence, and campaign results,
          collect here.
        </p>
        <p className="workspace-empty-hint">New chat always starts with an empty workspace.</p>
      </div>
    );
  return (
    <div className="workspace-sections">
      {focus && <FocusCard focus={focus} cards={cards} action={focusAction} />}
      {records.length > 0 && (
        <section className="workspace-section" aria-labelledby="workspace-records-title">
          <h3 id="workspace-records-title">
            Records <span className="count">{records.length}</span>
          </h3>
          {recordsBySystem(records).map((group) => (
            <div key={group.system} className="record-group">
              <p className={`system-badge system-${group.system}`}>{group.label}</p>
              <ul className="record-list">
                {group.records.map((record) => {
                  const link = recordUrl(record);
                  return (
                    <li key={record.key} className="record-item" data-testid="workspace-record">
                      <div>
                        <strong>{record.title}</strong>
                        <span className="record-meta">
                          {objectLabel(record.objectType)} ·{" "}
                          <span className={`record-relation relation-${record.relation}`}>
                            {RELATION_LABELS[record.relation]}
                          </span>{" "}
                          {record.relation === "remembered"
                            ? "from memory"
                            : `by ${readableToolName(record.via)}`}{" "}
                          · <time dateTime={record.addedAt}>{relativeTime(record.addedAt)}</time>
                        </span>
                      </div>
                      {link && (
                        <a className="record-link" href={link} target="_blank" rel="noreferrer">
                          Open in {record.systemLabel} <span aria-hidden="true">↗</span>
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}
      {cards.length > 0 && (
        <section className="workspace-section" aria-labelledby="workspace-context-title">
          <h3 id="workspace-context-title">
            Context <span className="count">{cards.length}</span>
          </h3>
          <InsightBoard tiles={cards} />
        </section>
      )}
    </div>
  );
}
