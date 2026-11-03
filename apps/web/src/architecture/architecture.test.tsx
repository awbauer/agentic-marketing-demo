import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeBar } from "../ScopeBar";
import { ScopeProvider } from "../scope";
import { AgentForm, FORMS } from "./AgentConsole";
import { ArchitectureView } from "./ArchitectureView";
import { SampleFlows } from "./SampleFlows";

const renderView = () =>
  render(
    <ScopeProvider>
      <ScopeBar />
      <ArchitectureView onClose={() => undefined} />
    </ScopeProvider>,
  );

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const row = (over: Record<string, unknown> = {}) => ({
  urn: "urn:northstar:module:m1",
  kind: "module",
  title: "Put idle cash to work",
  brand: "Harborstone Wealth",
  state: "approved",
  owner: "content-lab",
  updatedAt: new Date().toISOString(),
  version: 1,
  stage: "create",
  flags: ["needs refresh"],
  allowed: [],
  waitingOn: null,
  ...over,
});

const workspace = {
  manifest: {
    id: "command-center",
    title: "Command Center",
    summary: "Every object by stage.",
    agents: ["a"],
    services: ["s"],
  },
  persona: "marketer",
  tiles: [
    {
      id: "counts",
      title: "At a glance",
      type: "metrics",
      metrics: [{ label: "Objects", value: "23" }],
    },
    {
      id: "board",
      title: "The lifecycle",
      type: "stage-board",
      stages: [{ stage: "create", label: "Create", owner: "Content Lab", rows: [row()] }],
    },
  ],
};

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
};
beforeEach(() =>
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true }),
);

describe("architecture view", () => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  beforeEach(() => {
    requests.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
        if (url === "/api/session") return Response.json({ principal: { role: "evaluator" } });
        if (url.includes("/workspaces/approvals"))
          return Response.json(
            { error: { code: "DENIED", message: "No policy grants this." } },
            { status: 403 },
          );
        if (url.includes("/workspaces/")) return Response.json(workspace);
        return Response.json({}, { status: 404 });
      }),
    );
  });

  it("draws a workspace manifest and flags what needs attention", async () => {
    renderView();
    expect(await screen.findByText("The lifecycle")).toBeTruthy();
    const card = screen.getByRole("button", { name: /Put idle cash to work/ });
    expect(within(card).getByText("needs refresh")).toBeTruthy();
    expect(screen.getByText("23")).toBeTruthy();
  });

  it("sends the chosen persona with every request", async () => {
    renderView();
    await screen.findByText("The lifecycle");
    expect(requests.at(-1)?.headers["x-persona"]).toBe("marketer");
    // The role is chosen once, in the header, and the view follows it.
    fireEvent.change(await screen.findByLabelText("Run as"), { target: { value: "reviewer" } });
    await waitFor(() =>
      expect(requests.some((request) => request.headers["x-persona"] === "reviewer")).toBe(true),
    );
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "Lumera Therapeutics" } });
    await waitFor(() =>
      expect(requests.some((request) => request.headers["x-brand"] === "Lumera Therapeutics")).toBe(
        true,
      ),
    );
    expect(window.localStorage.getItem("northstar.scope")).toContain("Lumera Therapeutics");
    expect(screen.getByRole("status").textContent).toContain("MLR-style reviewer");
  });

  it("says what the section is, why it is better, and where the viewer's role comes in", async () => {
    renderView();
    await screen.findByText("The lifecycle");
    expect(
      screen.getByRole("heading", { name: /a brand gets content from plan to proof/ }),
    ).toBeTruthy();
    expect(screen.getByText(/Where you come in, as Marketer/)).toBeTruthy();
    // The Command Center has its own brand field, so change the role first.
    fireEvent.change(screen.getByLabelText("Run as"), { target: { value: "compliance" } });
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "Lumera Therapeutics" } });
    expect(
      await screen.findByRole("heading", { name: /Lumera Therapeutics gets content/ }),
    ).toBeTruthy();
    expect(screen.getByText(/You own the evidence/)).toBeTruthy();
    expect(screen.getByText(/MLR review runs on PDFs/)).toBeTruthy();
    // The role's step is marked, and the view opens on the workspace where that step happens.
    const steps = screen.getByRole("list", { name: /who decides at each/ });
    expect(
      within(steps).getByRole("button", { name: /Substantiate.*You decide here/ }),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Approvals" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    const guide = screen.getByRole("complementary", { name: "About Approvals" });
    expect(guide.textContent).toContain("Cardivance versus every ARB");
    expect(guide.textContent).toContain("Under the hood");
  });

  it("hides the intro for this viewer and brings it back on request", async () => {
    renderView();
    await screen.findByText("The lifecycle");
    fireEvent.click(screen.getByRole("button", { name: "Hide intro" }));
    expect(screen.queryByText(/What you’re looking at/)).toBeNull();
    expect(window.localStorage.getItem("northstar.architecture.intro")).toBe("closed");
    fireEvent.click(screen.getByRole("button", { name: "What is this?" }));
    expect(screen.getByText(/What you’re looking at/)).toBeTruthy();
  });

  it("explains a gateway denial instead of failing silently", async () => {
    renderView();
    await screen.findByText("The lifecycle");
    fireEvent.click(screen.getByRole("tab", { name: "Approvals" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No policy grants this.");
    expect(alert.textContent).toContain("Not allowed");
  });
});

describe("agent forms follow the brand", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ objects: [] })),
    );
  });
  afterEach(cleanup);

  it("offers Lumera in the brand list and defaults to the brand in the header", () => {
    const form = FORMS.plan;
    if (!form) throw new Error("missing form");
    render(
      <AgentForm
        form={form}
        scope={{ persona: "brand-planner", brand: "Lumera Therapeutics" }}
        onDone={() => {}}
        onOpen={() => {}}
      />,
    );
    const select = screen.getByLabelText("Brand") as HTMLSelectElement;
    expect(select.value).toBe("Lumera Therapeutics");
    expect([...select.options].map((option) => option.text)).toEqual([
      "Harborstone Wealth",
      "Coastline Kitchen",
      "Lumera Therapeutics",
    ]);
  });

  it("offers only the header brand's facts to state", () => {
    const form = FORMS.author;
    if (!form) throw new Error("missing form");
    render(
      <AgentForm
        form={form}
        scope={{ persona: "content-lab", brand: "Lumera Therapeutics" }}
        onDone={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByLabelText("cardivance-mortality")).toBeTruthy();
    expect(screen.getByLabelText("glucora-a1c")).toBeTruthy();
    expect(screen.queryByLabelText("sweep-apy")).toBeNull();
  });
});

