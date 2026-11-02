import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArchitectureView } from "./ArchitectureView";

afterEach(() => {
  cleanup();
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

describe("architecture view", () => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  beforeEach(() => {
    requests.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
        if (url.endsWith("/session"))
          return Response.json({
            persona: "marketer",
            personas: [
              { id: "marketer", label: "Marketer" },
              { id: "reviewer", label: "MLR-style reviewer" },
            ],
            role: "evaluator",
          });
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
    render(<ArchitectureView onClose={() => undefined} />);
    expect(await screen.findByText("The lifecycle")).toBeTruthy();
    const card = screen.getByRole("button", { name: /Put idle cash to work/ });
    expect(within(card).getByText("needs refresh")).toBeTruthy();
    expect(screen.getByText("23")).toBeTruthy();
  });

  it("sends the chosen persona with every request", async () => {
    render(<ArchitectureView onClose={() => undefined} />);
    await screen.findByText("The lifecycle");
    expect(requests.at(-1)?.headers["x-persona"]).toBe("marketer");
    fireEvent.change(await screen.findByLabelText("Act as"), { target: { value: "reviewer" } });
    await waitFor(() =>
      expect(requests.some((request) => request.headers["x-persona"] === "reviewer")).toBe(true),
    );
  });

  it("explains a gateway denial instead of failing silently", async () => {
    render(<ArchitectureView onClose={() => undefined} />);
    await screen.findByText("The lifecycle");
    fireEvent.click(screen.getByRole("tab", { name: "Approvals" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No policy grants this.");
    expect(alert.textContent).toContain("Not allowed");
  });
});
