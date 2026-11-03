import { PERSONA_LABELS, STAGE_LABELS, STAGE_OWNERS, STAGES } from "@northstar/architecture";
import { useState } from "react";
import type { Scope } from "./api";
import {
  BEFORE_AFTER,
  GLOSSARY,
  PERSONA_FLOW,
  STAGE_TAB,
  stagesFor,
  TAB_GUIDES,
  type Tab,
} from "./guide";

const INTRO_KEY = "northstar.architecture.intro";

function readIntroOpen() {
  try {
    return window.localStorage.getItem(INTRO_KEY) !== "closed";
  } catch {
    return true;
  }
}

function writeIntroOpen(open: boolean) {
  try {
    window.localStorage.setItem(INTRO_KEY, open ? "open" : "closed");
  } catch {
    // The intro just opens again next time.
  }
}

/** Whether the intro is showing. It stays closed for this viewer once they close it. */
export function useIntro() {
  const [open, setOpen] = useState(readIntroOpen);
  return {
    open,
    setOpen: (next: boolean) => {
      writeIntroOpen(next);
      setOpen(next);
    },
  };
}

/** What this section is, why it beats today's way of working, and where the viewer's role comes in. */
export function ArchitectureIntro({
  scope,
  onGo,
  onClose,
}: {
  scope: Scope;
  onGo: (tab: Tab) => void;
  onClose: () => void;
}) {
  const flow = PERSONA_FLOW[scope.persona];
  const mine = new Set(stagesFor(scope.persona));
  const brand = scope.brand === "all" ? null : scope.brand;
  return (
    <section className="arch-intro" aria-labelledby="arch-intro-title">
      <header>
        <div>
          <p className="kicker">Start here</p>
          <h3 id="arch-intro-title">How {brand ?? "a brand"} gets content from plan to proof</h3>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Hide intro
        </button>
      </header>
      <p className="arch-intro-what">
        <strong>What you’re looking at:</strong> a working model of how marketing content is
        planned, written, checked, approved and measured. Every plan, brief, piece of content and
        claim is one shared record that moves through the steps below. Agents do the legwork at each
        step; a named person makes every decision. The data is fictional, and nothing here is sent.
      </p>

      <ol className="arch-flow" aria-label="The steps, and who decides at each">
        {STAGES.map((stage) => (
          <li key={stage} className={mine.has(stage) ? "mine" : undefined}>
            <button type="button" onClick={() => onGo(STAGE_TAB[stage])}>
              <strong>{STAGE_LABELS[stage]}</strong>
              <small>{PERSONA_LABELS[STAGE_OWNERS[stage]]} decides</small>
              {mine.has(stage) && <em>You decide here</em>}
            </button>
          </li>
        ))}
      </ol>

      <div className="arch-intro-grid">
        <div className="arch-intro-you">
          <h4>Where you come in, as {PERSONA_LABELS[scope.persona]}</h4>
          <p>{flow.line}</p>
          <button type="button" className="arch-primary" onClick={() => onGo(flow.start)}>
            Start in {TAB_GUIDES[flow.start].label}
          </button>
          <p className="arch-note">
            Change the role in the header to see the same work from another seat, or{" "}
            <button type="button" className="arch-link" onClick={() => onGo("flows")}>
              watch a sample flow
            </button>{" "}
            run from brief to approval.
          </p>
        </div>
        <div className="arch-intro-compare">
          <h4>Why it’s better than how this works today</h4>
          <table>
            <thead>
              <tr>
                <th scope="col">Today</th>
                <th scope="col">Here</th>
              </tr>
            </thead>
            <tbody>
              {BEFORE_AFTER.map((row) => (
                <tr key={row.here}>
                  <td>{(brand && row.todayFor?.[brand]) ?? row.today}</td>
                  <td>{row.here}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="arch-glossary">
        <summary>Words used here</summary>
        <dl>
          {GLOSSARY.map(([term, meaning]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

/** The plain-language card at the top of each workspace, above its technical panels. */
export function TabGuideCard({ tab, scope }: { tab: Tab; scope: Scope }) {
  const guide = TAB_GUIDES[tab];
  const decides = STAGES.filter((stage) => STAGE_TAB[stage] === tab);
  return (
    <aside className="arch-guide" aria-label={`About ${guide.label}`}>
      <dl>
        <div>
          <dt>What this is</dt>
          <dd>{guide.what}</dd>
        </div>
        <div>
          <dt>Why it’s better</dt>
          <dd>{guide.why}</dd>
        </div>
        {decides.length > 0 && (
          <div>
            <dt>Where it fits</dt>
            <dd>
              {decides
                .map(
                  (stage) =>
                    `${STAGE_LABELS[stage]}, decided by ${PERSONA_LABELS[STAGE_OWNERS[stage]]}`,
                )
                .join(" → ")}
              .
              {decides.some((stage) => stagesFor(scope.persona).includes(stage))
                ? " You decide here."
                : ` You are viewing as ${PERSONA_LABELS[scope.persona]}.`}
            </dd>
          </div>
        )}
        <div className="arch-guide-try">
          <dt>Try this</dt>
          <dd>{guide.tryIt[scope.brand]}</dd>
        </div>
      </dl>
      <p className="arch-guide-tech">
        <span>Under the hood</span> {guide.technical}
      </p>
    </aside>
  );
}
