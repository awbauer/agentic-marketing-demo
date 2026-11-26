import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichText } from "./RichText";

const html = (text: string) => renderToStaticMarkup(<RichText text={text} />);
const items = (markup: string, tag: "ol" | "ul") =>
  [
    ...(markup.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`))?.[1] ?? "").matchAll(
      /<li>(.*?)<\/li>/g,
    ),
  ].map((match) => match[1]?.replace(/<[^>]+>/g, ""));

describe("RichText", () => {
  it("turns a numbered list of options into one", () => {
    const markup = html(
      "The audience analyst has proposed three focus areas: (1) the congress-outcomes story to specialists via email, (2) display reach into general cardiologists, and (3) email plus podcast to nurse practitioners. Please choose the focus area the campaign will serve.",
    );
    expect(items(markup, "ol")).toEqual([
      "The congress-outcomes story to specialists via email",
      "Display reach into general cardiologists",
      "Email plus podcast to nurse practitioners",
    ]);
    expect(markup).toContain("The audience analyst has proposed three focus areas:");
    expect(markup).toContain("Please choose the focus area the campaign will serve.");
  });

  it("puts labels on their own lines and bullets their sentences", () => {
    const markup = html(
      "Primary: email open rate at or above 46.9%. Secondary: share of the segment reached twice. Guardrail: no more than two sends per month per HCP.",
    );
    expect(markup.match(/<dt>(.*?)<\/dt>/g)).toEqual([
      "<dt>Primary</dt>",
      "<dt>Secondary</dt>",
      "<dt>Guardrail</dt>",
    ]);
  });

  it("moves data ids in parentheses into source chips, with non-breaking hyphens read as plain", () => {
    const markup = html(
      "Specialists are the most responsive segment (lt‑seg‑hf‑specialists). Searches spiked after the congress (lt-sig-congress-data). The window sits inside that period.",
    );
    expect(items(markup, "ul")).toEqual([
      "Specialists are the most responsive segment.",
      "Searches spiked after the congress.",
      "The window sits inside that period.",
    ]);
    // Each source is a chip that opens its details.
    expect(markup).toMatch(/<button[^>]*team-claim-chip[^>]*>lt-seg-hf-specialists<\/button>/);
    expect(markup).toMatch(/<button[^>]*team-claim-chip[^>]*>lt-sig-congress-data<\/button>/);
  });

  it("leaves a short passage as it is", () => {
    expect(html("Approved. Looks good.")).toBe(
      '<div class="team-rich">Approved. Looks good.</div>',
    );
  });
});
