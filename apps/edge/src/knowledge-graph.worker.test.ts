import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { connectKnowledgeGraphTools, knowledgeGraphBackend } from "./knowledge-graph/server";

const callOptions = { toolCallId: "t", messages: [], context: undefined } as never;

describe("knowledge-graph MCP", () => {
  it("uses Neo4j only when all three secrets are set, and the fixture otherwise", () => {
    expect(knowledgeGraphBackend({}).kind).toBe("fixture");
    expect(knowledgeGraphBackend({ NEO4J_QUERY_URL: "https://h/db/x/query/v2" }).kind).toBe(
      "fixture",
    );
    expect(
      knowledgeGraphBackend({
        NEO4J_QUERY_URL: "https://h/db/x/query/v2",
        NEO4J_USERNAME: "u",
        NEO4J_PASSWORD: "p",
      }).kind,
    ).toBe("neo4j");
  });

  it("serves the fifteen curated read-only tools in-process with evidence paths", async () => {
    const { tools, close } = await connectKnowledgeGraphTools(knowledgeGraphBackend({}));
    try {
      expect(Object.keys(tools).sort()).toEqual(
        [
          "graph_check_consent_coverage",
          "graph_explain_buyer_group",
          "graph_find_audience_overlap",
          "graph_find_similar_past_pushes",
          "graph_get_graph_overview",
          "graph_plan_account_outreach",
          "graph_assess_location_impact",
          "graph_map_weather_demand",
          "graph_trace_content_lineage",
          "graph_match_news_to_approved_content",
          "graph_prepare_deal_release",
          "graph_build_aum_account_plan",
          "graph_build_hcp_target_list",
          "graph_check_clinical_claims",
          "graph_plan_hospital_engagement",
        ].sort(),
      );
      const result = (await tools.graph_explain_buyer_group?.execute?.(
        { account: "Acme Outfitters", limit: 3 },
        callOptions,
      )) as { structuredContent: { source: string; candidates: unknown[]; paths: unknown[] } };
      expect(result.structuredContent.source).toBe("fixture");
      expect(result.structuredContent.candidates).toHaveLength(3);
      expect(result.structuredContent.paths.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("returns an MCP tool error when Neo4j is unavailable", async () => {
    const backend = knowledgeGraphBackend(
      { NEO4J_QUERY_URL: "https://h/db/x/query/v2", NEO4J_USERNAME: "u", NEO4J_PASSWORD: "p" },
      async () =>
        new Response(
          JSON.stringify({ errors: [{ code: "Neo.TransientError.General.DatabaseUnavailable" }] }),
          {
            status: 503,
          },
        ),
    );
    const { tools, close } = await connectKnowledgeGraphTools(backend);
    try {
      const result = (await tools.graph_get_graph_overview?.execute?.({}, callOptions)) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("may be paused");
    } finally {
      await close();
    }
  });

  it("exposes the tools over streamable HTTP and reports the graph source", async () => {
    const response = await SELF.fetch("https://example.test/mcp/knowledge-graph", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("explain_buyer_group");
    const operations = await SELF.fetch("https://example.test/agent/operations");
    await expect(operations.json()).resolves.toMatchObject({ knowledgeGraph: "fixture" });
  });

  it("serves the graph explorer overview and neighbor expansion", async () => {
    const overview = await SELF.fetch("https://example.test/api/graph/overview");
    expect(overview.status).toBe(200);
    const body = (await overview.json()) as {
      source: string;
      nodes: Array<{ id: string; label: string }>;
      relationships: Array<{ from: string; to: string }>;
      labelCounts: Record<string, number>;
    };
    expect(body.source).toBe("fixture");
    expect(body.nodes.some((node) => node.label === "PushSend")).toBe(false);
    expect(body.labelCounts.PushSend).toBe(1500);
    const ids = new Set(body.nodes.map((node) => node.id));
    expect(body.relationships.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);

    // Every push send points at a location, so a city expands into far more than the limit.
    const neighbors = await SELF.fetch(
      "https://example.test/api/graph/nodes/location-los-angeles/neighbors",
    );
    const expanded = (await neighbors.json()) as {
      nodes: unknown[];
      total: number;
      truncated: boolean;
    };
    expect(expanded.nodes.length).toBe(60);
    expect(expanded.total).toBeGreaterThan(60);
    expect(expanded.truncated).toBe(true);

    const missing = await SELF.fetch("https://example.test/api/graph/nodes/nope/neighbors");
    expect(missing.status).toBe(404);
  });
});
