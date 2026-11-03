import { type InsightTile, READINESS_PRESENTATION } from "@northstar/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  InsightBoard,
  normalizeAssistantText,
  recordUrl,
  relativeTime,
  resolveTileRenderMode,
  salesforceRecordUrl,
  shortDate,
  shouldShowChatError,
  toolFreeTraceDetail,
} from "./index";

afterEach(cleanup);

const campaignCard: InsightTile = {
  id: "salesforce:summarize_campaign:701jV000004GglIQAS",
  kind: "campaign-summary",
  eyebrow: "Campaign summary",
  title: "Fall Loyalty Reactivation",
  summary: "Engagement is holding.",
  state: "ready",
  source: {
    system: "salesforce",
    label: "Salesforce agent",
    freshness: "just now",
    status: "ready",
  },
  details: ["Open rate 38.2%"],
  recordRef: { system: "salesforce", objectType: "Campaign", recordId: "701jV000004GglIQAS" },
};
const readinessCard: InsightTile = {
  ...campaignCard,
  id: "readiness",
  kind: "readiness",
  state: "stale",
  presentation: READINESS_PRESENTATION,
};

describe("InsightBoard", () => {
  it("renders model formatting as safe readable plain text", () => {
    expect(
      normalizeAssistantText(
        "**Campaign readiness** || **Brief** | Audience<br>Channel || |---|---|",
      ),
    ).toBe("Campaign readiness\nBrief · Audience\nChannel");
    expect(
      normalizeAssistantText(
        JSON.stringify({ message: "Campaign overview\n- Engagement is holding steady" }),
      ),
    ).toBe("Campaign overview\n- Engagement is holding steady");
    expect(normalizeAssistantText('{"message":"Campaign overview\\n- Evidence pending')).toBe(
      "Campaign overview\n- Evidence pending",
    );
  });

  it("does not pair a completed answer with a contradictory interruption error", () => {
    expect(
      shouldShowChatError(true, [
        { role: "user", text: "Summarize the campaign" },
        {
          role: "assistant",
          text: JSON.stringify({ message: "A complete Salesforce-grounded response." }),
        },
      ]),
    ).toBe(false);
    expect(
      shouldShowChatError(true, [
        { role: "user", text: "Create a brief" },
        { role: "assistant", text: "", hasCompletedToolOutput: true },
        { role: "assistant", text: "" },
      ]),
    ).toBe(false);
    expect(
      shouldShowChatError(true, [
        { role: "user", text: "Create a brief" },
        { role: "assistant", text: "" },
      ]),
    ).toBe(true);
    expect(shouldShowChatError(false, [{ role: "assistant", text: "Complete" }])).toBe(false);
  });

  it("does not describe a missing Salesforce catalog as an intentional tool-free answer", () => {
    expect(
      toolFreeTraceDetail(
        "Salesforce is connected, but the governed tool catalog is not ready for this request.",
      ),
    ).toContain("No Salesforce tool completed");
    expect(toolFreeTraceDetail("Here is how the proof works.")).toContain(
      "no Salesforce action was needed",
    );
  });

  it("renders typed source and freshness evidence", () => {
    render(<InsightBoard tiles={[campaignCard, readinessCard]} />);
    expect(screen.getAllByText("Salesforce agent")[0]).toBeInTheDocument();
    expect(screen.getByText("Needs refresh")).toBeInTheDocument();
    expect(screen.getByText("Native fallback")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open in Salesforce/ })[0]).toHaveAttribute(
      "href",
      "https://pu1788182184076.my.salesforce.com/lightning/r/Campaign/701jV000004GglIQAS/view",
    );
  });
  it("links records in any system only when that system has a link", () => {
    expect(recordUrl({ system: "restaurant-data", objectType: "Restaurant", recordId: "x" })).toBe(
      undefined,
    );
    expect(
      recordUrl({
        system: "some-system",
        objectType: "Order",
        recordId: "1",
        url: "https://example.test/orders/1",
      }),
    ).toBe("https://example.test/orders/1");
    render(
      <InsightBoard
        tiles={[
          {
            ...campaignCard,
            recordRef: { system: "restaurant-data", objectType: "Restaurant", recordId: "x" },
          },
        ]}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("shows fetched times relative to now", () => {
    const now = Date.parse("2026-09-26T18:00:00Z");
    expect(relativeTime("2026-09-26T17:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-09-26T17:52:00Z", now)).toBe("8 min ago");
    expect(relativeTime("2026-09-26T15:00:00Z", now)).toBe("3 h ago");
  });
  it("selects HXL only when the deployed resource is available", () => {
    expect(resolveTileRenderMode(readinessCard)).toBe("native");
    expect(resolveTileRenderMode(readinessCard, [READINESS_PRESENTATION.resourceUri])).toBe("hxl");
  });
  it("builds an encoded Salesforce sandbox record link", () => {
    expect(salesforceRecordUrl("Campaign Member", "record/id")).toBe(
      "https://pu1788182184076.my.salesforce.com/lightning/r/Campaign%20Member/record%2Fid/view",
    );
  });
  it("renders the empty recovery state", () => {
    render(<InsightBoard tiles={[]} />);
    expect(screen.getByText("No context yet")).toBeInTheDocument();
  });
  it.each(["loading", "error", "stale", "permission-denied"] as const)(
    "renders the %s state without a one-off card schema",
    (state) => {
      const tile = { ...campaignCard, id: state, state };
      render(<InsightBoard tiles={[tile]} />);
      expect(screen.getByTestId("tile-campaign-summary")).toHaveClass(`state-${state}`);
    },
  );
});

describe("tile items", () => {
  it("shows each item with its status label, ID and a readable date", () => {
    render(
      <InsightBoard
        tiles={[
          {
            ...campaignCard,
            id: "aprimo",
            details: [],
            items: [
              {
                status: "ok",
                label: "Usable",
                title: "Cardivance HFrEF outcomes email",
                id: "MLR-2026-0412",
                date: { label: "Approved until", value: "2027-06-12" },
              },
              { status: "warn", label: "Pending MLR review", title: "Superiority email" },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("Usable").closest("li")?.className).toContain("status-ok");
    expect(screen.getByText("MLR-2026-0412").tagName).toBe("CODE");
    expect(screen.getByText("Jun 12, 2027").getAttribute("dateTime")).toBe("2027-06-12");
    expect(screen.getByText("Pending MLR review").closest("li")?.className).toContain(
      "status-warn",
    );
    expect(shortDate("not a date")).toBe("not a date");
  });
});
