import { emptyWorkingSet, type WorkingSet } from "@northstar/contracts";
import { describe, expect, it } from "vitest";
import { reviewBlocker, reviewDraft, withDraftReview } from "./draft-review";
import { applyFocusUpdate } from "./focus";

const MORTALITY =
  "Reduced the risk of cardiovascular death or heart failure hospitalization by 20% versus enalapril in HFrEF.";
const SAFETY =
  "The most common adverse reactions were hypotension, hyperkalemia, cough and dizziness.";
const HFPEF = "Improves outcomes in heart failure with preserved ejection fraction.";

/** A workspace whose claims check found two claims usable and one blocked. */
const checked: WorkingSet = {
  ...emptyWorkingSet(),
  cards: [
    {
      id: "graph:check_clinical_claims",
      kind: "graph",
      eyebrow: "Knowledge graph",
      title: "Claims check: Cardivance",
      summary: "2 of 3 claims usable.",
      state: "ready",
      source: { system: "knowledge-graph", label: "Neo4j", freshness: "now", status: "ready" },
      details: [],
      toolName: "check_clinical_claims",
      items: [
        { status: "ok", label: "Usable", title: MORTALITY },
        { status: "ok", label: "Usable", title: SAFETY },
        { status: "blocked", label: "Blocked", title: HFPEF },
      ],
    },
  ],
};
const draft = (fields: Array<[string, string]>, title = "Cardivance HFrEF outcomes") => ({
  title,
  fields: fields.map(([label, value]) => ({ label, value })),
});

describe("chat draft review", () => {
  it("flags reworded claims and new assertions, as in the table draft that slipped through", () => {
    const review = reviewDraft(
      draft([
        [
          "Subject",
          "Cardivance: 20 % Reduction in Cardiovascular Death & Heart-Failure Hospitalization",
        ],
        ["Pre-header", "Learn how Cardivance can improve outcomes for HFrEF patients"],
        [
          "Body",
          "In the CARDIO-HF trial (8442 patients), Cardivance reduced the composite endpoint of cardiovascular death or heart-failure hospitalization by 20% versus enalapril.",
        ],
        ["Safety Disclosures", "• Cardivance boxed warning\n• Full prescribing information"],
        ["MLR Approval ID", "MLR-2026-0412"],
      ]),
      checked,
      "Lumera Therapeutics",
    );
    expect(review?.issues.map((issue) => [issue.field, issue.reason.split(" ")[0]])).toEqual([
      ["Subject", "Rewords"],
      ["Pre-header", "Asserts"],
      ["Body", "Rewords"],
    ]);
    expect(review?.issues[1]?.reason).toMatch(/improve/);
  });

  it("passes a draft that uses the approved claims word for word, and flags a blocked one", () => {
    const good = reviewDraft(
      draft([
        ["Subject", "Cardivance at the heart failure meeting"],
        [
          "Body",
          `Hello cardiology colleagues,\n${MORTALITY}\n${SAFETY}\nPlease see the full prescribing information below.`,
        ],
      ]),
      checked,
    );
    expect(good).toEqual({ approvedUsed: [MORTALITY, SAFETY], issues: [] });
    const blocked = reviewDraft(
      draft([
        ["Body", "Cardivance improves outcomes in heart failure with preserved ejection fraction."],
      ]),
      checked,
    );
    expect(blocked?.issues[0]?.reason).toMatch(/blocked claim/);
  });

  it("reviews nothing without a claims check, and holds the save while a sentence is flagged", () => {
    expect(
      reviewDraft(draft([["Body", "Cardivance cuts risk by 20%."]]), emptyWorkingSet()),
    ).toBeUndefined();
    const at = new Date("2026-11-04T12:00:00Z");
    const flagged = withDraftReview(
      applyFocusUpdate(
        checked,
        {
          kind: "email",
          title: "Draft",
          summary: "",
          fields: [{ label: "Body", value: "Cardivance cuts risk by 20%." }],
          changeNote: "First draft",
        },
        at,
        () => "focus",
      ),
    );
    expect(flagged.focus?.versions[0]?.review?.issues).toHaveLength(1);
    expect(reviewBlocker(flagged)).toMatch(/1 sentence in this draft isn't approved claim text/);
    const fixed = withDraftReview(
      applyFocusUpdate(
        flagged,
        {
          kind: "email",
          title: "Draft",
          summary: "",
          fields: [{ label: "Body", value: MORTALITY }],
          changeNote: "Use the claim",
        },
        at,
      ),
    );
    expect(reviewBlocker(fixed)).toBeNull();
    // The earlier version keeps its own review.
    expect(fixed.focus?.versions[0]?.review?.issues).toHaveLength(1);
  });
});
