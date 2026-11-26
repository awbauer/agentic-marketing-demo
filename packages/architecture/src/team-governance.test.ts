import { describe, expect, it } from "vitest";
import type { TeamEvent } from "./team.ts";
import {
  type AgentEvidence,
  autonomyOf,
  bookPlacements,
  claimGaps,
  file2253,
  hcpReplies,
  misreports,
  PROMOTE_AFTER,
  PROMOTE_MARGIN,
  promptVersionsOf,
  reviewerMetrics,
  reviewedBy,
  screenReplies,
  seededOutcome,
  seedFlaw,
  shortHash,
  withoutSeeded,
} from "./team-governance.ts";
import type {
  ApprovedJob,
  Form2253,
  LibraryClaim,
  MlrJob,
  PharmaModule,
  Placement,
  ResultLine,
} from "./team-pharma.ts";

const claim = (patch: Partial<LibraryClaim>): LibraryClaim => ({
  topic: "cardivance-mortality",
  claimId: "CLM-CRD-0042",
  text: "Reduced cardiovascular death.",
  status: "substantiated",
  usable: true,
  issues: [],
  references: [],
  requires: [],
  context: null,
  scope: { audiences: ["HCP"], markets: ["US"], channels: ["email"], indication: "HFrEF.adults" },
  labelVersion: "USPI-v4",
  expiresOn: "2027-11-14",
  mustNotAppearWith: [],
  ...patch,
});

const library = [
  claim({}),
  claim({
    topic: "cardivance-hfpef",
    claimId: "CLM-CRD-0051",
    usable: false,
    issues: ["Its indication (HFpEF.adults) is not on the label: off-label."],
  }),
  claim({ topic: "cardivance-superior", claimId: null, usable: false, status: "unsupported" }),
];

const decided = (
  gate: string,
  decision: "approve" | "changes",
  persona: string,
  ms: number,
): TeamEvent =>
  ({
    type: "decided",
    gate,
    decision,
    note: "",
    persona,
    record: {
      reviewed: [],
      policyVersion: "pol-1",
      promptVersions: {},
      askedAt: null,
      decidedInMs: ms,
    },
  }) as TeamEvent;

const module = (id: string): PharmaModule => ({
  id,
  channel: "email",
  headline: "A headline",
  opening: "",
  claims: [],
  closing: "",
  cta: "Read more",
  disclosures: [{ id: "lt-disc-isi-cardivance", title: "ISI", text: "Safety" }],
  safetyPlacement: "beside-claims",
  assets: [],
});

