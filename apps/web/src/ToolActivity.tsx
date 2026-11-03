import { toolSystem } from "@northstar/contracts";
import type { UIMessage } from "ai";
import { readableToolName } from "./turn-trace";

export type ToolCallState = "running" | "done" | "failed";
export type ToolCall = { id: string; system: string; tool: string; state: ToolCallState };

/** A result that came back but says the call failed or found nothing usable. */
const failedOutput = (output: unknown) => {
  const status = (output as { semanticStatus?: unknown } | null)?.semanticStatus;
  return status === "error" || status === "unavailable";
};

/** Every tool call in an answer, in order, and whether its result has come back. */
export function toolCalls(message: UIMessage): ToolCall[] {
  return message.parts.flatMap((part) => {
    const item = part as {
      type: string;
      toolName?: string;
      toolCallId?: string;
      state?: string;
      output?: unknown;
    };
    if (item.type !== "dynamic-tool" && !item.type.startsWith("tool-")) return [];
    const name = item.toolName ?? item.type.slice("tool-".length);
    const state: ToolCallState =
      item.state === "output-error" ||
      (item.state === "output-available" && failedOutput(item.output))
        ? "failed"
        : item.state === "output-available"
          ? "done"
          : "running";
    return [
      {
        id: item.toolCallId ?? `${name}-${state}`,
        system: toolSystem(name),
        tool: readableToolName(name),
        state,
      },
    ];
  });
}

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
