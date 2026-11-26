import { describe, expect, it } from "vitest";
import { VIEW_PATHS, viewFromPath } from "./views";

describe("page addresses", () => {
  it("maps every page to its own path and back", () => {
    for (const [view, path] of Object.entries(VIEW_PATHS)) expect(viewFromPath(path)).toBe(view);
    expect(new Set(Object.values(VIEW_PATHS)).size).toBe(Object.keys(VIEW_PATHS).length);
  });

  it("ignores a trailing slash and opens the chat for anything else", () => {
    expect(viewFromPath("/squad/")).toBe("team");
    expect(viewFromPath("/learn")).toBe("learn");
    expect(viewFromPath("/nowhere")).toBe("chat");
    expect(viewFromPath("/")).toBe("chat");
  });
});