describe("short hash", () => {
  it("is stable and tells inputs apart", () => {
    expect(shortHash("abc")).toBe(shortHash("abc"));
    expect(shortHash("abc")).not.toBe(shortHash("abd"));
    expect(shortHash("abc")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("claim gaps", () => {
  it("routes an off-label point to medical information and a missing claim to the backlog", () => {
    const gaps = claimGaps({
      library,
      brand: "Lumera Therapeutics",
      topics: ["cardivance-mortality", "cardivance-hfpef", "cardivance-superior", "cardivance-new"],
    });
    expect(gaps.map((gap) => [gap.kind, gap.route])).toEqual([
      ["off-label", "medical-information"],
      ["unsupported", "claims-backlog"],
      ["no-claim", "claims-backlog"],
    ]);
  });

  it("logs a channel the claim isn't approved for, and a fact in the writer's own words", () => {
    const gaps = claimGaps({
      library,
      brand: "Lumera Therapeutics",
      topics: ["cardivance-mortality"],
      channel: "display",
      texts: [{ label: "headline", text: "Cuts deaths by 20%" }],
    });
    expect(gaps.map((gap) => gap.kind)).toEqual(["out-of-scope", "own-wording"]);
  });
});

describe("decision records and reviewers", () => {
  it("records the prompt a worker worked with, not its report prompt", () => {
    const prompt = (purpose: string, version: string) =>
      ({ type: "prompt", agent: "copy-lead", purpose, version }) as TeamEvent;
    expect(promptVersionsOf([prompt("work", "pr-work"), prompt("report", "pr-report")])).toEqual({
      "copy-lead": "pr-work",
    });
  });

  it("names the work each gate decides on", () => {
    expect(reviewedBy("medical").map((step) => step.tool)).toEqual([
      "draft_modules",
      "submit_mlr_job",
    ]);
    expect(reviewedBy("fda-2253").map((step) => step.tool)).toEqual([
      "schedule_deployment",
      "prepare_form_2253",
    ]);
  });

  it("measures each reviewer's override rate, median time and near-instant approvals", () => {
    const [reviewer] = reviewerMetrics([
      decided("medical", "changes", "reviewer", 40_000),
      decided("medical", "approve", "reviewer", 2_000),
      decided("concept-review", "approve", "reviewer", 1_000),
    ]);
    expect(reviewer).toMatchObject({
      persona: "reviewer",
      decisions: 3,
      changes: 1,
      medianMs: 2_000,
      fastApprovals: 2,
    });
    expect(reviewer?.overrideRate).toBeCloseTo(1 / 3);
  });
});

describe("a seeded flaw", () => {
  const job: MlrJob = {
    jobCode: "LT-1",
    round: 1,
    modules: [module("EM1"), { ...module("DS2"), channel: "display" }],
    checks: [],
    coordinatorNotes: ["First look"],
  };
  const seeding = seedFlaw(job);

  it("adds a copy of the email module without its fair balance, then withdraws it", () => {
    expect(seeding?.job.modules.map((item) => item.id)).toEqual(["EM1", "DS2", "EM9"]);
    expect(seeding?.job.modules.at(-1)?.disclosures).toEqual([]);
    expect(withoutSeeded(seeding?.job as MlrJob).modules.map((item) => item.id)).toEqual([
      "EM1",
      "DS2",
    ]);
  });

  it("is caught when any reviewer asks for changes, missed when all three approve", () => {
    const seededEvent = { type: "seeded-flaw", seeded: seeding?.seeded } as TeamEvent;
    expect(
      seededOutcome([seededEvent, decided("medical", "changes", "reviewer", 9_000)]),
    ).toMatchObject({ caught: true, by: "medical" });
    expect(
      seededOutcome([
        seededEvent,
        decided("medical", "approve", "reviewer", 9_000),
        decided("legal", "approve", "senior", 9_000),
        decided("regulatory", "approve", "compliance", 9_000),
      ]),
    ).toMatchObject({ caught: false });
    // Still with the reviewers: no outcome yet.
    expect(seededOutcome([seededEvent, decided("medical", "approve", "reviewer", 9_000)])).toBe(
      null,
    );
  });
});

describe("writes with a key and a read-back", () => {
  const form = {
    currentPi: "USPI-v4",
    materials: [
      {
        documentNumber: "D-A",
        materialId: "D-A-EM1",
        moduleId: "EM1",
        description: "",
        firstUse: "2027-01-05",
      },
    ],
  } as Form2253;

  it("files Form 2253 once: a retry with the same contents is the same write", () => {
    const first = file2253(form, "2027-01-05T00:00:00Z");
    const retry = file2253(form, "2027-01-05T00:01:00Z", first);
    expect(retry).toMatchObject({
      idempotencyKey: first.idempotencyKey,
      reference: first.reference,
      attempts: 2,
    });
    expect(first.matches).toBe(true);
  });

  it("reads back what the channels hold, and flags a placement they refused", () => {
    const approved = {
      documentNumber: "D-A",
      materials: [{ materialId: "D-A-EM1" }],
    } as ApprovedJob;
    const placement = (placementId: string, materialId: string) =>
      ({
        placementId,
        materialId,
        channel: "approved-email",
        segmentIds: ["seg-a"],
        start: "2027-01-05",
        end: "2027-02-05",
      }) as Placement;
    const ok = bookPlacements([placement("PL-001", "D-A-EM1")], approved, "now");
    expect(ok.matches).toBe(true);
    const off = bookPlacements(
      [placement("PL-001", "D-A-EM1"), placement("PL-002", "D-A-XX9")],
      approved,
      "now",
    );
    expect(off).toMatchObject({ matches: false });
    expect(off.readBack).toHaveLength(1);
  });

  it("treats a change of audience as a new booking, not a retry", () => {
    const approved = {
      documentNumber: "D-A",
      materials: [{ materialId: "D-A-EM1" }],
    } as ApprovedJob;
    const placement = (segmentIds: string[]) =>
      ({
        placementId: "PL-001",
        materialId: "D-A-EM1",
        channel: "approved-email",
        segmentIds,
        start: "2027-01-05",
        end: "2027-02-05",
      }) as Placement;
    const first = bookPlacements([placement(["seg-a"])], approved, "now");
    const same = bookPlacements([placement(["seg-a"])], approved, "later", first);
    const retargeted = bookPlacements([placement(["seg-a", "seg-b"])], approved, "later", first);
    expect(same.attempts).toBe(2);
    expect(retargeted.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(retargeted).toMatchObject({ attempts: 1, matches: true });
    expect(retargeted.readBack[0]).toContain("seg-a,seg-b");
  });
});

describe("safety screening of HCP replies", () => {
  it("sends a possible adverse event to pharmacovigilance in a business day, off-label to medical information", () => {
    const lines = [
      { id: "r-1", channel: "approved-email", clicks: 4, segmentId: "s" },
    ] as ResultLine[];
    const intake = screenReplies(hcpReplies(lines), "2027-02-01");
    const ae = intake.flags.find((flag) => flag.kind === "possible-adverse-event");
    expect(ae).toMatchObject({ matched: "hospitalized", due: "2027-02-02 (1 business day)" });
    expect(intake.flags.some((flag) => flag.kind === "off-label-question")).toBe(true);
    expect(intake.flags).toHaveLength(2);
  });
});

describe("reports graded against the trace", () => {
  it("flags a report that says work was saved when nothing was", () => {
    const message = (kind: string, from: string, to: string, text: string) =>
      ({ type: "message", id: "m", kind, from, to, text }) as TeamEvent;
    const events = [
      message("directive", "campaign-lead", "copy-lead", "Draft the modules."),
      message("report", "copy-lead", "campaign-lead", "I saved both modules."),
    ];
    expect(misreports(events)).toHaveLength(1);
    const honest = [
      events[0] as TeamEvent,
      { type: "artifact", by: "copy-lead", name: "draft_modules" } as TeamEvent,
      events[1] as TeamEvent,
    ];
    expect(misreports(honest)).toHaveLength(0);
  });
});

describe("autonomy earned by evidence", () => {
  const clean: AgentEvidence = { clean: true, violation: false, detail: "" };
  const bad: AgentEvidence = { clean: false, violation: true, detail: "a denial" };
  const runs = (items: AgentEvidence[]) =>
    items.map((evidence, index) => ({ at: `2027-01-0${index + 1}`, evidence }));

  it("may be promoted after a streak of clean runs, by a person", () => {
    const view = autonomyOf(runs(Array(PROMOTE_AFTER).fill(clean)), null);
    expect(view).toMatchObject({ stage: "supervise", canPromote: true });
    expect(autonomyOf(runs(Array(PROMOTE_AFTER).fill(clean)), "2027-01-09").stage).toBe("assist");
  });

  it("drops to Supervise on a violation after promotion, and needs a longer streak to return", () => {
    const history = runs([clean, clean, clean, bad]);
    const view = autonomyOf(history, "2027-01-03T12:00:00Z");
    expect(view).toMatchObject({ stage: "supervise", demoted: true, canPromote: false });
    expect(view.needed).toBe(PROMOTE_AFTER + PROMOTE_MARGIN);
  });
});
