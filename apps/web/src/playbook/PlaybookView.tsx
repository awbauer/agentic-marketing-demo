import { useMemo } from "react";
import { pageHost } from "@northstar/contracts";
import { useAiPlatform } from "../ai-platform";
import { Markdown } from "../Markdown";
import { learnFor } from "../learn/host";
import { IN_THE_WORKBENCH, PLAYBOOK } from "./playbook";
import "../learn/learn.css";
import "./playbook.css";

// Scroll only the view's own container; scrollIntoView would also scroll the page.
function jumpTo(id: string) {
  const target = document.getElementById(`playbook-${id}`);
  const container = target?.closest<HTMLElement>(".playbook-view");
  if (!target || !container) return;
  const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  container.scrollTo({
    top: container.scrollTop + offset - 8,
    behavior: smooth ? "smooth" : "auto",
  });
  target.focus({ preventScroll: true });
}

export function PlaybookView({
  onClose,
  onOpenLearn,
}: {
  onClose: () => void;
  /** Opens Learn at a section id, or at the top when none is given. */
  onOpenLearn: (section?: string) => void;
}) {
  const { platform } = useAiPlatform();
  // Learn section titles for the "In this workbench" links, as this host and platform name them.
  const learnTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const part of learnFor(pageHost(), platform).parts)
      for (const section of part.sections) titles.set(section.id, section.title);
    return titles;
  }, [platform]);

  return (
    <section className="evaluations-view learn-view playbook-view" aria-labelledby="playbook-title">
      <div className="section-header">
        <div>
          <p className="kicker">Playbook</p>
          <h2 id="playbook-title">{PLAYBOOK.title}</h2>
          {PLAYBOOK.byline && <p className="playbook-byline">{PLAYBOOK.byline}</p>}
        </div>
        <button type="button" className="text-button evaluations-back" onClick={onClose}>
          Back to workspace
        </button>
      </div>

      <p className="playbook-note">
        General guidance for running agents in production. For how this workbench puts it into
        practice, see{" "}
        <button type="button" className="text-button" onClick={() => onOpenLearn()}>
          Learn
        </button>
        , or the links under each section.
      </p>

      <div className="learn-layout">
        <nav className="learn-toc" aria-label="Playbook contents">
          <ol>
            {PLAYBOOK.sections.map((section) => (
              <li key={section.id}>
                <button type="button" onClick={() => jumpTo(section.id)}>
                  {section.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="learn-body">
          {PLAYBOOK.sections.map((section) => {
            const links = (IN_THE_WORKBENCH[section.id] ?? []).filter((id) => learnTitles.has(id));
            return (
              <article
                key={section.id}
                id={`playbook-${section.id}`}
                className="learn-section playbook-section"
                tabIndex={-1}
                aria-labelledby={`playbook-${section.id}-title`}
              >
                <h3 id={`playbook-${section.id}-title`}>{section.title}</h3>
                <Markdown text={section.body} />
                {links.length > 0 && (
                  <aside className="playbook-in-workbench" aria-label="In this workbench">
                    <span>In this workbench:</span>
                    {links.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="text-button"
                        onClick={() => onOpenLearn(id)}
                      >
                        {learnTitles.get(id)}
                      </button>
                    ))}
                  </aside>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
