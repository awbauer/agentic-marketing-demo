// What the squad's save tools accept from a model, beyond the exact shape asked for.
import { describe, expect, it } from "vitest";
import { audienceInclude, modulesList } from "../../edge/src/team/lifecycle-workers";
import {
  newSaveState,
  refusal,
  SAME_REFUSAL_LIMIT,
  stuckOnRefusal,
  stuckReport,
} from "../../edge/src/team/repeat-guard";

describe("draft_modules input", () => {
  it("takes the modules as a list, or keyed by channel as gpt-oss sometimes sends them", () => {
    const email = { headline: "H", opening: "O", closing: "C", cta: "A" };
    expect(modulesList([{ ...email, channel: "email" }]).map((item) => item.channel)).toEqual([
      "email",
    ]);
    expect(modulesList({ email, display: { ...email, headline: "D" } })).toEqual([
      { ...email, channel: "email" },
      { ...email, headline: "D", channel: "display" },
    ]);
    // A single module object stays one module.
    expect(modulesList({ ...email, channel: "display" })).toHaveLength(1);
  });
});

describe("build_audience input", () => {
  it("reads decile bands however the model names and shapes them", () => {
    const id = "lt-seg-hf-specialists";
    const all = ["high", "mid", "low"];
    expect(audienceInclude([{ segmentId: id, deciles: ["high", "mid"] }])).toEqual([
      { segmentId: id, deciles: ["high", "mid"] },
    ]);
    // What a Vertex run sent, and was refused thirty times for.
    expect(audienceInclude({ [id]: { decileBands: all } })).toEqual([
      { segmentId: id, deciles: all },
    ]);
    expect(audienceInclude({ segmentId: id, bands: "High, Low" })).toEqual([
      { segmentId: id, deciles: ["high", "low"] },
    ]);
    expect(audienceInclude({ [id]: ["mid"] })).toEqual([{ segmentId: id, deciles: ["mid"] }]);
    // No bands named: the service's refusal says which field and values it wants.
    expect(audienceInclude([{ segmentId: id }])).toEqual([{ segmentId: id, deciles: [] }]);
  });
});

describe("the same-refusal guardrail", () => {
  it("says when a refusal repeats, and stops the assignment at the limit", () => {
    const saved = newSaveState();
    const first = refusal(saved, ["Set deciles."]);
    expect(first.error).not.toContain("same refusal");
    const second = refusal(saved, ["Set deciles."]);
    expect(second.error).toContain("same refusal as your last try");
    expect(stuckOnRefusal(saved)).toBe(false);
    for (let index = 2; index < SAME_REFUSAL_LIMIT; index += 1) refusal(saved, ["Set deciles."]);
    expect(stuckOnRefusal(saved)).toBe(true);
    expect(stuckReport("build_audience", saved)).toContain("refused 3 times in a row");
    // A different problem starts the count again.
    refusal(saved, ["Something else."]);
    expect(stuckOnRefusal(saved)).toBe(false);
  });
});
