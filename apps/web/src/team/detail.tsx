// Two audiences read the squad page: people who know the content lifecycle (brief, concept, MLR,
// approval, deployment) and people who want to see the machinery. Everything is on the page for
// both; "Technical detail" decides whether the machinery shows inline (tool names, model ids,
// token counts, the lead's raw instruction) or one click away. The choice is kept in this browser.
// `Term` gives a technical word a plain-language tooltip from the glossary below.
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

const KEY = "northstar.squad.technical";

const TechnicalContext = createContext(false);
export const TechnicalProvider = TechnicalContext.Provider;
/** Whether the reader asked to see the technical detail inline. */
export const useTechnical = () => useContext(TechnicalContext);

/** The reader's choice, kept in local storage; off by default. */
export function useTechnicalSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback((value: boolean) => {
    setOn(value);
    try {
      localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  }, []);
  return [on, set];
}

/** Technical words in a content team's terms. */
export const GLOSSARY = {
  "tool call":
    "An action an agent takes, such as looking up data or handing in a draft. Each one is checked before it runs.",
  "model call": "One request to the AI model: it reads the context and decides what to do next.",
  tokens: "AI usage, roughly the words the models read and wrote. It drives the cost.",
  gateway:
    "Access control: each agent may use only the actions it was granted. Anything else is blocked and logged.",
  "blocked action":
    "An action the agent was not permitted to take. It never ran, and it is logged.",
  "pre-check":
    "A rules check in code, before any person reviews the work. It never replaces Medical, Legal or Regulatory review.",
  hub: "The project lead agent in the middle: it routes work and decisions, and does none of the work itself.",
  "semantic layer":
    "The data dictionary: the approved definitions of segments, deciles and metrics that agents must use.",
  evals: "A quality scorecard for the run, worked out from what happened.",
} as const;
export type GlossaryTerm = keyof typeof GLOSSARY;

/** A technical word with its plain meaning on hover or focus. */
export function Term({ term, children }: { term: GlossaryTerm; children?: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard and touch readers can reach the definition.
    <span className="team-term" title={GLOSSARY[term]} tabIndex={0}>
      {children ?? term}
    </span>
  );
}
