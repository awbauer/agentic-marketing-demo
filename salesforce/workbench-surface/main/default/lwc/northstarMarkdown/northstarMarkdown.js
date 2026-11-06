/**
 * The Markdown the agent writes, as HTML for lightning-formatted-rich-text. Source text is escaped
 * first, so the only tags in the result are the ones made here; the base component sanitizes again.
 */
const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

const cells = (row) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
const isTableRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const LIST_ITEM = /^\s*(?:[-*+]|(\d+)\.)\s+(.*)$/;

function table(lines) {
  const [head, , ...body] = lines;
  const row = (line, tag) =>
    `<tr>${cells(line)
      .map((cell) => `<${tag}>${inline(cell)}</${tag}>`)
      .join("")}</tr>`;
  return `<table><thead>${row(head, "th")}</thead><tbody>${body
    .map((line) => row(line, "td"))
    .join("")}</tbody></table>`;
}

export function toHtml(markdown) {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
    } else if (line.startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    } else if (/^#{1,6}\s/.test(line)) {
      const level = Math.min(line.match(/^#+/)[0].length + 2, 6);
      blocks.push(`<h${level}>${inline(line.replace(/^#+\s+/, ""))}</h${level}>`);
      index += 1;
    } else if (line.includes("|") && isTableRule(lines[index + 1] ?? "")) {
      const rows = [];
      while (index < lines.length && lines[index].includes("|")) rows.push(lines[index++]);
      blocks.push(table(rows));
    } else if (LIST_ITEM.test(line)) {
      const ordered = Boolean(line.match(LIST_ITEM)[1]);
      const items = [];
      while (index < lines.length && LIST_ITEM.test(lines[index])) {
        items.push(`<li>${inline(lines[index].match(LIST_ITEM)[2])}</li>`);
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.join("")}</${tag}>`);
    } else {
      const paragraph = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !LIST_ITEM.test(lines[index]) &&
        !/^(#{1,6}\s|```)/.test(lines[index])
      )
        paragraph.push(lines[index++]);
      blocks.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    }
  }
  return blocks.join("");
}
