import { PERSONA_LABELS } from "@northstar/architecture";
import { useState } from "react";
import { useScope } from "../scope";
import { JOURNEY_GUIDE } from "./guide";
import { ObjectInspector } from "./ObjectInspector";
import { GuideCard } from "./Orientation";
import { SampleFlows } from "./SampleFlows";
import "./architecture.css";

/** Journeys: real agents doing a brand's work end to end, with the asset built in front of you. */
export function JourneysView({
  onClose,
  onOpenArchitecture,
}: {
  onClose: () => void;
  onOpenArchitecture: () => void;
}) {
  const { scope } = useScope();
  const [open, setOpen] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const changed = () => setRefreshKey((value) => value + 1);
  return (
    <section className="evaluations-view arch-view journeys-view" aria-labelledby="journeys-title">
      <div className="section-header">
        <div>
          <p className="kicker">Journeys · real agents, real work</p>
          <h2 id="journeys-title">Watch an asset get made</h2>
        </div>
        <div className="arch-header-actions">
          <button type="button" className="text-button" onClick={onOpenArchitecture}>
            How it works
          </button>
          <button type="button" className="text-button" onClick={onClose}>
            Back to workspace
          </button>
        </div>
      </div>
      <p className="arch-scope" role="status">
        Showing <strong>{scope.brand === "all" ? "all brands" : scope.brand}</strong> as{" "}
        <strong>{PERSONA_LABELS[scope.persona]}</strong>. Pick a brand in the header to see its
        journey; the orchestrator starts as your role, and each subagent acts for its step’s owner.
      </p>
      <div className="arch-body">
        <div className="arch-main">
          <GuideCard guide={JOURNEY_GUIDE} scope={scope} />
          <SampleFlows
            scope={scope}
            onOpen={setOpen}
            onChanged={changed}
            inspector={
              open ? (
                <ObjectInspector
                  urn={open}
                  scope={scope}
                  refreshKey={refreshKey}
                  onOpen={setOpen}
                  onClose={() => setOpen(null)}
                  onChanged={changed}
                />
              ) : undefined
            }
          />
        </div>
      </div>
    </section>
  );
}
