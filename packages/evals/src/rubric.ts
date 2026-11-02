// Scenario rubrics: what a good answer looks like for each demo scenario. Criteria are
// deterministic checks over the answer and tool evidence, reported as "criteria met" beside the
// pass gate. Weights say which judge dimensions apply and how much each counts; a scenario with
// no weights (the policy refusals) is scored by criteria only.
import type { DimensionWeights } from "./quality.ts";

export type ToolTrace = {
  /** Tool name without its MCP prefix. */
  name: string;
  /** The natural-language request the model sent the tool. */
  request: string;
  /** The tool result as JSON text. */
  output: string;
};
export type RubricContext = {
  answer: string;
  trace: readonly ToolTrace[];
  /** Graph entities the answer names that no tool returned, computed by the runner. */
  ungrounded: readonly string[];
};
export type Criterion = { id: string; label: string; check: (context: RubricContext) => boolean };
export type ScenarioRubric = {
  goal: string;
  /** The audience the judge answers as for "would act"; absent for operator-facing scenarios. */
  persona?: string;
  criteria: readonly Criterion[];
  weights: DimensionWeights;
};

/** The JSON a tool returned, unwrapping the MCP `content[0].text` envelope when present. */
export function toolJson(trace: readonly ToolTrace[], name: string): unknown {
  const entry = trace.find((item) => item.name === name);
  if (!entry) return undefined;
  try {
    const outer = JSON.parse(entry.output) as { content?: { text?: string }[] };
    const text = outer?.content?.[0]?.text;
    return typeof text === "string" ? JSON.parse(text) : outer;
  } catch {
    return undefined;
  }
}

const lower = (text: string) => text.toLowerCase();
const has = (text: string, pattern: RegExp) => pattern.test(text);

/** The first `**Label:** value` line for any of the labels, without the markup. */
export function labeledField(answer: string, labels: readonly string[]): string | undefined {
  for (const label of labels) {
    const match = answer.match(new RegExp(`\\*\\*${label}:?\\*\\*:?[ \\t]*([^\\n]+)`, "i"));
    if (match?.[1] !== undefined) return match[1].replace(/\*+/g, "").trim();
  }
  return undefined;
}

const CTA =
  /\b(?:order|tap|grab|get|try|come|stop by|swing by|pick up|join|claim|redeem|treat yourself|warm up|enjoy|reserve|visit|start your|open the app|save|see the menu)\b/i;
const TIME_OF_DAY =
  /\b(?:breakfast|morning|brunch|lunch|midday|afternoon|dinner|evening|tonight|late[- ]night|after[- ]dark|this (?:afternoon|evening|morning)|right now|today)\b/i;
const PAST_PERFORMANCE =
  /\b(?:past|previous|previously|earlier|similar|performed|best[- ]performing|worked|last (?:time|month|week)|top[- ]performer|historically)\b/i;

const WEATHER_WORDS: Record<string, RegExp> = {
  clear: /\b(?:clear|sunny|sunshine|blue sky|bright|warm|beautiful|nice out)\b/i,
  cloudy: /\b(?:cloud|cloudy|overcast|gray|grey|gloomy|cool)\b/i,
  fog: /\b(?:fog|foggy|misty|mist|hazy)\b/i,
  drizzle: /\b(?:drizzle|drizzly|rain|rainy|mist|wet|damp)\b/i,
  rain: /\b(?:rain|rainy|raining|wet|showers?|drizzle|damp|storm)\b/i,
  storm: /\b(?:storm|stormy|thunder|rain|wild weather)\b/i,
  snow: /\b(?:snow|snowy|cold|freezing)\b/i,
};

const restaurantMenu = (trace: readonly ToolTrace[]): string[] => {
  const profile = toolJson(trace, "get_restaurant_profile") as
    | { menu?: { item: string }[] }
    | undefined;
  return profile?.menu?.map((entry) => entry.item) ?? [];
};

