import type { UIMessage } from "ai";
import { type ToolCallState, toolCalls } from "./turn-trace";

export { toolCalls };

const STATE_LABEL: Record<ToolCallState, string> = {
  running: "waiting for a result",
  done: "result returned",
  failed: "failed or returned nothing usable",
};

/**
 * What the answer's tools are doing while it streams: a spinner on each call still waiting for its
 * result, then a check or a cross. Once the answer is complete, the trace below keeps the detail.
 */
export function ToolActivity({ message, live }: { message: UIMessage; live: boolean }) {
  const calls = toolCalls(message);
  if (!live || calls.length === 0) return null;
  return (
    <ol className="tool-activity" aria-label="Tool calls" aria-live="polite">
      {calls.map((call) => (
        <li key={call.id} className={`tool-activity-item ${call.state}`}>
          <span className="tool-activity-mark" aria-hidden="true">
            {call.state === "running" ? (
              <span className="tool-spinner" />
            ) : call.state === "done" ? (
              "✓"
            ) : (
              "✕"
            )}
          </span>
          <span className="tool-activity-system">{call.system}</span>
          <span className="tool-activity-tool">{call.tool}</span>
          <span className="sr-only">: {STATE_LABEL[call.state]}</span>
          {call.state === "running" && <span className="tool-activity-wait">Waiting…</span>}
        </li>
      ))}
    </ol>
  );
}
