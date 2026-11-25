import { env, SELF } from "cloudflare:test";
import { TEAM_BRIEFS, type TeamEvent } from "@northstar/architecture";
import { beforeAll, describe, expect, it } from "vitest";
import { pruneArchitecture } from "./architecture/store";
import { alignStamps, LIBRARY_SIZE, recordRun } from "./team/library";
import { createArchitectureTables } from "./worker.test-helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed responses are untyped JSON in these tests
type Json = Record<string, any>;

const get = (path: string, persona = "marketer") =>
  SELF.fetch(`http://example.com${path}`, { headers: { "x-persona": persona } });
const post = (path: string, json: unknown, persona = "marketer") =>
  SELF.fetch(`http://example.com${path}`, {
    method: "POST",
    headers: { "x-persona": persona, "content-type": "application/json" },
    body: JSON.stringify(json),
  });
const lines = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json);

beforeAll(async () => {
  await createArchitectureTables(env.APP_DB);
});

describe("the run library", () => {
  it("keeps a run with a time for every event, and carries on after a person decides", async () => {
    const started = await lines(
      await post("/api/arch/team/runs", { briefId: "coastline-winter-warmup" }),
    );
    const id = started[0]?.id as string;
    const first = (await (await get(`/api/arch/team/library/${id}`)).json()) as Json;
    expect(first).toMatchObject({ id, mode: "squad", provider: "cloudflare", status: "waiting" });
    // The stream's last line (saved) is sent after the save, so it is not in the log.
    expect(first.events).toHaveLength(started.length - 1);
    expect(first.stamps).toHaveLength(first.events.length);
    expect([...first.stamps].sort((a: number, b: number) => a - b)).toEqual(first.stamps);

    // The client approves; the library row grows, and the earlier events keep their times.
    const decided = await lines(
      await post(
        `/api/arch/team/runs/${id}/decide`,
        { gate: "client", decision: "approve", note: "" },
        "brand-lead",
      ),
    );
    expect(decided.at(-1)).toMatchObject({ type: "saved", ok: true });
    const after = (await (await get(`/api/arch/team/library/${id}`)).json()) as Json;
    expect(after.status).toBe("done");
    expect(after.events.length).toBeGreaterThan(first.events.length);
    expect(after.stamps).toHaveLength(after.events.length);
    expect(after.stamps.slice(0, first.stamps.length)).toEqual(first.stamps);

    // Anyone may read the library, whoever started the run.
    const listed = (await (await get("/api/arch/team/library", "reviewer")).json()) as Json;
    expect(listed.runs[0]).toMatchObject({
      id,
      briefId: "coastline-winter-warmup",
      brand: TEAM_BRIEFS.find((brief) => brief.id === "coastline-winter-warmup")?.brand,
      scripted: true,
      events: after.events.length,
    });
    expect(listed.runs[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(listed.runs[0]).not.toHaveProperty("stamps");
  });

  it("keeps only the ten most recent runs", async () => {
    const brief = TEAM_BRIEFS[0];
    if (!brief) throw new Error("No sample brief.");
    const events: TeamEvent[] = [{ type: "error", message: "placeholder" }];
    for (let index = 0; index < LIBRARY_SIZE + 3; index += 1)
      await recordRun(
        env.APP_DB,
        {
          id: `lib-${String(index).padStart(2, "0")}`,
          brief,
          mode: "squad",
          provider: "cloudflare",
          events,
          stamps: [index],
          tokens: index,
          status: "done",
          scripted: true,
        },
        new Date(Date.UTC(2030, 0, 1, 0, index)).toISOString(),
      );
    const listed = (await (await get("/api/arch/team/library")).json()) as Json;
    expect(listed.runs).toHaveLength(LIBRARY_SIZE);
    expect(listed.runs[0].id).toBe(`lib-${LIBRARY_SIZE + 2}`);
    expect(listed.runs.map((run: Json) => run.id)).not.toContain("lib-02");
    expect((await get("/api/arch/team/library/lib-00")).status).toBe(404);

    // The 24-hour architecture prune leaves the library alone: the last ten stay until replaced.
    await pruneArchitecture(env.APP_DB, new Date(Date.UTC(2031, 0, 1)));
    const kept = (await (await get("/api/arch/team/library")).json()) as Json;
    expect(kept.runs).toHaveLength(LIBRARY_SIZE);
  });

  it("lines up a restored run's times with the library's", () => {
    // Three earlier events the library timed, then two this request sent.
    expect(alignStamps(5, [900, 950], [100, 200, 300], 0)).toEqual([100, 200, 300, 900, 950]);
    // Earlier events the library never saw take the first new time.
    expect(alignStamps(3, [900], [], 0)).toEqual([900, 900, 900]);
    expect(alignStamps(2, [], [], 42)).toEqual([42, 42]);
  });
});
