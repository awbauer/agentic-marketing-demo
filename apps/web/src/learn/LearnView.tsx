import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../Markdown";
import {
  GLOSSARY,
  LEARN_LEDE,
  LEARN_PARTS,
  LEARN_TITLE,
  type LearnPart,
  type LearnSection,
} from "./content";
import { Diagram } from "./diagrams";
import { PART_LESSONS, type PartLesson, SECTION_LESSONS, type TryIt } from "./lessons";
import { LEARN_REFERENCE, REFERENCE_KINDS, type ReferenceKind } from "./reference";
import "./learn.css";

type View = "graph" | "history" | "evaluations" | "journeys" | "architecture";
const READ_KEY = "northstar.learn.read.v1";

// Reading progress is a per-viewer convenience; it must work when storage is unavailable.
function loadRead(): Set<string> {
  try {
    const raw = window.localStorage.getItem(READ_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveRead(read: Set<string>) {
  try {
    window.localStorage.setItem(READ_KEY, JSON.stringify([...read]));
  } catch {
    // Storage blocked: progress simply isn't remembered.
  }
}

// Scroll only the Learn view's own container; scrollIntoView would also scroll the page.
function jumpTo(id: string) {
  const target = document.getElementById(`learn-${id}`);
  const container = target?.closest<HTMLElement>(".learn-view");
  if (!target || !container) return;
  const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  container.scrollTo({
    top: container.scrollTop + offset - 8,
    behavior: smooth ? "smooth" : "auto",
  });
  target.focus({ preventScroll: true });
}

const TOTAL_SECTIONS = LEARN_PARTS.reduce((sum, part) => sum + part.sections.length, 0);

export function LearnView({
  onClose,
  onTryPrompt,
  onOpenView,
}: {
  onClose: () => void;
  onTryPrompt: (prompt: string) => void;
  onOpenView: (view: View) => void;
}) {
  const [read, setRead] = useState<Set<string>>(() => loadRead());
  const toggleRead = (id: string, value?: boolean) =>
    setRead((current) => {
      const next = new Set(current);
      const on = value ?? !next.has(id);
      if (on === next.has(id)) return current;
      if (on) next.add(id);
      else next.delete(id);
      saveRead(next);
      return next;
    });

  const tryIt = (action: TryIt) =>
    action.kind === "prompt" ? onTryPrompt(action.prompt) : onOpenView(action.view);

  const percent = Math.round((read.size / TOTAL_SECTIONS) * 100);

  return (
    <section className="evaluations-view learn-view" aria-labelledby="learn-title">
      <div className="section-header">
        <div>
          <p className="kicker">Guide</p>
          <h2 id="learn-title">{LEARN_TITLE}</h2>
        </div>
        <button type="button" className="text-button evaluations-back" onClick={onClose}>
          Back to workspace
        </button>
      </div>

      <div className="learn-hero">
        <div className="learn-hero-text">
          <p className="learn-hero-lede">{LEARN_LEDE}</p>
          <div
            className="learn-progress"
            role="progressbar"
            aria-label="Lessons read"
            aria-valuemin={0}
            aria-valuemax={TOTAL_SECTIONS}
            aria-valuenow={read.size}
            aria-valuetext={`${read.size} of ${TOTAL_SECTIONS} lessons read`}
          >
            <span className="learn-progress-track">
              <span className="learn-progress-fill" style={{ width: `${percent}%` }} />
            </span>
            <span className="learn-progress-label">
              <strong>{read.size}</strong> of {TOTAL_SECTIONS} lessons read
            </span>
          </div>
        </div>
        <ol className="learn-path">
          {LEARN_PARTS.map((part) => {
            const lesson = PART_LESSONS[part.id] as PartLesson;
            const done = part.sections.filter((section) => read.has(section.id)).length;
            return (
              <li key={part.id}>
                <button
                  type="button"
                  className={`learn-path-card part-${part.id}`}
                  onClick={() => jumpTo(part.id)}
                >
                  <span className="learn-path-number" aria-hidden="true">
                    {lesson.number}
                  </span>
                  <span className="learn-path-title">{part.title}</span>
                  <span className="learn-path-tagline">{lesson.tagline}</span>
                  <span className="learn-path-meta">
                    {part.sections.length} lessons · {lesson.minutes} min
                    {done > 0 && ` · ${done} read`}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="learn-layout">
        <nav className="learn-toc" aria-label="Learn contents">
          <ol>
            {LEARN_PARTS.map((part) => (
              <li key={part.id}>
                <button type="button" className="learn-toc-part" onClick={() => jumpTo(part.id)}>
                  {part.title}
                </button>
                <ol>
                  {part.sections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        className={read.has(section.id) ? "is-read" : undefined}
                        onClick={() => jumpTo(section.id)}
                      >
                        <span className="learn-toc-check" aria-hidden="true">
                          {read.has(section.id) ? "✓" : ""}
                        </span>
                        {section.title}
                        {read.has(section.id) && <span className="sr-only"> (read)</span>}
                      </button>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
            <li>
              <button type="button" className="learn-toc-part" onClick={() => jumpTo("glossary")}>
                Glossary
              </button>
            </li>
            <li>
              <button type="button" className="learn-toc-part" onClick={() => jumpTo("reference")}>
                Reference
              </button>
            </li>
          </ol>
        </nav>

        <div className="learn-body">
          {LEARN_PARTS.map((part) => (
            <Part key={part.id} part={part} read={read} onRead={toggleRead} onTry={tryIt} />
          ))}
          <Glossary />
          <ReferenceIndex onJump={jumpTo} />
        </div>
      </div>
    </section>
  );
}

function Part({
  part,
  read,
  onRead,
  onTry,
}: {
  part: LearnPart;
  read: Set<string>;
  onRead: (id: string, value?: boolean) => void;
  onTry: (action: TryIt) => void;
}) {
  const lesson = PART_LESSONS[part.id] as PartLesson;
  return (
    <section
      id={`learn-${part.id}`}
      className={`learn-part part-${part.id}`}
      tabIndex={-1}
      aria-labelledby={`learn-${part.id}-title`}
    >
      <header className="learn-chapter">
        <span className="learn-chapter-number" aria-hidden="true">
          {String(lesson.number).padStart(2, "0")}
        </span>
        <div>
          <p className="kicker">
            Part {lesson.number} · {lesson.minutes} min
          </p>
          <h3 id={`learn-${part.id}-title`}>{part.title}</h3>
          <p className="learn-chapter-tagline">{lesson.tagline}</p>
          <Markdown text={part.intro} />
          <div className="learn-outcomes">
            <p>You'll be able to</p>
            <ul>
              {lesson.outcomes.map((outcome) => (
                <li key={outcome}>{outcome}</li>
              ))}
            </ul>
          </div>
        </div>
      </header>
      {part.sections.map((section, index) => (
        <Lesson
          key={section.id}
          section={section}
          number={`${lesson.number}.${index + 1}`}
          isRead={read.has(section.id)}
          onRead={(value) => onRead(section.id, value)}
          onTry={onTry}
        />
      ))}
      <Check partId={part.id} check={lesson.check} />
    </section>
  );
}

function Lesson({
  section,
  number,
  isRead,
  onRead,
  onTry,
}: {
  section: LearnSection;
  number: string;
  isRead: boolean;
  onRead: (value?: boolean) => void;
  onTry: (action: TryIt) => void;
}) {
  const lesson = SECTION_LESSONS[section.id];
  const endRef = useRef<HTMLDivElement>(null);

  // Reaching the end of a lesson marks it read; the button still lets a reader undo that.
  useEffect(() => {
    const end = endRef.current;
    if (!end || isRead || typeof IntersectionObserver === "undefined") return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(timer);
        if (entry?.isIntersecting) timer = window.setTimeout(() => onRead(true), 1200);
      },
      { threshold: 1 },
    );
    observer.observe(end);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [isRead, onRead]);

  return (
    <article
      id={`learn-${section.id}`}
      className={`learn-section ${isRead ? "is-read" : ""}`}
      tabIndex={-1}
      aria-labelledby={`learn-${section.id}-title`}
    >
      <header className="learn-section-header">
        <span className="learn-section-number">{number}</span>
        <div>
          <h4 id={`learn-${section.id}-title`}>{section.title}</h4>
          <p className="learn-summary">{section.summary}</p>
        </div>
      </header>

      {lesson && <Diagram id={lesson.diagram} />}
      {lesson && (
        <p className="learn-key-idea">
          <span className="learn-key-label">Key idea</span>
          {lesson.keyIdea}
        </p>
      )}

      <div className="learn-prose">
        <Markdown text={section.body} />
      </div>

      {lesson?.tryIt && (
        <div className="learn-try">
          <p className="learn-try-label">Try it</p>
          <ul>
            {lesson.tryIt.map((action) => (
              <li key={action.label}>
                <button type="button" className="learn-try-button" onClick={() => onTry(action)}>
                  <span aria-hidden="true">{action.kind === "prompt" ? "✉" : "↗"}</span>
                  <span>
                    {action.label}
                    {action.kind === "prompt" && (
                      <small className="learn-try-prompt">“{action.prompt}”</small>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="learn-footer">
        {section.inDemo && (
          <div className="learn-in-demo">
            <h5>In this demo</h5>
            <ul>
              {section.inDemo.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="learn-resources">
          <h5>Learn more</h5>
          <ul>
            {section.resources.map((resource) => (
              <li key={resource.url}>
                <span className={`learn-kind kind-${resource.kind.toLowerCase()}`}>
                  {resource.kind}
                </span>
                <a href={resource.url} target="_blank" rel="noopener noreferrer">
                  {resource.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="learn-read-row" ref={endRef}>
        <button
          type="button"
          className="learn-read-button"
          aria-pressed={isRead}
          onClick={() => onRead()}
        >
          <span aria-hidden="true">{isRead ? "✓" : "○"}</span>
          {isRead ? "Read" : "Mark as read"}
        </button>
      </div>
    </article>
  );
}

function Check({ partId, check }: { partId: string; check: PartLesson["check"] }) {
  const [choice, setChoice] = useState<number | null>(null);
  const correct = choice === check.answer;
  const name = `learn-check-${partId}`;
  return (
    <section className="learn-check" aria-labelledby={`${name}-title`}>
      <p className="kicker" id={`${name}-title`}>
        Check your understanding
      </p>
      <fieldset>
        <legend>{check.question}</legend>
        {check.options.map((option, index) => (
          <label
            key={option}
            className={`learn-option ${
              choice === null
                ? ""
                : index === check.answer
                  ? "is-answer"
                  : index === choice
                    ? "is-wrong"
                    : ""
            }`}
          >
            <input
              type="radio"
              name={name}
              value={index}
              checked={choice === index}
              onChange={() => setChoice(index)}
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
      <div aria-live="polite">
        {choice !== null && (
          <p className={`learn-check-feedback ${correct ? "is-correct" : "is-incorrect"}`}>
            <strong>{correct ? "Correct." : "Not quite."}</strong> {check.explain}
          </p>
        )}
      </div>
    </section>
  );
}

function Glossary() {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term
      ? GLOSSARY.filter(
          (entry) =>
            entry.term.toLowerCase().includes(term) ||
            entry.definition.toLowerCase().includes(term),
        )
      : GLOSSARY;
  }, [query]);
  return (
    <section
      id="learn-glossary"
      className="learn-glossary"
      tabIndex={-1}
      aria-labelledby="learn-glossary-title"
    >
      <header className="learn-glossary-header">
        <div>
          <p className="kicker">Reference</p>
          <h3 id="learn-glossary-title">Glossary</h3>
        </div>
        <label className="learn-glossary-search">
          <span className="sr-only">Filter the glossary</span>
          <input
            type="search"
            placeholder="Filter terms…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>
      {entries.length === 0 ? (
        <p className="learn-muted" role="status">
          No terms match “{query.trim()}”.
        </p>
      ) : (
        <dl className="learn-glossary-grid">
          {entries.map((entry) => (
            <div key={entry.term}>
              <dt>{entry.term}</dt>
              <dd>{entry.definition}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

const SECTION_TITLES = new Map(
  LEARN_PARTS.flatMap((part) => part.sections.map((section) => [section.id, section.title])),
);

/**
 * Every tool, write action, graph type, operator control, and Salesforce component in the code,
 * each linked to the section that teaches it. `pnpm learn:check` keeps this list complete.
 */
function ReferenceIndex({ onJump }: { onJump: (id: string) => void }) {
  const [kind, setKind] = useState<ReferenceKind>("Tool");
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const term = query.trim().toLowerCase();
    return LEARN_REFERENCE.filter((entry) =>
      term ? `${entry.name} ${entry.summary}`.toLowerCase().includes(term) : entry.kind === kind,
    );
  }, [kind, query]);
  return (
    <section
      id="learn-reference"
      className="learn-glossary learn-reference"
      tabIndex={-1}
      aria-labelledby="learn-reference-title"
    >
      <header className="learn-glossary-header">
        <div>
          <p className="kicker">Reference</p>
          <h3 id="learn-reference-title">Every concept in the code</h3>
        </div>
        <label className="learn-glossary-search">
          <span className="sr-only">Search the reference</span>
          <input
            type="search"
            placeholder="Search all…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>
      {!query.trim() && (
        <fieldset className="learn-reference-kinds">
          <legend className="sr-only">Kind</legend>
          {REFERENCE_KINDS.map((option) => (
            <button
              type="button"
              key={option}
              aria-pressed={option === kind}
              onClick={() => setKind(option)}
            >
              {option}s{" "}
              <span className="learn-muted">
                {LEARN_REFERENCE.filter((entry) => entry.kind === option).length}
              </span>
            </button>
          ))}
        </fieldset>
      )}
      {entries.length === 0 ? (
        <p className="learn-muted" role="status">
          Nothing matches “{query.trim()}”.
        </p>
      ) : (
        <dl className="learn-glossary-grid learn-reference-grid">
          {entries.map((entry) => (
            <div key={`${entry.kind}:${entry.name}`}>
              <dt>
                <code>{entry.name}</code>
                {query.trim() && <span className="learn-muted"> · {entry.kind}</span>}
              </dt>
              <dd>{entry.summary}</dd>
              <dd>
                <button
                  type="button"
                  className="learn-reference-link"
                  onClick={() => onJump(entry.section)}
                >
                  {SECTION_TITLES.get(entry.section) ?? entry.section} →
                </button>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