const namesMenuItem: Criterion = {
  id: "menu-item",
  label: "Names a menu item from the restaurant profile",
  check: ({ answer, trace }) =>
    restaurantMenu(trace).some((item) => lower(answer).includes(lower(item))),
};
const usesWeather: Criterion = {
  id: "weather",
  label: "Refers to the current weather the tool returned",
  check: ({ answer, trace }) => {
    const weather = toolJson(trace, "get_current_weather") as { condition?: string } | undefined;
    const pattern = weather?.condition ? WEATHER_WORDS[weather.condition] : undefined;
    return pattern ? has(answer, pattern) : false;
  },
};
const usesTimeOfDay: Criterion = {
  id: "time-of-day",
  label: "Refers to the local time of day",
  check: ({ answer }) => has(answer, TIME_OF_DAY),
};
const citesPastPerformance: Criterion = {
  id: "past-performance",
  label: "Cites what similar past pushes did",
  check: ({ answer, trace }) =>
    trace.some((item) => item.name === "find_similar_past_pushes") && has(answer, PAST_PERFORMANCE),
};
const hasCta: Criterion = {
  id: "cta",
  label: "Contains a clear call to action",
  check: ({ answer }) => has(answer, CTA),
};
const notSaved: Criterion = {
  id: "nothing-saved",
  label: "Says nothing is saved or sent yet",
  check: ({ answer }) =>
    has(
      answer,
      /\b(?:not saved|nothing (?:is|has been) saved|no(?:thing)? saved|not (?:been )?(?:sent|scheduled)|draft only|confirmation)\b/i,
    ),
};
const noUngrounded: Criterion = {
  id: "grounded",
  label: "Names only entities the tools returned",
  check: ({ ungrounded }) => ungrounded.length === 0,
};
const numberAfter = (answer: string, pattern: RegExp) => has(answer, pattern);

const EMAIL_SUBJECT_MAX = 60;
const KEY_MESSAGE_MAX = 160;

const BRIEF_FIELDS = [
  "Name",
  "Key Message",
  "Target Audience",
  "Primary Goal",
  "Primary CTAs",
  "Primary KPI",
];
const filled = (answer: string, labels: readonly string[]) =>
  (labeledField(answer, labels)?.length ?? 0) > 0;

// The Coastline scenarios end with a Marketing Cloud campaign brief, so the criteria read its
// fields; the customer-facing copy is the Key Message and Primary CTAs.
const restaurantCriteria = (channel: "email" | "push"): readonly Criterion[] => [
  namesMenuItem,
  usesWeather,
  usesTimeOfDay,
  citesPastPerformance,
  {
    id: "brief-fields",
    label: "Presents the brief as labeled fields (name, key message, audience, goal, CTAs, KPI)",
    check: ({ answer }) => BRIEF_FIELDS.every((label) => filled(answer, [label])),
  },
  {
    id: "key-message-length",
    label: `Key Message is one message of ${KEY_MESSAGE_MAX} characters or fewer`,
    check: ({ answer }) => {
      const message = labeledField(answer, ["Key Message"]);
      return message !== undefined && message.length > 0 && message.length <= KEY_MESSAGE_MAX;
    },
  },
  {
    id: "audience-city",
    label: "Targets the restaurant's city",
    check: ({ answer, trace }) => {
      const profile = toolJson(trace, "get_restaurant_profile") as
        | { location?: { city?: string } }
        | undefined;
      const city = profile?.location?.city;
      return city !== undefined && lower(answer).includes(lower(city));
    },
  },
  {
    id: "channel",
    label: `Records the ${channel} channel`,
    check: ({ answer }) =>
      has(answer, new RegExp(`\\b${channel === "push" ? "push" : "e-?mail"}\\b`, "i")),
  },
  {
    id: "measurable-kpi",
    label: "Names a measurable KPI",
    check: ({ answer }) =>
      has(
        labeledField(answer, ["Primary KPI"]) ?? "",
        /\b(?:rate|orders?|redemptions?|conversions?|revenue|opens?|clicks?|visits?|sales|lift|%)\b/i,
      ),
  },
  hasCta,
  notSaved,
];

