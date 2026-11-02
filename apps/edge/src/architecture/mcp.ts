import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ArchError, type Ctx } from "./context";
import { listObjectsOp, readObjectOp, runAgentOp, searchOp } from "./ops";

export const WORKBENCH_MCP_NAME = "northstar-workbench";

const asResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: { result: value } as Record<string, unknown>,
});

const failure = (error: unknown) => {
  if (error instanceof ArchError)
    return {
      isError: true,
      content: [{ type: "text" as const, text: `${error.code}: ${error.message}` }],
    };
  throw error;
};

/**
 * The workbench as a channel: an external MCP client reads governed objects and can propose a
 * submission. Every tool goes through the same gateway as the web app, as the signed-in persona.
 * No tool can approve, publish, send or delete.
 */
export function createWorkbenchMcpServer(ctx: Ctx) {
  const server = new McpServer({ name: WORKBENCH_MCP_NAME, version: "1.0.0" });
  server.registerTool(
    "list_objects",
    {
      title: "List governed objects",
      description:
        "Lists plans, briefs, modules, claims and results the signed-in persona may see.",
      inputSchema: z.object({
        kind: z
          .enum([
            "content-plan",
            "brief",
            "module",
            "claim",
            "evidence",
            "result",
            "disclosure",
            "gap",
          ])
          .optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ kind }) => {
      try {
        return asResult(await listObjectsOp(ctx, kind ? { kind } : {}));
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "read_object",
    {
      title: "Read a governed object",
      description:
        "Returns one object by urn with its lineage, version chain, history and the transitions the persona may take.",
      inputSchema: z.object({
        urn: z.string().describe("A urn such as urn:northstar:module:hs-mod-fomc-push"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ urn }) => {
      try {
        return asResult(await readObjectOp(ctx, urn));
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "search_objects",
    {
      title: "Search governed objects",
      description: "Semantic search across governed objects, scoped to the persona's brands.",
      inputSchema: z.object({ query: z.string().min(2) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      try {
        return asResult(await searchOp(ctx, query));
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "propose_transition",
    {
      title: "Propose a module for review",
      description:
        "Asks the readiness agent to submit a draft module for review. It submits only when readiness passes; a person decides everything after that.",
      inputSchema: z.object({ moduleUrn: z.string() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ moduleUrn }) => {
      try {
        return asResult(
          (await runAgentOp(ctx, "readiness", "propose_transition", { moduleUrn })).result,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );
  return server;
}