describe("sample flows", () => {
  const calls: Array<{ url: string; persona: string; body: Record<string, unknown> }> = [];
  const ndjson = (events: unknown[]) =>
    new Response(events.map((event) => JSON.stringify(event)).join("\n"), {
      headers: { "content-type": "application/x-ndjson" },
    });
  const moduleUrn = "urn:northstar:module:m1";
  const allow = { decision: "allow", policyId: "agent-module-authoring", reason: "granted" };
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        calls.push({ url, persona: headers["x-persona"] ?? "", body });
        if (url === "/api/arch/orchestrations")
          return ndjson([
            {
              type: "start",
              id: "flow-1",
              flowId: "lumera-congress",
              model: "@cf/openai/gpt-oss-20b",
              modelReason: "Champion for orchestrate.",
            },
            { type: "note", text: "Write the email from approved claims." },
            {
              type: "delegate",
              callId: "c1",
              agent: "module-authoring",
              name: "Module authoring agent",
              persona: "content-lab",
              task: "Write the email",
              refs: {},
            },
            {
              type: "tool",
              callId: "c1",
              agent: "module-authoring",
              step: { tool: "author_module", input: {}, ok: true, decision: allow },
            },
            {
              type: "delegated",
              callId: "c1",
              agent: "module-authoring",
              ok: true,
              summary: "Wrote it and refused the superiority claim.",
              model: "@cf/openai/gpt-oss-20b",
              latencyMs: 4200,
              tokens: 3000,
              created: [
                { ref: "module-1", urn: moduleUrn, title: "Cardivance outcomes", kind: "module" },
              ],
            },
            {
              type: "await-human",
              moduleUrn,
              title: "Cardivance outcomes",
              why: "It is ready for review.",
              persona: "reviewer",
            },
          ]);
        if (url === "/api/arch/orchestrations/flow-1/continue")
          return ndjson([
            { type: "decided", moduleUrn, state: "approved", persona: "MLR-style reviewer" },
            {
              type: "done",
              summary: "Approved by the reviewer; the superiority claim was refused.",
            },
          ]);
        if (url.includes("/transition")) return Response.json({ card: {} });
        return Response.json({}, { status: 404 });
      }),
    );
  });
  afterEach(cleanup);

  it("shows the orchestrator delegating, waits for the person, then carries on", async () => {
    render(
      <SampleFlows
        scope={{ persona: "marketer", brand: "Lumera Therapeutics" }}
        onOpen={() => {}}
        onChanged={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start the orchestrator" }));
    expect(await screen.findByText("Your decision, as MLR-style reviewer")).toBeTruthy();
    expect(screen.getByText("Write the email from approved claims.")).toBeTruthy();
    expect(screen.getByText("Content Lab")).toBeTruthy();
    expect(screen.getByText(/allowed by agent-module-authoring/)).toBeTruthy();
    expect(screen.getByText("Wrote it and refused the superiority claim.")).toBeTruthy();
    // The orchestrator was started as the header's role, for the flow's brand.
    expect(calls[0]).toMatchObject({ persona: "marketer", body: { flowId: "lumera-congress" } });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("The orchestrator’s wrap-up")).toBeTruthy();
    // The decision is the reviewer's, through the state machine, before the flow resumes.
    const decisions = calls.filter((call) => call.url.includes("/transition"));
    expect(decisions.map((call) => [call.persona, call.body.to])).toEqual([
      ["reviewer", "in_review"],
      ["reviewer", "approved"],
    ]);
    expect(calls.at(-1)?.url).toBe("/api/arch/orchestrations/flow-1/continue");
  });

  it("offers one flow per brand, or all three with no brand chosen", () => {
    render(
      <SampleFlows
        scope={{ persona: "marketer", brand: "all" }}
        onOpen={() => {}}
        onChanged={() => {}}
      />,
    );
    expect(
      within(screen.getByRole("group", { name: "Pick a flow" })).getAllByRole("button"),
    ).toHaveLength(3);
  });
});
