import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recordSessionRun,
  reloadSessionMetrics,
  resetSessionMetrics,
  type SessionRun,
} from "./session-metrics";

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
};

const run = (patch: Partial<SessionRun> = {}): Omit<SessionRun, "key" | "at"> => ({
  runId: "team-1",
  title: "Cardivance after the congress",
  brand: "Lumera Therapeutics",
  mode: "lifecycle",
  provider: "cloudflare",
  source: "live",
  scripted: true,
  status: "waiting",
  scorecard: null,
  ...patch,
});

const stored = () =>
  JSON.parse(memory.get("northstar.team.session-metrics") ?? "{}") as {
    startedAt: string;
    runs: SessionRun[];
  };

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  memory.clear();
  reloadSessionMetrics();
});

afterEach(() => memory.clear());

describe("session metrics", () => {
  it("keeps one entry per live run, updated as it moves on", () => {
    recordSessionRun(run({ status: "waiting" }));
    recordSessionRun(run({ status: "done" }));
    expect(stored().runs).toHaveLength(1);
    expect(stored().runs[0]).toMatchObject({ key: "live:team-1", status: "done" });
  });

  it("counts every replay as its own run", () => {
    recordSessionRun(run({ status: "done" }));
    recordSessionRun(run({ source: "replay", status: "done" }), new Date(1));
    recordSessionRun(run({ source: "replay", status: "done" }), new Date(2));
    expect(stored().runs.map((item) => item.source)).toEqual(["replay", "replay", "live"]);
  });

  it("resets to a fresh, empty session", () => {
    recordSessionRun(run());
    resetSessionMetrics();
    expect(stored().runs).toEqual([]);
    reloadSessionMetrics();
    recordSessionRun(run({ runId: "team-2" }));
    expect(stored().runs.map((item) => item.runId)).toEqual(["team-2"]);
  });
});
