import { ASSET_LIBRARY, TEAM_MARKETS, type TeamEvent } from "@northstar/architecture";
import { describe, expect, it } from "vitest";
import { objectsIn, sourceIndex } from "./Sources";
import { foldTeam } from "./team-state";

const read = (tool: string, output: unknown): TeamEvent =>
  ({
    type: "tool",
    agent: "audience-analyst",
    step: { tool, input: {}, ok: true, output },
  }) as TeamEvent;

describe("source IDs", () => {
  it("knows every segment, competitor, signal and image from the demo's data before any run", () => {
    const index = sourceIndex(foldTeam([]));
    for (const market of Object.values(TEAM_MARKETS))
      for (const item of [...market.segments, ...market.competitors, ...market.signals])
        expect(index.get(item.id)?.fields.length, item.id).toBeGreaterThan(0);
    const image = ASSET_LIBRARY[0];
    expect(index.get(image?.id ?? "")).toMatchObject({ kind: "Image", title: image?.title });
  });

  it("prefers what this run's tools returned, with the tool named", () => {
    const id = "lt-comp-veltrix";
    const index = sourceIndex(
      foldTeam([
        read(
          "get_competitors",
          JSON.stringify({
            competitors: [
              {
                id,
                name: "Veltrix Pharma",
                positioning: "Established ARNI",
                share_of_voice: 0.48,
                recent_move: "Launched a congress campaign",
                extra_field: "only the tool returns this",
              },
            ],
          }),
        ),
      ]),
    );
    expect(index.get(id)).toMatchObject({
      title: "Veltrix Pharma",
      from: "get_competitors in this run",
    });
    expect(index.get(id)?.fields).toContainEqual(["Share of voice", "0.48"]);
  });

  it("reads every complete object from an output recorded cut short", () => {
    const full = JSON.stringify({
      rows: [
        { id: "lt-seg-a", name: 'Says "hi" {x}' },
        { id: "lt-seg-b", name: "Cut" },
      ],
    });
    const cut = full.slice(0, full.indexOf("Cut"));
    expect(objectsIn(cut).map((item) => item.id)).toEqual(["lt-seg-a"]);
    expect(
      objectsIn(full)
        .filter((item) => item.id)
        .map((item) => item.id),
    ).toEqual(["lt-seg-a", "lt-seg-b"]);
  });
});
