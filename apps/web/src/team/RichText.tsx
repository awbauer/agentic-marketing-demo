// Agents write in paragraphs; people scan. RichText turns an agent's prose into something a person
// can read at a glance, without changing a word of it:
// - "(1) … (2) … (3) …" becomes a numbered list,
// - "Measure:", "Primary:", "Guardrail:" and similar labels become bold labels on their own lines,
// - three or more sentences become bullets,
// - data ids in parentheses ("(lt-seg-hf-specialists)") move out of the sentence into source chips;
//   ids written into a sentence stay where they are, as code.

import { SourceId } from "./Sources";

/** A governed data id: a brand prefix, a kind, and a name. */
const ID = /\b(?:lt|ck|hs)-(?:seg|sig|comp|result|img|disc|ev|mod|claim)-[a-z0-9-]+\b/g;
/** A parenthetical that holds at least one id, e.g. "(signal lt-sig-congress-data)". */
const ID_PARENS =
  /\s*\(([^()]*\b(?:lt|ck|hs)-(?:seg|sig|comp|result|img|disc|ev|mod|claim)-[a-z0-9-]+\b[^()]*)\)/g;
const LABELS =
  /\b(Measure|Measures|Primary|Secondary|Guardrail|Guardrails|Why|Rationale|Risk|Risks|Next steps?|Recommendation|Evidence|Target|Note)s?:\s+/g;
const SENTENCE = /(?<=[.!?])\s+(?=[A-Z(“"])/;

/** Agents sometimes write ids and words with non-breaking hyphens; read them as plain ones. */
const plain = (text: string) => text.replace(/‑/g, "-");

type Parsed = { text: string; sources: string[] };

function pullSources(input: string): Parsed {
  const sources: string[] = [];
  const text = plain(input).replace(ID_PARENS, (_match, inner: string) => {
    sources.push(...(inner.match(ID) ?? []));
    return "";
  });
  return { text, sources };
}

/** Inline text with any remaining ids shown as code. */
function Inline({ text }: { text: string }) {
  const parts = text.split(
    /(\b(?:lt|ck|hs)-(?:seg|sig|comp|result|img|disc|ev|mod|claim)-[a-z0-9-]+\b)/g,
  );
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? <SourceId key={`${part}-${index}`} id={part} /> : part,
      )}
    </>
  );
}

/** Sentences as bullets when there are enough of them to scan; otherwise a paragraph. */
function Sentences({ text, min = 3 }: { text: string; min?: number }) {
  const sentences = text
    .split(SENTENCE)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length < min) return <Inline text={text.trim()} />;
  return (
    <ul className="team-rich-bullets">
      {sentences.map((sentence, index) => (
        <li key={`${index}-${sentence.slice(0, 12)}`}>
          <Inline text={sentence} />
        </li>
      ))}
    </ul>
  );
}

/** An item on its own line starts like a sentence. */
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "(1) a, (2) b, and (3) c" as an intro and its items, or null when there is no such list. */
function enumeration(text: string): { intro: string; items: string[]; outro: string } | null {
  if (!/\(1\)/.test(text) || !/\(2\)/.test(text)) return null;
  const [intro = "", ...rest] = text.split(/\s*\(\d\)\s*/);
  if (rest.length < 2) return null;
  const last = rest[rest.length - 1] ?? "";
  // What follows the last item ("… (3) c. Please choose one.") is the outro.
  const [lastItem = "", ...after] = last.split(SENTENCE);
  const items = [...rest.slice(0, -1), lastItem].map((item) =>
    capitalize(
      item
        .replace(/[,;]?\s*(?:and|or)?\s*$/i, "")
        .replace(/[.;,]$/, "")
        .trim(),
    ),
  );
  return { intro: intro.replace(/[:\s]+$/, ""), items, outro: after.join(" ").trim() };
}

export function RichText({ text, className }: { text: string; className?: string }) {
  if (!text?.trim()) return null;
  const { text: body, sources } = pullSources(text);
  const list = enumeration(body);
  let content: React.ReactNode;
  if (list) {
    content = (
      <>
        {list.intro && (
          <p>
            <Inline text={`${list.intro}:`} />
          </p>
        )}
        <ol className="team-rich-list">
          {list.items.map((item, index) => (
            <li key={`${index}-${item.slice(0, 12)}`}>
              <Inline text={item} />
            </li>
          ))}
        </ol>
        {list.outro && (
          <p>
            <Inline text={list.outro} />
          </p>
        )}
      </>
    );
  } else {
    // Split on labels; the text before the first label has none.
    const pieces = body.split(LABELS);
    if (pieces.length > 1) {
      const sections: Array<{ label: string | null; text: string }> = [];
      if (pieces[0]?.trim()) sections.push({ label: null, text: pieces[0] });
      for (let at = 1; at < pieces.length; at += 2)
        sections.push({ label: pieces[at] ?? "", text: pieces[at + 1] ?? "" });
      content = (
        <dl className="team-rich-sections">
          {sections.map((section, index) =>
            section.label ? (
              <div key={`${section.label}-${index}`}>
                <dt>{section.label}</dt>
                {section.text.trim() && (
                  <dd>
                    <Sentences text={section.text} />
                  </dd>
                )}
              </div>
            ) : (
              <div key={`intro-${index}`} className="team-rich-intro">
                <dd>
                  <Sentences text={section.text} />
                </dd>
              </div>
            ),
          )}
        </dl>
      );
    } else content = <Sentences text={body} />;
  }
  return (
    <div className={`team-rich${className ? ` ${className}` : ""}`}>
      {content}
      {sources.length > 0 && <SourceChips ids={sources} />}
    </div>
  );
}

/** The data a passage rests on, as small chips after it. */
export function SourceChips({ ids }: { ids: readonly string[] }) {
  const unique = [...new Set(ids.map(plain))];
  if (unique.length === 0) return null;
  return (
    <p className="team-rich-sources">
      <span>Sources</span>
      {unique.map((id) => (
        <SourceId key={id} id={id} />
      ))}
    </p>
  );
}
