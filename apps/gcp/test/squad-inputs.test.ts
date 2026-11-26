// What the squad's save tools accept from a model, beyond the exact shape asked for.
import { describe, expect, it } from "vitest";
import { modulesList } from "../../edge/src/team/lifecycle-workers";

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