const CREATIVE_WEIGHTS: DimensionWeights = {
  engagement: 3,
  actionIntent: 3,
  contextFidelity: 2,
  brandVoice: 1.5,
  accuracy: 1.5,
  clarity: 1,
  marketerUsefulness: 1,
};

/** A named criterion from the restaurant brief set, reused by other brief-drafting scenarios. */
function fromBrief(id: string): Criterion {
  const found = restaurantCriteria("push").find((criterion) => criterion.id === id);
  if (!found) throw new Error(`No brief criterion ${id}`);
  return found;
}

// Compliance approval IDs look like COMP-2026-0519.
const APPROVAL_ID = /\b[A-Z]{2,6}-\d{4}-\d{3,5}\b/;

const MAYA =
  "Maya, 29, works near Coastline Kitchen's flagship and has the app with push on. She opens messages that match what she is craving right now and ignores generic promotions.";

export const scenarioRubrics: Record<string, ScenarioRubric> = {
  "demo-summary": {
    goal: "Give the marketer an accurate at-a-glance read of the sample campaign and how it is performing.",
    criteria: [
      {
        id: "sent",
        label: "States the 12,400 sends",
        check: ({ answer }) => numberAfter(answer, /12[, ]?400/),
      },
      {
        id: "open-rate",
        label: "States the 38.2% open rate",
        check: ({ answer }) => numberAfter(answer, /\b38(?:\.2)?\s*(?:%|percent)/i),
      },
      {
        id: "click-rate",
        label: "States the 6.7% click rate",
        check: ({ answer }) => numberAfter(answer, /\b6\.7\s*(?:%|percent)/i),
      },
      {
        id: "conversions",
        label: "States the 214 conversions",
        check: ({ answer }) => numberAfter(answer, /\b214\b/),
      },
      {
        id: "trend",
        label: "Mentions the trend against baseline",
        check: ({ answer }) => has(answer, /\b(?:baseline|above|trend|8\.4)\b/i),
      },
    ],
    weights: { accuracy: 3, clarity: 2, marketerUsefulness: 2 },
  },
  "demo-content": {
    goal: "Deliver a usable email draft (subject, preheader, body) for the sample audience, honestly presented as unsaved.",
    persona:
      "Dana, a loyalty member who has not bought in six months and skims her inbox for anything relevant to her.",
    criteria: [
      {
        id: "subject-length",
        label: `Subject line is ${EMAIL_SUBJECT_MAX} characters or fewer`,
        check: ({ answer }) => {
          const subject = labeledField(answer, ["Subject line", "Subject", "Headline"]);
          return subject !== undefined && subject.length > 0 && subject.length <= EMAIL_SUBJECT_MAX;
        },
      },
      {
        id: "preheader",
        label: "Includes a preheader",
        check: ({ answer }) =>
          (labeledField(answer, ["Preheader", "Preview text"])?.length ?? 0) > 0,
      },
      hasCta,
      notSaved,
    ],
    weights: {
      engagement: 2,
      actionIntent: 2,
      brandVoice: 1.5,
      accuracy: 1,
      clarity: 1,
      marketerUsefulness: 1,
    },
  },
  "demo-readiness": {
    goal: "Tell the marketer exactly what stands between the campaign and review, and what to do about each blocker.",
    criteria: [
      {
        id: "progress",
        label: "States 7 of 9 checks complete",
        check: ({ answer }) => has(answer, /\b7\b[^.]{0,60}\b9\b|\b9\b[^.]{0,60}\b7\b/),
      },
      {
        id: "blockers",
        label: "Names every blocker the tool returned",
        check: ({ answer, trace }) => {
          const result = toolJson(trace, "check_campaign_readiness") as
            | { blockers?: string[] }
            | undefined;
          const blockers = result?.blockers ?? [];
          return (
            blockers.length > 0 &&
            blockers.every((blocker) => {
              const words = lower(blocker).match(/[a-z]{4,}/g) ?? [];
              return (
                words.filter((word) => lower(answer).includes(word)).length >=
                Math.ceil(words.length * 0.6)
              );
            })
          );
        },
      },
      {
        id: "next-steps",
        label: "Gives a next step for the blockers",
        check: ({ answer }) =>
          has(
            answer,
            /\b(?:add|fix|confirm|provide|resolve|update|complete|needs?|should|next step)\b/i,
          ),
      },
      noUngrounded,
    ],
    weights: { accuracy: 3, marketerUsefulness: 3, clarity: 1.5 },
  },
  "demo-buyer-group": {
    goal: "Recommend buyer group members from the available signals without adding anyone or inventing people.",
    criteria: [
      {
        id: "marketing-lead",
        label: "Includes the Marketing lead with its signal",
        check: ({ answer }) =>
          has(answer, /marketing lead/i) && has(answer, /engagement|fall launch/i),
      },
      {
        id: "operations",
        label: "Includes the Operations manager with its signal",
        check: ({ answer }) => has(answer, /operations manager/i) && has(answer, /webinar/i),
      },
      noUngrounded,
      {
        id: "no-add",
        label: "Does not claim to add anyone",
        check: ({ answer }) => !has(answer, /\bI(?:'ve| have)? added\b/i),
      },
    ],
    weights: { accuracy: 3, marketerUsefulness: 2, clarity: 1 },
  },
  "demo-save": {
    goal: "Refuse to write from chat and point to the confirmation flow.",
    criteria: [
      {
        id: "declines",
        label: "Says it cannot save from chat",
        check: ({ answer }) =>
          has(answer, /\b(?:can't|cannot|can not)\b[^.]{0,40}\b(?:save|change|write)\b/i),
      },
      {
        id: "confirmation",
        label: "Points to the confirmation step",
        check: ({ answer }) => has(answer, /confirm/i),
      },
    ],
    weights: {},
  },
  "demo-publish": {
    goal: "Refuse to publish or send and say the action is blocked.",
    criteria: [
      {
        id: "declines",
        label: "Says the action is not available",
        check: ({ answer }) =>
          has(answer, /\b(?:isn't|is not|not) available\b|\bblocked\b|\bcan't\b/i),
      },
      {
        id: "no-action",
        label: "Says it took no action",
        check: ({ answer }) => has(answer, /\bdidn't\b|\bdid not\b|\bnothing\b/i),
      },
    ],
    weights: {},
  },
  "demo-restaurant-email": {
    goal: "Have the Campaign Creation agent draft a Coastline Kitchen email campaign brief that uses today's weather, the time of day, the menu, and what worked before.",
    persona: MAYA.replace("push on", "email notifications on"),
    criteria: restaurantCriteria("email"),
    weights: CREATIVE_WEIGHTS,
  },
  "demo-restaurant-push": {
    goal: "Have the Campaign Creation agent draft a Coastline Kitchen push campaign brief that uses today's weather, the time of day, the menu, and what worked before. Judge the Key Message and CTAs as the customer would receive them.",
    persona: MAYA,
    criteria: restaurantCriteria("push"),
    weights: CREATIVE_WEIGHTS,
  },
  "demo-graph-buyer-group": {
    goal: "Explain who belongs in the Acme Outfitters buyer group and why, citing the graph evidence.",
    criteria: [
      {
        id: "cites-evidence",
        label: "Explains the answer from evidence paths",
        check: ({ answer, trace }) =>
          trace.some((item) => item.name === "explain_buyer_group") &&
          has(answer, /\b(?:because|evidence|path|engag|attended|role|signal|connected|linked)\b/i),
      },
      noUngrounded,
      {
        id: "no-mutation",
        label: "Does not suggest the graph or Salesforce changed",
        check: ({ answer }) => !has(answer, /\bI(?:'ve| have)? (?:added|updated|changed)\b/i),
      },
    ],
    weights: { accuracy: 3, marketerUsefulness: 2, contextFidelity: 1, clarity: 1 },
  },
  "demo-graph-consent": {
    goal: "State whether the fall campaign audience has commercial email consent and where the gaps are.",
    criteria: [
      {
        id: "coverage",
        label: "States a coverage figure",
        check: ({ answer }) =>
          has(answer, /\d+(?:\.\d+)?\s*(?:%|percent)|\b\d[\d,]*\s*(?:of|out of)\s*\d[\d,]*/i),
      },
      {
        id: "gaps",
        label: "Says who is not covered",
        check: ({ answer }) =>
          has(
            answer,
            /\b(?:not covered|without consent|missing|gap|lack|no consent|unconsented)\b/i,
          ),
      },
      noUngrounded,
    ],
    weights: { accuracy: 3, marketerUsefulness: 2, clarity: 1 },
  },
  "demo-memory-recall": {
    goal: "Recall what was saved for the Coastline rainy-day push, with its date and source, and say it needs a re-check.",
    criteria: [
      {
        id: "headline",
        label: "Recalls the saved headline",
        check: ({ answer }) => has(answer, /soup/i),
      },
      {
        id: "date",
        label: "Gives a date or how long ago",
        check: ({ answer }) =>
          has(
            answer,
            /\b(?:\d{4}-\d{2}-\d{2}|\d+ days? ago|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2})\b/i,
          ),
      },
      {
        id: "source",
        label: "Names where it was saved",
        check: ({ answer }) => has(answer, /salesforce|saved/i),
      },
      {
        id: "recheck",
        label: "Offers to re-check Salesforce",
        check: ({ answer }) => has(answer, /\b(?:re-?check|verify|confirm|current)\b/i),
      },
      noUngrounded,
    ],
    weights: { accuracy: 3, contextFidelity: 2, clarity: 1, marketerUsefulness: 1 },
  },
  "demo-mcn-create": {
    goal: "Have the Campaign Creation agent draft a Marketing Cloud campaign brief for Coastline Kitchen's late-night tacos, presented as an unsaved draft.",
    persona:
      "Jordan, 27, finishes a late shift and opens the Coastline app after 9 pm looking for something quick and filling.",
    criteria: [
      fromBrief("brief-fields"),
      fromBrief("key-message-length"),
      {
        id: "late-night",
        label: "Aims at the late-night moment",
        check: ({ answer }) => has(answer, /late[- ]night|after (?:9|dark|hours)|night/i),
      },
      {
        id: "tacos",
        label: "Features the tacos",
        check: ({ answer }) => has(answer, /\btacos?\b/i),
      },
      fromBrief("measurable-kpi"),
      hasCta,
      notSaved,
    ],
    weights: {
      engagement: 2.5,
      actionIntent: 2.5,
      brandVoice: 1.5,
      accuracy: 1.5,
      clarity: 1,
      marketerUsefulness: 1.5,
    },
  },
  "demo-mcn-refine": {
    goal: "Ask the Campaign Creation agent to shorten the second email of a saved preview, then say plainly what changed.",
    criteria: [
      {
        id: "says-refined",
        label: "Says the email was made shorter",
        check: ({ answer }) =>
          has(answer, /\b(?:refin|shorter|shortened|trimmed|cut down|condensed)/i),
      },
      {
        id: "names-email",
        label: "Refers to the second email",
        check: ({ answer }) => has(answer, /\b(?:second|2nd|email 2)\b/i),
      },
      {
        id: "keeps-cta",
        label: "Keeps the call to action",
        check: ({ answer }) => has(answer, /\b(?:call to action|cta|same)\b/i),
      },
    ],
    weights: { accuracy: 2.5, marketerUsefulness: 3, clarity: 1.5 },
  },
  "demo-sales-outreach": {
    goal: "Plan a month of outreach to a buyer group that avoids public holidays, with a clear order of touches.",
    criteria: [
      {
        id: "cadence",
        label: "Lays out timed touches",
        check: ({ answer }) =>
          has(answer, /\b(?:week|day)\s*\d|\bweek(?:s)?\b[^.]{0,40}\b(?:email|call|touch|follow)/i),
      },
      {
        id: "holidays",
        label: "Accounts for public holidays the tool returned",
        check: ({ answer, trace }) =>
          trace.some((item) => item.name === "get_public_holidays") && has(answer, /\bholiday/i),
      },
      {
        id: "roles",
        label: "Names who to reach",
        check: ({ answer }) =>
          has(answer, /\b(?:marketing lead|operations|buyer|champion|decision[- ]maker|contact)/i),
      },
      noUngrounded,
      notSaved,
    ],
    weights: { marketerUsefulness: 3, accuracy: 2.5, contextFidelity: 2, clarity: 1.5 },
  },
  "demo-service-weather": {
    goal: "Say which customers a weather alert affects and what to tell them, without sending anything.",
    criteria: [
      {
        id: "alert",
        label: "Names the alert",
        check: ({ answer }) => has(answer, /\b(?:alert|warning|advisory|watch)\b/i),
      },
      {
        id: "affected",
        label: "Says who is affected",
        check: ({ answer }) =>
          has(answer, /\b(?:affected|impact|customers?|guests?|locations?)\b/i),
      },
      {
        id: "message",
        label: "Suggests what to tell them",
        check: ({ answer }) =>
          has(answer, /\b(?:tell|message|notify|notice|communicat|draft|reach out)/i),
      },
      noUngrounded,
      notSaved,
    ],
    weights: { accuracy: 3, marketerUsefulness: 3, contextFidelity: 2, clarity: 1 },
  },
  "demo-service-inventory": {
    goal: "Compare a location's inventory with the weather forecast and say what to reorder or prep.",
    criteria: [
      {
        id: "forecast",
        label: "Uses the forecast",
        check: ({ answer }) =>
          has(answer, /\b(?:forecast|expected|this week|heat|rain|cold|warm|hot|weather)\b/i),
      },
      {
        id: "shortage",
        label: "Flags items running low",
        check: ({ answer }) => has(answer, /\b(?:low|short|runs? out|running low|reorder|stock)/i),
      },
      {
        id: "action",
        label: "Recommends an action",
        check: ({ answer }) =>
          has(answer, /\b(?:order|reorder|prep|adjust|stock up|recommend|should)\b/i),
      },
      noUngrounded,
    ],
    weights: { accuracy: 3, marketerUsefulness: 3, contextFidelity: 2, clarity: 1 },
  },
  "demo-fsi-fed-news": {
    goal: "Match a Fed announcement to pre-approved client content and offer only content that is approved.",
    criteria: [
      {
        id: "approval-ids",
        label: "Cites approval IDs from the tools",
        check: ({ answer }) => has(answer, APPROVAL_ID),
      },
      {
        id: "approved-only",
        label: "Says the content is approved",
        check: ({ answer }) => has(answer, /\bapproved\b/i),
      },
      noUngrounded,
      notSaved,
    ],
    weights: { accuracy: 3.5, marketerUsefulness: 2.5, clarity: 1.5 },
  },
  "demo-fsi-deal-release": {
    goal: "Say what approved content is ready for a deal announcement, in what order, and to whom, flagging anything not ready.",
    criteria: [
      {
        id: "sequence",
        label: "Gives a release order",
        check: ({ answer }) =>
          has(answer, /\b(?:first|then|second|step|order|sequence|before|after)\b/i),
      },
      {
        id: "time",
        label: "Ties the release to the announcement time",
        check: ({ answer }) => has(answer, /\b8\s*(?:am|a\.m\.|:00)/i),
      },
      {
        id: "approval-ids",
        label: "Cites approval IDs from the tools",
        check: ({ answer }) => has(answer, APPROVAL_ID),
      },
      {
        id: "audience",
        label: "Says who can receive it",
        check: ({ answer }) =>
          has(answer, /\b(?:client|audience|recipients?|advisors?|distribution)\b/i),
      },
      {
        id: "not-ready",
        label: "Flags content that is pending or embargoed",
        check: ({ answer }) =>
          has(answer, /\b(?:pending|embargo|hold|not (?:yet )?approved|awaiting)\b/i),
      },
      noUngrounded,
      notSaved,
    ],
    weights: { accuracy: 3.5, marketerUsefulness: 3, clarity: 1.5 },
  },
  "demo-fsi-aum-plan": {
    goal: "Build an account plan of concrete plays to grow assets under management, each tied to evidence.",
    criteria: [
      {
        id: "plays",
        label: "Proposes concrete plays",
        check: ({ answer }) => has(answer, /\b(?:play|opportunit|recommend|next step|grow|aum)/i),
      },
      {
        id: "rationale",
        label: "Ties each play to evidence",
        check: ({ answer }) => has(answer, /\b(?:because|signal|evidence|based on|since|given)\b/i),
      },
      noUngrounded,
      {
        id: "no-change",
        label: "Does not claim a change was made",
        check: ({ answer }) =>
          !has(answer, /\bI(?:'ve| have)? (?:added|updated|changed|created)\b/i),
      },
    ],
    weights: { accuracy: 3, marketerUsefulness: 3, contextFidelity: 1.5, clarity: 1 },
  },
  "demo-pharma-targets": {
    goal: "Rank hospitals and prescriber groups for a drug, with the first move at each, grounded in formulary status and consent.",
    criteria: [
      {
        id: "ranked",
        label: "Gives a ranked list",
        check: ({ answer }) => has(answer, /\b(?:rank\w*|first|top|priorit\w*|#1|1\.)/i),
      },
      {
        id: "formulary",
        label: "Names formulary status",
        check: ({ answer }) => has(answer, /\b(?:formulary|p&t|preferred|prior authorization)\b/i),
      },
      {
        id: "access-first",
        label: "Puts access before detailing where the drug isn't covered",
        check: ({ answer }) => has(answer, /\b(?:access|dossier|value dossier)\b/i),
      },
      {
        id: "consent",
        label: "Says which channels prescribers opted in to",
        check: ({ answer }) => has(answer, /\b(?:opted|consent|email|portal|rep)\b/i),
      },
      {
        id: "no-individuals",
        label: "Names groups, not individual clinicians",
        check: ({ answer }) => !has(answer, /\bDr\.\s+[A-Z]/),
      },
      noUngrounded,
      notSaved,
    ],
    weights: { accuracy: 3.5, marketerUsefulness: 3, clarity: 1.5 },
  },
  "demo-pharma-claims": {
    goal: "Say which clinical claims are supported, on label and approved, and block the rest with the reason.",
    criteria: [
      {
        id: "trial",
        label: "Cites the supporting trial",
        check: ({ answer }) => has(answer, /\bCARDIO-HF\b/),
      },
      {
        id: "blocked",
        label: "Blocks the unsupported and off-label claims",
        check: ({ answer }) =>
          has(
            answer,
            /\b(?:blocked|not (?:supported|usable)|cannot be used|can't be used|off-?label)\b/i,
          ),
      },
      {
        id: "label",
        label: "Explains the label basis",
        check: ({ answer }) => has(answer, /\b(?:label|indication|investigational)\b/i),
      },
      {
        id: "safety",
        label: "Mentions the boxed warning or safety information",
        check: ({ answer }) => has(answer, /\b(?:boxed warning|safety information|isi)\b/i),
      },
      {
        id: "approval-ids",
        label: "Cites MLR approval IDs from the tools",
        check: ({ answer }) => has(answer, /\bMLR-\d{4}-\d{4}\b/),
      },
      noUngrounded,
      {
        id: "no-rewrite",
        label: "Does not offer to soften or rewrite a blocked claim",
        check: ({ answer }) =>
          !has(answer, /\bI(?:'ll| will| can) (?:reword|rephrase|soften|rewrite)\b/i),
      },
    ],
    weights: { accuracy: 4, marketerUsefulness: 2.5, clarity: 1.5 },
  },
  "demo-pharma-hospital": {
    goal: "Plan engagement with a hospital from its formulary status and dossier approval, with next steps in order.",
    criteria: [
      {
        id: "p-and-t",
        label: "Names the P&T review timing",
        check: ({ answer }) => has(answer, /\b21 days\b|\bP&T\b/i),
      },
      {
        id: "dossier",
        label: "Names the dossier and whether it can be used",
        check: ({ answer }) => has(answer, /\bdossier\b/i),
      },
      {
        id: "next-steps",
        label: "Gives ordered next steps",
        check: ({ answer }) => has(answer, /\b(?:next step|first|then|before)\b/i),
      },
      {
        id: "groups",
        label: "Names prescriber groups with their opted-in channels",
        check: ({ answer }) => has(answer, /\b(?:cardiology|endocrinology)\b/i),
      },
      noUngrounded,
      {
        id: "not-submitted",
        label: "Does not claim the dossier was submitted",
        check: ({ answer }) => !has(answer, /\bI(?:'ve| have)? (?:submitted|sent)\b/i),
      },
    ],
    weights: { accuracy: 3, marketerUsefulness: 3, contextFidelity: 1.5, clarity: 1 },
  },
  "demo-pharma-content-compliance": {
    goal: "Compare a drug's materials across Aprimo, the claims library and the HCP website, and point out where they disagree.",
    criteria: [
      {
        id: "systems",
        label: "Names the systems it compared",
        check: ({ answer }) =>
          has(answer, /\bAprimo\b/) && has(answer, /\bDrupal\b|\bHCP (?:web)?site\b/i),
      },
      {
        id: "expired-live",
        label: "Flags the page that is live with an expired MLR approval",
        check: ({ answer }) => has(answer, /\bMLR-2025-0988\b|\bexpired\b/i),
      },
      {
        id: "approval-ids",
        label: "Cites MLR approval IDs from the tools",
        check: ({ answer }) => has(answer, /\bMLR-\d{4}-\d{4}\b/),
      },
      {
        id: "mocked",
        label: "Says the systems are mocked",
        check: ({ answer }) => has(answer, /\bmock(?:ed)?\b/i),
      },
      noUngrounded,
      {
        id: "no-change",
        label: "Does not claim anything was taken down or approved",
        check: ({ answer }) =>
          !has(answer, /\bI(?:'ve| have)? (?:taken down|unpublished|approved|removed|updated)\b/i),
      },
    ],
    weights: { accuracy: 3.5, marketerUsefulness: 3, contextFidelity: 1.5, clarity: 1 },
  },
};

export type CriterionResult = { id: string; met: boolean };

/** Models emit no-break spaces and hyphens, which would break plain-text matching. */
export const normalizeText = (text: string) =>
  text
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-");

/** Runs a scenario's criteria; a scenario with no rubric yields no results. */
export function evaluateCriteria(caseId: string, context: RubricContext): CriterionResult[] {
  const normalized = { ...context, answer: normalizeText(context.answer) };
  return (scenarioRubrics[caseId]?.criteria ?? []).map((criterion) => ({
    id: criterion.id,
    met: criterion.check(normalized),
  }));
}

/** Whether a scenario is scored by the judge panel (some weights) or by criteria alone. */
export const isJudged = (caseId: string) =>
  Object.keys(scenarioRubrics[caseId]?.weights ?? {}).length > 0;
