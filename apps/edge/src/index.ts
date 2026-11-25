import { PROOF_DEFAULTS } from "@northstar/contracts";
import { getAgentByName } from "agents";
import { handleWorkbenchRequest, runScheduledMaintenance, type WorkbenchEnv } from "./app";

export { MarketingOrchestrator } from "./orchestrator";

// The Cloudflare host: chats are Durable Objects, static files are Workers assets, and the hourly
// maintenance runs on the Worker's cron. The routes themselves live in app.ts.
export default {
  fetch(request: Request, env: WorkbenchEnv): Promise<Response> {
    return handleWorkbenchRequest(request, env, {
      async agent(agentRequest, principal, name) {
        const stub = await getAgentByName(env.MarketingOrchestrator, name, {
          props: { principalSubject: principal.subject, workspaceId: PROOF_DEFAULTS.workspaceId },
        });
        return stub.fetch(agentRequest);
      },
      assets: (assetRequest) => env.ASSETS.fetch(assetRequest),
      readiness: () => ({
        durableObject: true,
        staticAssets: Boolean(env.ASSETS),
        workersAi: Boolean(env.AI),
        d1: Boolean(env.APP_DB),
        r2: Boolean(env.CAMPAIGN_ASSETS),
      }),
    });
  },
  async scheduled(_controller: ScheduledController, env: WorkbenchEnv): Promise<void> {
    await runScheduledMaintenance(env);
  },
} satisfies ExportedHandler<WorkbenchEnv>;
