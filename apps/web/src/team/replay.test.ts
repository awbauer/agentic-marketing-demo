import { describe, expect, it } from "vitest";
import { FALLBACK_GAP_MS, MAX_GAP_MS, replayDelays } from "./replay";

describe("replay pacing", () => {
  it("keeps the run's gaps, capping a long wait", () => {
    const stamps = [1000, 1300, 1300, 61_300, 61_800];
    expect(replayDelays(5, stamps, "1x")).toEqual([0, 300, 0, MAX_GAP_MS, 500]);
  });

  it("speeds up by the chosen factor", () => {
    expect(replayDelays(3, [0, 1000, 1500], "2x")).toEqual([0, 500, 250]);
    expect(replayDelays(3, [0, 1000, 1500], "5x")).toEqual([0, 200, 100]);
  });

  it("shows everything at once when instant", () => {
    expect(replayDelays(3, [0, 1000, 1500], "instant")).toEqual([0, 0, 0]);
  });

  it("falls back to a fixed pace when the run carries no times", () => {
    expect(replayDelays(3, null, "1x")).toEqual([0, FALLBACK_GAP_MS, FALLBACK_GAP_MS]);
    // Times that don't cover every event can't be trusted to line up.
    expect(replayDelays(3, [0, 10], "1x")).toEqual([0, FALLBACK_GAP_MS, FALLBACK_GAP_MS]);
  });

  it("never waits a negative time when clocks go backward", () => {
    expect(replayDelays(2, [500, 400], "1x")).toEqual([0, 0]);
  });
});
