import { describe, expect, it } from "vitest";
import { toHtml } from "../northstarMarkdown";

describe("toHtml", () => {
  it("renders the agent's headings, emphasis, lists, and links", () => {
    expect(toHtml("# Title\n\n**Bold** and *soft* `code`")).toBe(
      "<h3>Title</h3><p><strong>Bold</strong> and <em>soft</em> <code>code</code></p>",
    );
    expect(toHtml("- one\n- two\n\n1. first")).toBe(
      "<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>",
    );
    expect(toHtml("[Docs](https://example.test/a)")).toContain(
      '<a href="https://example.test/a" target="_blank" rel="noopener noreferrer">Docs</a>',
    );
  });

  it("renders a table", () => {
    expect(toHtml("| A | B |\n|---|---|\n| 1 | 2 |")).toBe(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
  });

  it("escapes HTML the model or a tool wrote, including inside code", () => {
    const html = toHtml('<img src=x onerror="alert(1)">\n\n```\n<script>\n```');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("links only https URLs", () => {
    expect(toHtml("[x](javascript:alert(1))")).not.toContain("<a ");
  });

  it("keeps a half-streamed answer readable", () => {
    expect(toHtml("")).toBe("");
    expect(toHtml(undefined)).toBe("");
    expect(toHtml("**bold")).toBe("<p>**bold</p>");
    expect(toHtml("```\nopen")).toBe("<pre><code>open</code></pre>");
  });
});
