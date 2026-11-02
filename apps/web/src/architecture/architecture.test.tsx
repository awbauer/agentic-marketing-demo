import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeBar } from "../ScopeBar";
import { ScopeProvider } from "../scope";
import { ArchitectureView } from "./ArchitectureView";

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

  it("explains a gateway denial instead of failing silently", async () => {
    renderView();
    await screen.findByText("The lifecycle");
    fireEvent.click(screen.getByRole("tab", { name: "Approvals" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No policy grants this.");
    expect(alert.textContent).toContain("Not allowed");
  });
});
