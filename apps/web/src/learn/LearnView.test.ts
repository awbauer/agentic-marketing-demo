import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRead } from "./LearnView";

function savedProgress(value: string | null) {
  vi.stubGlobal("localStorage", { getItem: () => value, setItem: () => undefined });
}

describe("Learn reading progress", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops saved lessons that no longer exist, so progress never passes 100%", () => {
    savedProgress(JSON.stringify(["what-is-context", "rag", "graphrag-explained", "governance"]));
    expect([...loadRead()].sort()).toEqual(["governance", "what-is-context"]);
  });

  it("starts empty when nothing usable is saved", () => {
    savedProgress(null);
    expect(loadRead().size).toBe(0);
    savedProgress('{"not":"a list"}');
    expect(loadRead().size).toBe(0);
    savedProgress("not json");
    expect(loadRead().size).toBe(0);
  });
});
