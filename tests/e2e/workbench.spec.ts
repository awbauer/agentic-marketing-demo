import { expect, type Page, test } from "@playwright/test";

/** Starts a new chat and asks about the sample campaign, which opens it in the workspace. */
async function openSampleCampaign(page: Page) {
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText("Nothing in this chat yet")).toBeVisible();
  await page.getByLabel("Message the orchestrator").fill("Review the sample campaign readiness");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/strongest signal is stable engagement/i).last()).toBeVisible();
  await expect(page.getByTestId("workspace-record").first()).toContainText(
    "Fall Loyalty Reactivation",
  );
}

test("builds the workspace from the chat and completes a durable turn", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Marketing workbench" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Campaign intelligence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await expect(page.locator(".image-workflow-summary")).toBeVisible();
  await expect(page.getByText("18 configured tools")).toBeVisible();
  // A new chat starts with an empty workspace and nothing to write to.
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.locator(".messages .message.user")).toHaveCount(0);
  await expect(page.getByText("Nothing in this chat yet")).toBeVisible();
  await expect(page.getByTestId("action-card")).toHaveCount(0);
  await page.getByLabel("Message the orchestrator").focus();
  await expect(page.getByLabel("Message the orchestrator")).toBeFocused();
  const assistantMessages = page.locator(".message.assistant");
  const before = await assistantMessages.count();
  await page.getByLabel("Message the orchestrator").fill("Review the sample campaign readiness");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => assistantMessages.count(), { timeout: 15_000 }).toBeGreaterThan(before);
  await expect(page.getByText(/strongest signal is stable engagement/i).last()).toBeVisible();
  // Assistant Markdown renders as formatted elements, not literal asterisks.
  const reply = page.locator(".message.assistant .markdown").last();
  await expect(reply.locator("strong").first()).toHaveText("strongest signal is stable engagement");
  await expect(reply.locator("li")).toHaveText(["Accessibility copy", "Commercial-consent scope"]);
  await expect(reply).not.toContainText("**");
  // The turn's results fill the workspace: the campaign under Salesforce, and context cards.
  const workspace = page.getByRole("complementary", { name: "Workspace" });
  const campaign = workspace.getByTestId("workspace-record").first();
  await expect(campaign).toContainText("Fall Loyalty Reactivation");
  await expect(campaign).toContainText("Opened");
  await expect(campaign.getByRole("link", { name: /Open in Salesforce/ })).toHaveAttribute(
    "href",
    "https://pu1788182184076.my.salesforce.com/lightning/r/Campaign/701jV000004GglIQAS/view",
  );
  await expect(workspace.getByTestId("tile-readiness")).toContainText("Salesforce · local fixture");
  await expect(workspace.getByTestId("tile-campaign-summary")).toBeVisible();
  await workspace.screenshot({
    path: `artifacts/evidence/WU-035/workspace-${testInfo.project.name}.png`,
  });
  await expect(page.getByText("Restaurant data")).toBeVisible();
  await expect(page.getByText("Weather · Open-Meteo")).toBeVisible();
  // Locally there are no Neo4j secrets, so the rail reports the in-memory demo copy.
  await expect(page.getByText("Knowledge graph · demo copy")).toBeVisible();
  const trace = page.locator(".execution-trace").last();
  await trace.getByText("Behind the scenes · technical trace").click();
  for (const label of [
    "Turn started",
    "Step 1 started",
    "Reasoning started",
    /Reasoning ended in/,
    "Text started",
    /Text ended in/,
    "Turn completed",
  ])
    await expect(trace.getByText(label, { exact: typeof label === "string" })).toBeVisible();
  await trace.getByText("Model reasoning").click();
  await expect(trace.getByText(/answer from the fictional local fixture/i)).toBeVisible();
  await expect(trace.getByText(/personal data are redacted/i)).toBeVisible();
  await trace.screenshot({
    path: `artifacts/evidence/WU-016/technical-trace-detail-${testInfo.project.name}.png`,
  });
  await page.screenshot({
    path: `artifacts/evidence/WU-016/technical-trace-${testInfo.project.name}.png`,
    fullPage: true,
  });
  // The readiness check surfaces a review action card in the chat.
  await page.getByTestId("action-card").first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `artifacts/evidence/WU-038/action-card-${testInfo.project.name}.png`,
  });
  // Hold the request so preparing stays on screen: the card shows it's working right away.
  let releasePrepare = () => {};
  const preparing = new Promise<void>((resolve) => {
    releasePrepare = resolve;
  });
  await page.route("**/agent/suggestions/*/accept", async (route) => {
    await preparing;
    await route.continue();
  });
  await page
    .getByTestId("action-card")
    .filter({ hasText: "Request a review" })
    .getByRole("button", { name: "Prepare review request" })
    .click();
  await expect(page.getByRole("button", { name: "Preparing…" })).toBeDisabled();
  const preparingPanel = page.getByRole("region", { name: "Preparing the confirmation" });
  await expect(preparingPanel).toBeVisible();
  await expect(preparingPanel).toBeInViewport({ ratio: 0.9 });
  await page.screenshot({
    path: `artifacts/evidence/WU-049/prepare-progress-${testInfo.project.name}.png`,
  });
  releasePrepare();
  await expect(page.getByRole("heading", { name: "Create Salesforce review task?" })).toBeVisible();
  await page.unroute("**/agent/suggestions/*/accept");
  await expect(preparingPanel).toHaveCount(0);
  await expect(
    page.locator(".confirmation-card").getByRole("link", { name: /701jV000004GglIQAS/ }),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/evidence/WU-006/confirmation-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const completedReviews = page.getByText("Review request created");
  const completedBefore = await completedReviews.count();
  // Hold the response so the running state stays on screen: the steps show while it works.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/agent/confirmations/execute", async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Confirm create" }).click();
  const running = page.getByRole("region", { name: "Running the confirmed write" });
  await expect(running).toBeVisible();
  await expect(page.getByRole("button", { name: "Working…" })).toBeDisabled();
  await expect(running).toContainText("NorthstarCreateCampaignReviewRequest");
  await expect(running).toBeInViewport({ ratio: 0.9 });
  await page.screenshot({
    path: `artifacts/evidence/WU-048/write-progress-${testInfo.project.name}.png`,
  });
  release();
  await expect.poll(() => completedReviews.count()).toBeGreaterThan(completedBefore);
  await page.unroute("**/agent/confirmations/execute");
  const record = page.getByTestId("write-progress");
  await expect(record).toContainText("Behind the scenes · Review request created · done");
  await expect(page.getByText(/Local fixture read-back/).last()).toBeVisible();
  // The created task joins the workspace as a created record.
  await expect(workspace.getByTestId("workspace-record").first()).toContainText("Created");
  await expect(page.getByRole("link", { name: /Open task in Salesforce/ })).toHaveAttribute(
    "href",
    /\/lightning\/r\/Task\/[a-zA-Z0-9]+\/view$/,
  );
  await page.screenshot({
    path: `artifacts/evidence/WU-006/created-task-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByText("Review the sample campaign readiness").first()).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({
    path: `artifacts/evidence/WU-006/workbench-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("shows an actionable recovery state when Salesforce authorization expires", async ({
  page,
}, testInfo) => {
  await page.route("**/agent/salesforce/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "salesforce",
        label: "Salesforce agents",
        state: "expired",
        toolCount: 0,
        message: "Your Salesforce authorization expired. Reconnect to continue.",
        errorCode: "AUTH_REQUIRED",
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByText("Your Salesforce authorization expired.")).toBeVisible();
  await expect(page.getByText("expired", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
  await page.screenshot({
    path: `artifacts/evidence/WU-006/oauth-recovery-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("renders the accessible native fallback when the HXL resource is unavailable", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await openSampleCampaign(page);
  const readiness = page.getByTestId("tile-readiness");
  await expect(readiness).toBeVisible();
  await expect(readiness).toHaveAttribute("data-render-mode", "native");
  await expect(readiness).toHaveAttribute(
    "data-hxl-resource",
    "ui://widget/lightningType/c__northstarCampaignReadinessOutput",
  );
  await expect(readiness.getByText("Native fallback")).toBeVisible();
  await expect(readiness.getByRole("heading", { name: "Fall Loyalty Reactivation" })).toBeVisible();
  await page.screenshot({
    path: `artifacts/evidence/WU-006/native-fallback-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("offers a use-case library with data flows and coming-soon scenarios", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use cases" }).first().click();
  const library = page.getByRole("region", { name: "Use cases" });
  await expect(library).toBeVisible();
  await library
    .getByRole("group", { name: "Team" })
    .getByRole("button", { name: /^Service/ })
    .click();
  await library.getByRole("button", { name: /Severe-weather customer impact/ }).click();
  const detail = library.getByRole("article");
  await expect(detail.getByRole("link", { name: /National Weather Service/ })).toBeVisible();
  await expect(detail.getByRole("list", { name: "Data flow" })).toContainText(
    "assess_location_impact",
  );
  const comingSoon = library.getByRole("list", { name: "Coming soon use cases" });
  await expect(comingSoon.locator("[aria-disabled='true']").first()).toBeVisible();
  await expect(comingSoon.getByRole("button")).toHaveCount(0);
  await page.screenshot({
    path: `artifacts/evidence/WU-045/use-cases-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const prompt =
    "There are weather alerts near our San Diego location. Which customers are affected and what should we tell them?";
  await detail.getByRole("button", { name: new RegExp(prompt.slice(0, 40)) }).click();
  await expect(page.getByLabel("Message the orchestrator")).toHaveValue(prompt);
});

test("lists the financial services use cases with their graph tools and live Fed news", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use cases" }).first().click();
  const library = page.getByRole("region", { name: "Use cases" });
  await library
    .getByRole("group", { name: "Team" })
    .getByRole("button", { name: /^Financial services/ })
    .click();
  const available = library.getByRole("list", { name: "Available use cases" });
  await expect(available.getByRole("listitem")).toHaveCount(3);
  await expect(library.getByRole("list", { name: "Coming soon use cases" })).toHaveCount(0);

  await available.getByRole("button", { name: /Market news to pre-approved content/ }).click();
  const detail = library.getByRole("article");
  await expect(detail.getByRole("link", { name: /Federal Reserve press releases/ })).toBeVisible();
  await expect(detail.getByRole("list", { name: "Data flow" })).toContainText(
    "match_news_to_approved_content",
  );

  await available.getByRole("button", { name: /Account plan to grow assets/ }).click();
  await expect(detail).toContainText("Sales · Financial services");
  await expect(detail.getByRole("list", { name: "Data flow" })).toContainText(
    "build_aum_account_plan",
  );
  const prompt = "Build an account plan to grow AUM with Cedar Valley Community Foundation";
  await detail.getByRole("button", { name: new RegExp(prompt) }).click();
  await expect(page.getByLabel("Message the orchestrator")).toHaveValue(prompt);
});

test("checks inventory against the forecast and opens a store-manager case only after confirmation", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New chat" }).click();
  await page
    .getByLabel("Message the orchestrator")
    .fill("Check inventory for our Sacramento store against the forecast");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    "Inventory check for Coastline Kitchen Sacramento",
  );
  const workspace = page.getByRole("complementary", { name: "Workspace" });
  await expect(workspace.getByText("Store inventory · randomized mock")).toBeVisible();
  await expect(workspace.getByText("Inventory risk")).toBeVisible();
  const card = page.getByTestId("action-card").filter({ hasText: "Tom Okafor" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Review case" }).click();
  const confirmation = page.locator(".confirmation-card");
  await expect(
    confirmation.getByRole("heading", { name: "Open a Salesforce case for the store manager?" }),
  ).toBeVisible();
  await expect(confirmation.getByRole("table")).toContainText("Needed");
  await expect(confirmation).toContainText("Create Case");
  await page.screenshot({
    path: `artifacts/evidence/WU-047/inventory-case-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await confirmation.getByRole("button", { name: "Confirm case" }).click();
  await expect(page.getByText("Case 00001001 opened for Tom Okafor")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open case in Salesforce/ })).toHaveAttribute(
    "href",
    /\/lightning\/r\/Case\/500000000000001\/view$/,
  );
  await expect(workspace.getByTestId("workspace-record").first()).toContainText("Created");
});

test("routes chat write requests to the confirmation flow without claiming a write", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New chat" }).click();
  await page.getByLabel("Message the orchestrator").fill("Save this campaign now");
  await page.getByRole("button", { name: "Send message" }).click();
  const reply = page.locator(".message.assistant").last();
  await expect(reply).toContainText("nothing has been saved or created");
  await expect(reply).not.toContainText(/has been saved and/i);
  const trace = reply.locator(".execution-trace");
  await trace.getByText("Behind the scenes · technical trace").click();
  await expect(trace.getByText(/policy router without a model call/i)).toBeVisible();
  await page.getByLabel("Message the orchestrator").fill("Publish and send the campaign");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("I didn't take it");
  await page.screenshot({
    path: `artifacts/evidence/WU-019/policy-route-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("attaches a selected image draft only after an explicit confirmation", async ({
  page,
}, testInfo) => {
  const imageId = "3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b";
  const contentHash = "a".repeat(64);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const confirmation = {
    id: "0e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b",
    action: "attach-generated-image",
    recordId: "701jV000004GglIQAS",
    imageId,
    contentHash,
    principalSubject: "local-evaluator",
    requestHash: "b".repeat(64),
    idempotencyKey: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
    summary: "Attach the selected email image draft to the campaign as a Salesforce file.",
    expiresAt,
    status: "pending",
  };
  let attachRequest: unknown;
  await page.route("**/agent/images/generate", (route) =>
    route.fulfill({
      status: 201,
      json: {
        id: imageId,
        campaignId: "701jV000004GglIQAS",
        imageUrl: `/agent/images/${imageId}`,
        promptSummary: "A quiet trailhead at golden hour",
        channel: "email",
        width: 1024,
        height: 1024,
        contentHash,
        model: "@cf/black-forest-labs/flux-2-klein-4b",
        lifecycle: "draft",
        expiresAt,
      },
    }),
  );
  await page.route(`**/agent/images/${imageId}`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
  await page.route("**/agent/confirmations", (route) => {
    attachRequest = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: confirmation });
  });
  await page.route("**/agent/confirmations/execute", (route) =>
    route.fulfill({
      status: 200,
      json: {
        confirmation: { ...confirmation, status: "executed" },
        result: {
          source: "salesforce",
          recordId: "069jV000000AbCdQAK",
          contentVersionId: "068jV000000AbCdQAK",
          campaignId: "701jV000004GglIQAS",
          title: "Northstar email campaign image",
          contentSize: 1_482_113,
          contentHash,
          readBack: true,
        },
      },
    }),
  );

  await page.goto("/");
  await openSampleCampaign(page);
  await page.locator(".image-workflow-summary").click();
  await page.getByRole("button", { name: "Generate draft" }).click();
  await page.getByRole("button", { name: "Attach to campaign" }).click();
  expect(attachRequest).toEqual({
    action: "attach-generated-image",
    recordId: "701jV000004GglIQAS",
    imageId,
  });
  const card = page.locator(".confirmation-card");
  await expect(
    card.getByRole("heading", { name: "Attach image to the Salesforce campaign?" }),
  ).toBeVisible();
  await expect(card.getByRole("img", { name: /Draft to attach/ })).toBeVisible();
  await expect(card.getByText(contentHash.slice(0, 16))).toBeVisible();
  await card.getByRole("button", { name: "Confirm attach" }).click();
  const banner = page.locator(".success-banner");
  await expect(banner.getByText("Image attached to the campaign")).toBeVisible();
  await expect(banner.getByRole("link", { name: /Open file in Salesforce/ })).toHaveAttribute(
    "href",
    "https://pu1788182184076.my.salesforce.com/lightning/r/ContentDocument/069jV000000AbCdQAK/view",
  );
  await expect(page.getByText("Attached to the campaign", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach to campaign" })).toHaveCount(0);
  await page.screenshot({
    path: `artifacts/evidence/WU-020/image-attached-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("shows an honest empty state before any evaluation run is published", async ({ page }) => {
  // Production serves the app shell for unknown paths, so a missing report arrives as HTML.
  await page.route("**/evals/latest.json", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Evaluations" }).first().click();
  await expect(page.getByRole("heading", { name: "Evaluations" })).toBeVisible();
  await expect(page.getByText("No evaluation run has been published yet.")).toBeVisible();
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await expect(page.getByRole("heading", { name: "Campaign intelligence" })).toBeVisible();
});

test("renders model comparison, checks, scenarios, failures, and methodology", async ({
  page,
}, testInfo) => {
  // Synthetic rendering fixture only; published results come from pnpm eval:live.
  const checks = {
    toolCorrect: true,
    textProduced: true,
    noToolErrors: true,
    noFalseWriteClaim: true,
  };
  const result = (model: string, passed: boolean, trial: number) => ({
    model,
    suite: "demo-scenarios",
    caseId: "demo-summary",
    prompt: "Summarize the sample campaign and its recent performance",
    expected: "summarize_campaign",
    trial,
    route: "model",
    toolCalled: passed ? "summarize_campaign" : null,
    checks: { ...checks, toolCorrect: passed, textProduced: passed },
    passed,
    latencyMs: 8000,
    inputTokens: 1200,
    outputTokens: 300,
    steps: passed ? "tool-calls,stop" : "tool-calls,length",
    excerpt: passed ? "VERO Phase 1 Launch is in progress." : "",
    cost: { usd: 0.002, neurons: 182 },
    ...(passed ? {} : { failure: "toolCorrect, textProduced" }),
  });
  const rates = (value: number) =>
    Object.fromEntries(Object.keys(checks).map((check) => [check, value]));
  const summary = (model: string, suite: string, passed: number) => ({
    model,
    suite,
    passed,
    total: 2,
    checkRates: rates(passed / 2),
    latencyP50Ms: 8000,
    latencyP90Ms: 12000,
    meanOutputTokens: 300,
    costUsd: 0.004,
    costPerTurnUsd: 0.002,
    ...(suite === "demo-scenarios"
      ? {
          qualityIndex: { mean: 72, ciLow: 64, ciHigh: 80, n: 2 },
          actionIntentTop2: 0.5,
          criteriaMetRate: 0.8,
        }
      : {}),
  });
  const suites = ["demo-scenarios", "routing-pipeline", "routing-model-only"];
  await page.route("**/evals/latest.json", (route) =>
    route.fulfill({
      json: {
        generatedAt: "2026-09-26T01:00:00.000Z",
        gitSha: "abcdef1",
        productionModel: "@cf/openai/gpt-oss-120b",
        methodology: {
          summary: "Synthetic methodology summary.",
          pipeline: ["Policy router step."],
          toolResults: "Fixture tool results.",
          suites: suites.map((id) => ({
            id,
            label: `Suite ${id}`,
            description: "Desc.",
            trials: 2,
          })),
          checks: Object.keys(checks).map((id) => ({
            id,
            label: `Check ${id}`,
            definition: "Def.",
          })),
          limitations: ["Synthetic limitation."],
        },
        cost: {
          contestantsUsd: 0.008,
          judgesUsd: 0.05,
          simulatorUsd: 0.001,
          totalUsd: 0.059,
          neurons: 5364,
          pricingAsOf: "2026-09-17",
          pricingSource: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
        },
        models: [
          { id: "@cf/openai/gpt-oss-120b", label: "gpt-oss-120b", included: true },
          { id: "@cf/openai/gpt-oss-20b", label: "gpt-oss-20b", included: true },
          { id: "@cf/moonshotai/kimi-k2.6", label: "Kimi K2.6", included: false, note: "Errored." },
        ],
        summaries: suites.flatMap((suite) => [
          summary("@cf/openai/gpt-oss-120b", suite, 2),
          summary("@cf/openai/gpt-oss-20b", suite, 1),
        ]),
        results: [
          result("@cf/openai/gpt-oss-120b", true, 0),
          result("@cf/openai/gpt-oss-120b", true, 1),
          result("@cf/openai/gpt-oss-20b", true, 0),
          result("@cf/openai/gpt-oss-20b", false, 1),
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Evaluations" }).first().click();
  const models = page.locator(".evaluation-card", {
    has: page.getByRole("heading", { name: "Model comparison" }),
  });
  await expect(models.getByText("In production")).toBeVisible();
  await expect(models.getByRole("row", { name: /gpt-oss-20b/ })).toContainText("50%");
  await expect(models.getByRole("columnheader", { name: "Est. USD per turn" })).toBeVisible();
  await expect(models.getByRole("columnheader", { name: "Est. USD per pass" })).toBeVisible();
  // Tokens (input plus output) and tool calls per turn are averaged.
  await expect(models.getByRole("row", { name: /gpt-oss-120b/ })).toContainText(
    "1,500 tokens1 tool call",
  );
  await expect(models.getByRole("row", { name: /gpt-oss-20b/ })).toContainText(
    "1,500 tokens0.5 tool calls",
  );
  await expect(models.getByRole("row", { name: /gpt-oss-120b/ })).toContainText("72 ±8");
  await expect(models.getByRole("row", { name: /gpt-oss-120b/ })).toContainText("$0.0020");
  await expect(page.getByText(/run cost \$0\.059/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cost vs quality" })).toBeVisible();
  await expect(page.getByText("Kimi K2.6 not evaluated: Errored.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Failed turns .*\(1\)/ })).toBeVisible();
  await page.getByText("called no tool").click();
  await expect(page.getByText("tool-calls,length")).toBeVisible();
  await expect(page.getByText("8.0s · 1,500 tokens · 0 tool calls")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Methodology" })).toBeVisible();
  await page.getByRole("button", { name: "Suite routing-model-only" }).click();
  await expect(page.getByRole("button", { name: "Suite routing-model-only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await models.screenshot({
    path: `artifacts/evidence/WU-072/evaluations-${testInfo.project.name}.png`,
  });
});

test("records each turn with its interpretation, reasoning, and outcome in history", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New chat" }).click();
  const composer = page.getByLabel("Message the orchestrator");
  await composer.fill("Review the sample campaign readiness");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/strongest signal is stable engagement/i).last()).toBeVisible();
  await composer.fill("Publish and send the campaign");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("I didn't take it");

  await page.getByRole("button", { name: "History" }).first().click();
  await expect(page.getByRole("heading", { name: "Turn history" })).toBeVisible();
  // History is per user and survives New chat, so earlier tests' turns may also be listed.
  const blocked = page
    .locator(".history-turn", { hasText: "Publish and send the campaign" })
    .first();
  await expect(blocked.getByText("Blocked action", { exact: true })).toBeVisible();
  const reviewed = page
    .locator(".history-turn", { hasText: "Review the sample campaign readiness" })
    .first();
  await expect(reviewed.getByText("Local fixture", { exact: true })).toBeVisible();
  // A turn's seconds come with its tokens and tool calls.
  await expect(reviewed.locator("summary").first()).toContainText(
    /\d+\.\ds · [\d,]+ tokens? · \d+ tool calls?/,
  );
  await reviewed.locator("summary").first().click();
  await expect(reviewed.getByText(/answered from the fictional fixture/i)).toBeVisible();
  await reviewed.getByText("Show reasoning").click();
  await expect(reviewed.getByText(/results also fill the workspace/i)).toBeVisible();
  await expect(reviewed.locator(".history-answer")).toContainText("strongest signal");

  await page.getByRole("button", { name: "Policy routed" }).click();
  await expect(page.locator(".history-turn", { hasText: "Review the sample" })).toHaveCount(0);
  await expect(blocked).toBeVisible();
  await page.screenshot({
    path: `artifacts/evidence/WU-022/turn-history-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("reflects operator kill switches and offers the audit export", async ({ page }, testInfo) => {
  await page.route("**/agent/operations", (route) =>
    route.fulfill({ json: { writesEnabled: false, memoryEnabled: true, disabledTools: [] } }),
  );
  await page.goto("/");
  await expect(page.getByText(/Salesforce writes are paused by an operator/)).toBeVisible();

  await page.screenshot({
    path: `artifacts/evidence/WU-023/writes-paused-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "History" }).first().click();
  await expect(page.getByRole("link", { name: "Export audit (JSON)" })).toHaveAttribute(
    "href",
    "/agent/audit/export",
  );
});

test("reviews persisted image variants and rejects one so it cannot be attached", async ({
  page,
}, testInfo) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const variant = (id: string, promptSummary: string) => ({
    id,
    campaignId: "701jV000004GglIQAS",
    imageUrl: `/agent/images/${id}`,
    promptSummary,
    channel: "email",
    width: 1024,
    height: 1024,
    contentHash: "c".repeat(64),
    model: "@cf/black-forest-labs/flux-2-klein-4b",
    lifecycle: "draft",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const newest = variant("11111111-2222-4333-8444-555555555555", "Sunrise over a ridge trail");
  const older = variant("66666666-7777-4888-8999-000000000000", "Campfire with gear laid out");
  let rejected = "";
  await page.route("**/agent/images?campaignId=*", (route) =>
    route.fulfill({ json: { images: [newest, older] } }),
  );
  await page.route(/\/agent\/images\/[a-f0-9-]{36}$/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
  await page.route(/\/agent\/images\/[a-f0-9-]{36}\/reject$/, (route) => {
    rejected = route.request().url().split("/").at(-2) ?? "";
    return route.fulfill({ json: { id: rejected, lifecycle: "rejected" } });
  });

  await page.goto("/");
  await openSampleCampaign(page);
  await page.locator(".image-workflow-summary").click();
  const gallery = page.getByRole("group", { name: "Variants (2)" });
  await expect(gallery.getByRole("button")).toHaveCount(2);
  await expect(page.locator(".generated-image-summary")).toHaveText("Sunrise over a ridge trail");
  await gallery.getByRole("button", { name: /Campfire with gear laid out/ }).click();
  await expect(page.locator(".generated-image-summary")).toHaveText("Campfire with gear laid out");
  await page.getByRole("button", { name: "Reject variant" }).click();
  expect(rejected).toBe(older.id);
  await expect(gallery.getByRole("button", { name: /Campfire.*\(rejected\)/ })).toBeVisible();
  await gallery.getByRole("button", { name: /Campfire/ }).click();
  await expect(page.getByRole("button", { name: "Attach to campaign" })).toHaveCount(0);
  await expect(page.getByText("Rejected variant")).toBeVisible();
  await page.screenshot({
    path: `artifacts/evidence/WU-024/image-variants-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("explains context, GraphRAG, and every demo concept on the Learn page", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Learn" }).first().click();
  await expect(page.getByRole("heading", { name: /Learn: context, GraphRAG/ })).toBeVisible();
  const toc = page.getByRole("navigation", { name: "Learn contents" });
  await toc.getByRole("button", { name: "GraphRAG", exact: true }).click();
  await expect(page.getByRole("heading", { name: "GraphRAG", exact: true })).toBeInViewport();
  const graphSection = page.locator("#learn-graphrag-here");
  await expect(
    graphSection.getByRole("table").or(graphSection.getByRole("list")).first(),
  ).toBeVisible();
  const resource = page.getByRole("link", { name: /From Local to Global/ });
  await expect(resource).toHaveAttribute("target", "_blank");
  await expect(resource).toHaveAttribute("rel", "noopener noreferrer");
  await toc.getByRole("button", { name: "Glossary" }).click();
  const glossary = page.locator("#learn-glossary");
  await expect(glossary.getByText("Tool plan", { exact: true })).toBeVisible();
  await glossary.getByLabel("Filter the glossary").fill("cypher");
  await expect(glossary.getByText("Tool plan", { exact: true })).toBeHidden();
  // The reference lists every concept in the code and links it to the lesson that teaches it.
  await toc.getByRole("button", { name: "Reference", exact: true }).click();
  const reference = page.locator("#learn-reference");
  await expect(reference.getByText("recall_decisions", { exact: true })).toBeVisible();
  await reference.getByRole("button", { name: /^Graph relationships/ }).click();
  await expect(reference.getByText("DECIDED_ON", { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await reference.getByText("DECIDED_ON", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `artifacts/evidence/WU-039/learn-reference-${testInfo.project.name}.png`,
  });
  await reference.getByLabel("Search the reference").fill("MEMORY_ENABLED");
  await reference
    .getByRole("button", { name: /Long-term memory: remembering across chats/ })
    .click();
  await expect(page.locator("#learn-long-term-memory")).toBeInViewport();
  // Jumping scrolls the Learn view, never the page, so the top bar stays visible.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("heading", { name: "Marketing workbench" })).toBeInViewport();
  // Lessons can be marked read, and progress shows in the contents and the hero.
  const firstLesson = page.locator("#learn-what-is-context");
  await firstLesson.getByRole("button", { name: "Mark as read" }).click();
  await expect(firstLesson.getByRole("button", { name: "Read" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("progressbar", { name: "Lessons read" })).toHaveAttribute(
    "aria-valuenow",
    /[1-9]/,
  );
  // The quick check explains the answer.
  const check = page.locator(".learn-check").first();
  await check.getByLabel("The recent conversation and a summary of the workspace").check();
  await expect(check.getByText(/Correct\./)).toBeVisible();
  await toc.getByRole("button", { name: "Primer: RAG and GraphRAG" }).click();
  await expect(page.getByRole("heading", { name: "RAG in one page" })).toBeInViewport();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `artifacts/evidence/WU-034/learn-${testInfo.project.name}.png` });
  // "Try it" puts a prompt in the composer on the workspace.
  await page
    .locator("#learn-graphrag-here")
    .getByRole("button", { name: /Ask a graph question/ })
    .click();
  await expect(page.getByLabel("Message the orchestrator")).toHaveValue(
    "Who should be in the buyer group for Acme Outfitters, and why?",
  );
});

test("answers a 'create it' follow-up through the confirmation policy", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New chat" }).click();
  const composer = page.getByLabel("Message the orchestrator");
  await composer.fill("Review the sample campaign readiness");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/strongest signal is stable engagement/i).last()).toBeVisible();
  await composer.fill("Looks good, create it");
  await page.getByRole("button", { name: "Send message" }).click();
  const reply = page.locator(".message.assistant").last();
  await expect(reply).toContainText("nothing has been saved or created");
  await expect(reply).toContainText("confirmation card");
});

test("explores the knowledge graph with tours, search, and expansion", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /^\W*Graph$/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Graph explorer" })).toBeVisible();
  await expect(page.getByText("339", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Knowledge graph drawing with 339 nodes/ }),
  ).toBeVisible();

  // The rain tour expands the weather node and summarizes what worked.
  await page.getByRole("button", { name: /What worked in the rain/ }).click();
  const details = page.getByRole("complementary", { name: "Node details" });
  await expect(details.getByRole("heading", { name: "rain", exact: true })).toBeVisible();
  await expect(details.getByText(/Loaded 60 of \d+ connections/)).toBeVisible();
  await expect(details.getByText("What the graph says")).toBeVisible();
  await expect(page.getByText("399", { exact: true })).toBeVisible();

  // Search reaches every loaded node without the canvas.
  await page.getByLabel("Find a node").fill("fall loyalty");
  await page
    .getByRole("list", { name: "Matching nodes" })
    .getByRole("button", { name: /Fall Loyalty Reactivation\s*Campaign/ })
    .click();
  await expect(details.getByRole("heading", { name: "Fall Loyalty Reactivation" })).toBeVisible();
  await details.getByRole("button", { name: /Fall Loyalty Reactivation brief/ }).click();
  await expect(
    details.getByRole("heading", { name: "Fall Loyalty Reactivation brief" }),
  ).toBeVisible();

  // Node types toggle off and back on.
  const personas = page.getByRole("button", { name: /^Persona/ });
  await personas.click();
  await expect(personas).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("img", { name: /with 311 nodes/ })).toBeVisible();
  await personas.click();

  await page.getByRole("button", { name: /A failed brand check/ }).click();
  await expect(details.getByText("Brand rule", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("button", { name: /What worked in the rain/ }).click();
  // Let the layout and camera settle before the evidence screenshot.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `artifacts/evidence/WU-033/graph-${testInfo.project.name}.png` });
});

test("filters the graph explorer to one brand's own nodes", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /^\W*Graph$/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Graph explorer" })).toBeVisible();
  const all = page.getByRole("button", { name: "All brands", exact: true });
  const coastline = page.getByRole("button", { name: "Coastline Kitchen", exact: true });
  const northstar = page.getByRole("button", { name: "Northstar", exact: true });
  await expect(all).toHaveAttribute("aria-pressed", "true");

  await coastline.click();
  await expect(coastline).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/loaded nodes connect to Coastline Kitchen/)).toContainText(
    "Northstar, its parent brand, is hidden",
  );
  await expect(
    page.getByRole("img", { name: /Knowledge graph drawing with 83 nodes/ }),
  ).toBeVisible();

  // Search only reaches nodes in scope.
  await page.getByLabel("Find a node").fill("acme");
  await expect(page.getByText(/No loaded node matches/)).toBeVisible();
  await page.getByLabel("Find a node").fill("coastline weather");
  await page
    .getByRole("list", { name: "Matching nodes" })
    .getByRole("button", { name: "Coastline Weather Moments Campaign" })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Node details" }).getByRole("heading", {
      name: "Coastline Weather Moments",
    }),
  ).toBeVisible();

  // A tour outside the filtered brand clears it back to all brands.
  await page.getByRole("button", { name: /Who a campaign reaches/ }).click();
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("img", { name: /Knowledge graph drawing with 339 nodes/ }),
  ).toBeVisible();

  await northstar.click();
  await expect(northstar).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("img", { name: /Knowledge graph drawing with 115 nodes/ }),
  ).toBeVisible();

  // Harborstone Wealth keeps its regulated content, deal, and clients, not Coastline's menu.
  const harborstone = page.getByRole("button", { name: "Harborstone Wealth", exact: true });
  await harborstone.click();
  await expect(
    page.getByRole("img", { name: /Knowledge graph drawing with 158 nodes/ }),
  ).toBeVisible();
  await page.getByLabel("Find a node").fill("cedar valley");
  await expect(
    page
      .getByRole("list", { name: "Matching nodes" })
      .getByRole("button", { name: "Cedar Valley Community Foundation Client" }),
  ).toBeVisible();
  await page.getByLabel("Find a node").fill("tortilla");
  await expect(page.getByText(/No loaded node matches/)).toBeVisible();
});

test("has the Marketing Cloud agent save the brief, then create the campaign and its flow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText("Nothing in this chat yet")).toBeVisible();
  const composer = page.getByLabel("Message the orchestrator");
  const focus = page.getByTestId("workspace-focus");

  // The Campaign Creation agent drafts the brief; it becomes the focus.
  await composer.fill("Draft a push notification for Coastline Kitchen's lunch crowd");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    "Northstar Campaign Creation",
  );
  await expect(focus).toContainText("Rainy-day comfort: Spicy Tortilla Soup");
  await expect(focus).toContainText("Brief");
  await expect(focus).toContainText("Rain outside? Soup's on.");
  await expect(focus).toContainText("Version 1 · current");

  await composer.fill("Make it warmer");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(focus).toContainText("Rain outside? Warm soup is waiting.");
  await expect(focus).toContainText("Version 2 · current · Make it warmer");
  await focus.getByRole("button", { name: "v1" }).click();
  await expect(focus).toContainText("Rain outside? Soup's on.");
  await focus.getByRole("button", { name: /v2/ }).click();

  // Asking to create it prepares the agent's save, with a permission check and agent details.
  await composer.fill("Looks good, create it");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("Ready to confirm");
  const card = page.locator(".confirmation-card");
  await expect(card.getByRole("heading", { name: "Save brief in Marketing Cloud?" })).toBeVisible();
  await expect(card).toContainText(
    "Save the brief “Rainy-day comfort: Spicy Tortilla Soup” in Marketing Cloud",
  );
  await expect(card).toContainText("Rain outside? Warm soup is waiting.");
  await expect(card).toContainText("Marketing Cloud Next Campaign Creation agent");
  await expect(card).toContainText("MktCloud__CampaignCreationAgent");
  await expect(card).toContainText("Marketing Cloud: Save Campaign Brief");
  await expect(card).toContainText("Marketing Cloud: Draft a Campaign Preview");
  const permissions = card.getByRole("region", { name: "Salesforce permission check" });
  await expect(permissions).toContainText("Create Brief");
  await permissions.getByText("Who checks what").click();
  await expect(permissions).toContainText("never creates briefs or campaigns itself");
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `artifacts/evidence/WU-040/confirm-brief-${testInfo.project.name}.png`,
  });
  await card.getByRole("button", { name: "Confirm save" }).click();
  const banner = page.locator(".success-banner");
  await expect(banner.getByText("Brief saved in Marketing Cloud")).toBeVisible();
  await expect(banner).toContainText("By the Northstar Campaign Creation agent");

  // The workspace shows the brief and its preview as Salesforce read them back.
  const records = page.getByTestId("workspace-record");
  await expect(records.filter({ hasText: "Rainy-day comfort" })).toContainText("Created");
  await expect(focus).toContainText("Brief saved in Marketing Cloud");
  await expect(focus).toContainText("Campaign preview · 2 steps");
  await expect(focus.getByRole("link", { name: /Open Brief in Salesforce/ })).toHaveAttribute(
    "href",
    /\/lightning\/r\/Brief\/21y000000000\d{3}\/view$/,
  );

  // Then the agent creates the campaign and its flow from the saved brief.
  await page.getByTestId("action-card").getByRole("button", { name: "Review campaign" }).click();
  await expect(
    card.getByRole("heading", { name: "Create the campaign in Marketing Cloud?" }),
  ).toBeVisible();
  await expect(card).toContainText("Marketing Cloud: Create Campaign");
  await expect(card).toContainText("Marketing Cloud: Save Campaign");
  await card.getByRole("button", { name: "Confirm create" }).click();
  await expect(banner.getByText("Campaign and flow created in Marketing Cloud")).toBeVisible();
  await expect(focus).toContainText("Campaign created in Marketing Cloud");
  await expect(focus).toContainText("Campaign Flow");
  await expect(records.filter({ hasText: "Campaign Flow" })).toContainText("Created");

  // A change now refines the saved campaign preview through the agent.
  await composer.fill("Make it warmer");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    "refined the campaign preview",
  );
  await page.getByRole("complementary", { name: "Workspace" }).screenshot({
    path: `artifacts/evidence/WU-040/campaign-created-${testInfo.project.name}.png`,
  });
});

test("remembers a draft, recalls it in a new chat, and forgets it", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New chat" }).click();
  const composer = page.getByLabel("Message the orchestrator");
  const send = page.getByRole("button", { name: "Send message" });
  await composer.fill("Draft a push notification for Coastline Kitchen's lunch crowd");
  await send.click();
  await expect(page.getByTestId("workspace-focus")).toContainText(
    "Rainy-day comfort: Spicy Tortilla Soup",
  );

  // The server remembers the draft; the model never writes memory.
  await composer.fill("Remember this draft");
  await send.click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    /remembered \*?\*?Rainy-day comfort: Spicy Tortilla Soup/i,
  );

  // A new chat starts empty, but the workspace still remembers.
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText("Nothing in this chat yet")).toBeVisible();
  await composer.fill("What did we decide about the rainy-day comfort push?");
  await send.click();
  const answer = page.locator(".message.assistant").last();
  await expect(answer).toContainText("Rainy-day comfort: Spicy Tortilla Soup");
  await expect(answer).toContainText("Remembered from the chat");
  await expect(answer).toContainText(/re-check Salesforce/);
  await page.screenshot({
    path: `artifacts/evidence/WU-039/recall-${testInfo.project.name}.png`,
    fullPage: true,
  });

  // Reopen puts the remembered draft back in this chat's workspace as the focus.
  await expect(page.getByTestId("workspace-focus")).toHaveCount(0);
  await page.getByRole("button", { name: "History" }).first().click();
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await page
    .getByRole("button", { name: "Reopen Rainy-day comfort: Spicy Tortilla Soup in the workspace" })
    .first()
    .click();
  await expect(page.getByTestId("workspace-focus")).toContainText(
    "Rainy-day comfort: Spicy Tortilla Soup",
  );
  await expect(page.getByTestId("workspace-focus")).toContainText("Reopened from memory");
  await page.screenshot({
    path: `artifacts/evidence/WU-046/reopen-${testInfo.project.name}.png`,
    fullPage: true,
  });

  // History → Memory lists it with its provenance, and Forget removes it.
  await page.getByRole("button", { name: "History" }).first().click();
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Memory" })).toBeVisible();
  const item = page
    .locator(".memory-item", { hasText: "Rainy-day comfort: Spicy Tortilla Soup" })
    .first();
  await expect(item).toContainText("Remembered from the chat");
  await expect(item).toContainText(/expires in 1[34] days/);
  await expect(item.getByText("About", { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: `artifacts/evidence/WU-039/memory-tab-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const before = await page.locator(".memory-item").count();
  await item.getByRole("button", { name: /^Forget / }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Forgot/ })).toBeVisible();
  await expect(page.locator(".memory-item")).toHaveCount(before - 1);
});
