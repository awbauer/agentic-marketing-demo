import type { UIMessage } from "ai";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type GraphEvidence, latestGraphEvidence } from "./GraphEvidence";
import { GraphUsage, graphLayout } from "./GraphUsage";
import { toolCalls } from "./ToolActivity";

afterEach(cleanup);

const drug = { id: "drug-cardivance", label: "Drug", name: "Cardivance" };
const claim = (id: string) => ({ id, label: "Claim", name: `Claim ${id}` });
const trial = { id: "trial-cardio-hf", label: "Trial", name: "CARDIO-HF" };
const evidence: GraphEvidence[] = [
  {
    tool: "check clinical claims",
    source: "fixture",
    paths: [
      {
        nodes: [drug, claim("c1"), trial],
        relationships: [
          { type: "HAS_CLAIM", from: drug.id, to: "c1" },
          { type: "SUPPORTED_BY", from: "c1", to: trial.id },
        ],
      },
      {
        nodes: [drug, claim("c2")],
        relationships: [{ type: "HAS_CLAIM", from: drug.id, to: "c2" }],
      },
    ],
  },
];

describe("the knowledge-graph map", () => {
  it("draws a shared node once, in the row nearest the start", () => {
    const layout = graphLayout(evidence);
    expect(layout.nodes.map((node) => [node.id, node.row])).toEqual([
      ["drug-cardivance", 0],
      ["c1", 1],
      ["c2", 1],
      ["trial-cardio-hf", 2],
    ]);
    expect(layout.edges).toHaveLength(3);
    expect(layout.labels).toEqual(["Drug", "Claim", "Trial"]);
  });

  it("names the tools, counts their paths, and shows a legend", () => {
    render(<GraphUsage evidence={evidence} />);
    expect(screen.getByText("check clinical claims")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "4 nodes and 3 relationships along 2 evidence paths",
    );
    expect(screen.getByRole("list", { name: "Node types" }).textContent).toContain("Trial");
  });

  it("uses the latest answer that queried the graph", () => {
    const answer = (id: string, paths: unknown[]) =>
      ({
        id,
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "graph_check_clinical_claims",
            toolCallId: id,
            state: "output-available",
            input: {},
            output: { structuredContent: { paths, source: "fixture" } },
          },
        ],
      }) as UIMessage;
    const later = { id: "later", role: "assistant", parts: [{ type: "text", text: "Done." }] };
    const evidenceOf = latestGraphEvidence([
      answer("first", evidence[0]?.paths ?? []),
      later as UIMessage,
    ]);
    expect(evidenceOf[0]?.paths).toHaveLength(2);
  });
});

describe("tool activity", () => {
  it("tells a call waiting for its result from one that returned or failed", () => {
    const part = (toolCallId: string, state: string, output?: unknown) => ({
      type: "dynamic-tool",
      toolName: "ls_aprimo_search_approved_assets",
      toolCallId,
      state,
      input: {},
      ...(output ? { output } : {}),
    });
    const calls = toolCalls({
      id: "m",
      role: "assistant",
      parts: [
        part("a", "input-available"),
        part("b", "output-available", { structuredContent: {} }),
        part("c", "output-available", { semanticStatus: "error" }),
      ],
    } as UIMessage);
    expect(calls.map((call) => [call.system, call.state])).toEqual([
      ["Aprimo", "running"],
      ["Aprimo", "done"],
      ["Aprimo", "failed"],
    ]);
  });
});
