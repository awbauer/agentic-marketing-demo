import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeBar } from "./ScopeBar";
import { ScopeProvider, BRAND_PLACEHOLDER, brandForNode, BRAND_NODE_IDS } from "./scope";
import { USE_CASES, useCaseBrand } from "./usecases/catalog";
import { UseCasesView } from "./usecases/UseCasesView";

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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("brand and role in the header", () => {
  it("limits the use-case library to the chosen brand", () => {
    render(
      <ScopeProvider initial={{ brand: "Lumera Therapeutics", persona: "marketer" }}>
        <UseCasesView onClose={() => undefined} onTryPrompt={() => undefined} />
      </ScopeProvider>,
    );
    const shown = screen.getByRole("list", { name: "Available use cases" }).querySelectorAll("li");
    const expected = USE_CASES.filter(
      (useCase) =>
        useCase.status === "available" && useCaseBrand(useCase) === "Lumera Therapeutics",
    );
    expect(expected.length).toBeGreaterThanOrEqual(3);
    expect(shown).toHaveLength(expected.length);
    expect(screen.getByText(/Showing Lumera Therapeutics use cases/)).toBeTruthy();
  });

  it("maps each brand to its graph node, and Northstar's parent node to all brands", () => {
    for (const [brand, id] of Object.entries(BRAND_NODE_IDS)) expect(brandForNode(id)).toBe(brand);
    expect(brandForNode("brand-northstar")).toBe("all");
    expect(brandForNode(null)).toBe("all");
    expect(BRAND_PLACEHOLDER["Lumera Therapeutics"]).toMatch(/Cardivance/);
  });

  it("remembers the choice, and drops a role the person may not take", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ principal: { role: "evaluator" } })),
    );
    window.localStorage.setItem(
      "northstar.scope",
      JSON.stringify({ brand: "Harborstone Wealth", persona: "admin" }),
    );
    render(
      <ScopeProvider>
        <ScopeBar />
      </ScopeProvider>,
    );
    expect((screen.getByLabelText("Brand") as HTMLSelectElement).value).toBe("Harborstone Wealth");
    // An evaluator can't run as admin, so the role falls back to the default.
    await screen.findByDisplayValue("Marketer");
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "all" } });
    expect(window.localStorage.getItem("northstar.scope")).toContain('"brand":"all"');
  });
});
