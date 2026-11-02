import { describe, expect, it } from "vitest";
import { buildDataset } from "./dataset";
import { GraphNodeNotFoundError, graphNeighbors, graphOverview } from "./explorer";
import type { GraphBackend, Row } from "./tools";

const fixture: GraphBackend = { kind: "fixture", dataset: buildDataset() };

describe("graph explorer", () => {
  it("returns every node except push and email sends, with counts for the whole graph", async () => {
    const overview = await graphOverview(fixture);
    expect(overview.nodes).toHaveLength(430);
    expect(overview.relationships).toHaveLength(1801);
    expect(overview.labelCounts.PushSend).toBe(1500);
    expect(overview.labelCounts.EmailSend).toBe(600);
    expect(
      overview.nodes.every((node) => node.label !== "PushSend" && node.label !== "EmailSend"),
    ).toBe(true);
    // The seed's dataset stamp and identity fields never appear as properties.
    expect(overview.nodes.every((node) => !("dataset" in node.properties))).toBe(true);
    expect(overview.nodes.every((node) => !("id" in node.properties))).toBe(true);
  });

  it("expands a node best performing first, with each neighbor's links to core nodes", async () => {
    const rain = await graphNeighbors(fixture, "weather-rain");
    expect(rain.nodes).toHaveLength(60);
    expect(rain.truncated).toBe(true);
    const rates = rain.nodes.map((node) => node.properties.orderRate as number);
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
    const featured = rain.relationships.filter((edge) => edge.type === "FEATURED");
    expect(featured).toHaveLength(60);
    const keys = rain.relationships.map((edge) => `${edge.from}|${edge.type}|${edge.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("rejects unknown and malformed ids", async () => {
    await expect(graphNeighbors(fixture, "nope")).rejects.toBeInstanceOf(GraphNodeNotFoundError);
    await expect(graphNeighbors(fixture, "MATCH (n) DETACH DELETE n")).rejects.toBeInstanceOf(
      GraphNodeNotFoundError,
    );
  });

  it("sends Neo4j only fixed, parameterized read statements", async () => {
    const calls: Array<{ statement: string; parameters: Row }> = [];
    const neo4j: GraphBackend = {
      kind: "neo4j",
      query: async (statement, parameters) => {
        calls.push({ statement, parameters });
        if (statement.includes("RETURN n.id AS id") && statement.includes("LIMIT 1"))
          return [{ id: "weather-rain", label: "WeatherCondition", name: "rain", properties: {} }];
        return [];
      },
    };
    await graphOverview(neo4j);
    await graphNeighbors(neo4j, "weather-rain");
    expect(calls.every(({ statement }) => !/\b(?:CREATE|MERGE|SET|DELETE)\b/.test(statement))).toBe(
      true,
    );
    expect(calls.some(({ parameters }) => parameters.id === "weather-rain")).toBe(true);
  });
});
