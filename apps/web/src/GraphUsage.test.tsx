import type { UIMessage } from "ai";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type GraphEvidence, latestGraphEvidence } from "./GraphEvidence";
import { GraphUsage, graphTree, typeName } from "./GraphUsage";
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

describe("the knowledge-graph tree", () => {
  it("hangs each node once under the first node that reached it", () => {
    const tree = graphTree(evidence);
    const root = tree.roots[0];
    expect(tree.roots.map((node) => node.id)).toEqual(["drug-cardivance"]);
    expect(root?.children.map((node) => [node.id, node.via?.type])).toEqual([
      ["c1", "HAS_CLAIM"],
      ["c2", "HAS_CLAIM"],
    ]);
    expect(root?.children[0]?.children.map((node) => node.name)).toEqual(["CARDIO-HF"]);
    expect(tree.count).toBe(4);
    expect(tree.byType).toEqual([
      ["Drug", 1],
      ["Claim", 2],
      ["Trial", 1],
    ]);
  });

  it("starts at the node most paths pass through, whichever end the paths start from", () => {
    const tree = graphTree([
      {
        tool: "check clinical claims",
        source: "neo4j",
        paths: [
          {
            nodes: [trial, claim("c1"), drug],
            relationships: [
              { type: "SUPPORTED_BY", from: "c1", to: trial.id },
              { type: "HAS_CLAIM", from: drug.id, to: "c1" },
            ],
          },
          {
            nodes: [claim("c2"), drug],
            relationships: [{ type: "HAS_CLAIM", from: drug.id, to: "c2" }],
          },
        ],
      },
    ]);
    expect(tree.roots.map((node) => node.name)).toEqual(["Cardivance"]);
    expect(tree.roots[0]?.children.map((node) => node.id)).toEqual(["c1", "c2"]);
    expect(tree.roots[0]?.children[0]?.children[0]?.name).toBe("CARDIO-HF");
  });

  it("reads a link pointing back up the tree from the child's side", () => {
    const asset = { id: "a1", label: "ContentAsset", name: "Outcomes email" };
    const tree = graphTree([
      {
        tool: "check clinical claims",
        source: "fixture",
        paths: [
          {
            nodes: [drug, claim("c1"), asset],
            relationships: [
              { type: "HAS_CLAIM", from: drug.id, to: "c1" },
              { type: "CARRIES", from: "a1", to: "c1" },
            ],
          },
        ],
      },
    ]);
    expect(tree.roots[0]?.children[0]?.children[0]?.via).toEqual({
      type: "CARRIES",
      forward: false,
    });
    render(
      <GraphUsage
        evidence={[
          {
            tool: "check clinical claims",
            source: "fixture",
            paths: [
              {
                nodes: [drug, claim("c1"), asset],
                relationships: [
                  { type: "HAS_CLAIM", from: drug.id, to: "c1" },
                  { type: "CARRIES", from: "a1", to: "c1" },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("carried in")).toBeTruthy();
    expect(typeName("ContentAsset")).toBe("Content asset");
    expect(typeName("MlrApproval")).toBe("MLR approval");
  });

  it("sums up what the answer reached, names the tools, and shows every name in full", () => {
    render(<GraphUsage evidence={evidence} />);
    expect(screen.getByText(/→ 2 claims · 1 trial/)).toBeTruthy();
    expect(screen.getByText(/Check clinical claims \(2 paths\)/)).toBeTruthy();
    expect(screen.getByText("Claim c1")).toBeTruthy();
    expect(screen.getByRole("list", { name: "How the evidence connects" })).toBeTruthy();
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
