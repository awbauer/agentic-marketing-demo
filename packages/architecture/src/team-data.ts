// The sample market data behind the campaign team's tools. It stands in for the systems a real
// agency would query (a segmentation tool, a competitive tracker, a social listening feed, the
// brand book, a media-buying benchmark set). Every brand, competitor and number here is fictional,
// and nothing names or identifies a person.
import type { Brand } from "./types.ts";

export const MEDIA_CHANNELS = [
  "paid-search",
  "paid-social",
  "display",
  "online-video",
  "email",
  "podcast",
] as const;
export type MediaChannel = (typeof MEDIA_CHANNELS)[number];

export const MEDIA_CHANNEL_LABELS: Record<MediaChannel, string> = {
  "paid-search": "Paid search",
  "paid-social": "Paid social",
  display: "Display",
  "online-video": "Online video",
  email: "Email",
  podcast: "Podcast audio",
};

export type Segment = {
  id: string;
  name: string;
  /** Reachable people in the market, rounded. */
  size: number;
  description: string;
  /** How well each channel reaches the segment: 1 is typical. */
  affinity: Partial<Record<MediaChannel, number>>;
};

export type Competitor = {
  id: string;
  name: string;
  positioning: string;
  /** Share of category advertising voice, 0 to 1. */
  shareOfVoice: number;
  recentMove: string;
};

export type MarketSignal = {
  id: string;
  signal: string;
  source: string;
  trend: "up" | "flat" | "down";
};

export type BrandGuidelines = {
  voice: string;
  palette: ReadonlyArray<{ name: string; hex: string }>;
  typography: string;
  imageryDo: readonly string[];
  imageryDont: readonly string[];
  /** Words and phrases copy may never use. Matched case-insensitively. */
  bannedPhrases: readonly string[];
  /** Text every piece of copy must carry, or null when none is required. */
  requiredDisclosure: string | null;
};

export type ChannelBenchmark = {
  /** Cost per thousand impressions, in USD. */
  cpm: number;
  /** Click-through rate, 0 to 1. */
  ctr: number;
  /** The smallest spend worth buying, in USD. */
  minSpendUsd: number;
  /** Copy limits for this channel's format, in characters. */
  headlineMax: number;
  bodyMax: number;
};

export type BrandMarket = {
  category: string;
  segments: readonly Segment[];
  competitors: readonly Competitor[];
  signals: readonly MarketSignal[];
  guidelines: BrandGuidelines;
  /** Channels the brand may buy, with their benchmarks. A channel missing here is not allowed. */
  benchmarks: Partial<Record<MediaChannel, ChannelBenchmark>>;
};

const limits = {
  "paid-search": { headlineMax: 30, bodyMax: 90 },
  "paid-social": { headlineMax: 40, bodyMax: 125 },
  display: { headlineMax: 30, bodyMax: 90 },
  "online-video": { headlineMax: 40, bodyMax: 150 },
  email: { headlineMax: 60, bodyMax: 400 },
  podcast: { headlineMax: 40, bodyMax: 400 },
} as const satisfies Record<MediaChannel, { headlineMax: number; bodyMax: number }>;

const bench = (channel: MediaChannel, cpm: number, ctr: number, minSpendUsd: number) => ({
  cpm,
  ctr,
  minSpendUsd,
  ...limits[channel],
});

export const TEAM_MARKETS: Record<Brand, BrandMarket> = {
  "Coastline Kitchen": {
    category: "Casual seafood restaurants, San Francisco Bay Area",
    segments: [
      {
        id: "ck-seg-lunch-commuters",
        name: "Weekday lunch commuters",
        size: 182000,
        description:
          "Office workers within a mile of a location who buy lunch out three or more days a week.",
        affinity: { "paid-search": 1.3, "paid-social": 1.1, display: 0.8, email: 1.2 },
      },
      {
        id: "ck-seg-weekend-families",
        name: "Weekend families",
        size: 96000,
        description: "Households with children who plan a sit-down meal out most weekends.",
        affinity: { "paid-social": 1.4, "online-video": 1.2, email: 1.1, display: 0.9 },
      },
      {
        id: "ck-seg-loyalty-regulars",
        name: "Loyalty regulars",
        size: 41000,
        description: "Loyalty members who visited at least monthly over the past year.",
        affinity: { email: 1.8, "paid-social": 0.9 },
      },
      {
        id: "ck-seg-food-explorers",
        name: "Food explorers",
        size: 64000,
        description: "Diners who follow local food media and try new seasonal menus early.",
        affinity: { "paid-social": 1.5, podcast: 1.3, "online-video": 1.2 },
      },
    ],
    competitors: [
      {
        id: "ck-comp-harbor-grill",
        name: "Harbor Grill Co.",
        positioning: "Premium waterfront dining for occasions.",
        shareOfVoice: 0.31,
        recentMove: "Launched a $45 winter prix fixe with heavy display spend.",
      },
      {
        id: "ck-comp-bowl-bar",
        name: "Bowl & Bar",
        positioning: "Fast-casual soups and grain bowls, delivery first.",
        shareOfVoice: 0.24,
        recentMove: "Doubled paid social around rainy-day delivery offers.",
      },
      {
        id: "ck-comp-pier-nine",
        name: "Pier Nine Fish House",
        positioning: "Family seafood at value prices.",
        shareOfVoice: 0.12,
        recentMove: "Quiet since summer; no seasonal campaign this year.",
      },
    ],
    signals: [
      {
        id: "ck-sig-cold-weather",
        signal: "Searches for 'chowder near me' rise about 60% in weeks with highs under 55°F.",
        source: "Search trend panel",
        trend: "up",
      },
      {
        id: "ck-sig-lunch-recovery",
        signal:
          "Downtown weekday lunch traffic is back to 82% of its 2019 level and still climbing.",
        source: "Foot-traffic panel",
        trend: "up",
      },
      {
        id: "ck-sig-delivery-fatigue",
        signal: "Diners cite delivery fees as the top reason to choose dine-in for comfort food.",
        source: "Diner survey, 1,200 respondents",
        trend: "up",
      },
    ],
    guidelines: {
      voice: "Warm, local and a little playful. Short sentences. Food first, never smug.",
      palette: [
        { name: "Harbor Blue", hex: "#1F4E79" },
        { name: "Sea Foam", hex: "#A8DADC" },
        { name: "Chowder Cream", hex: "#F1E9DA" },
        { name: "Buoy Red", hex: "#E63946" },
      ],
      typography: "Headlines in a rounded slab serif; body in a humanist sans.",
      imageryDo: ["steam rising from a bowl", "real guests at the counter", "fog over the bay"],
      imageryDont: ["stock models", "raw seafood on ice", "competitor logos"],
      bannedPhrases: ["best in the world", "world-famous", "cheapest"],
      requiredDisclosure: null,
    },
    benchmarks: {
      "paid-search": bench("paid-search", 38, 0.045, 1500),
      "paid-social": bench("paid-social", 9.5, 0.012, 1500),
      display: bench("display", 4.2, 0.0018, 1000),
      "online-video": bench("online-video", 18, 0.006, 2500),
      email: bench("email", 2.5, 0.031, 300),
      podcast: bench("podcast", 22, 0.002, 3000),
    },
  },
  "Harborstone Wealth": {
    category: "High-yield cash management for mass-affluent investors",
    segments: [
      {
        id: "hs-seg-idle-cash",
        name: "Idle cash holders",
        size: 240000,
        description: "Existing clients with more than $25k in a non-interest checking account.",
        affinity: { email: 1.7, display: 1.0, "paid-search": 1.1 },
      },
      {
        id: "hs-seg-rate-shoppers",
        name: "Rate shoppers",
        size: 410000,
        description: "Prospects who compare savings rates online at least quarterly.",
        affinity: { "paid-search": 1.8, display: 1.1, "paid-social": 0.9 },
      },
      {
        id: "hs-seg-business-owners",
        name: "Small-business owners",
        size: 88000,
        description: "Owners of businesses under 50 employees with operating cash at other banks.",
        affinity: { "paid-search": 1.2, podcast: 1.4, "online-video": 1.0 },
      },
    ],
    competitors: [
      {
        id: "hs-comp-meridian",
        name: "Meridian Direct",
        positioning: "Online-only savings with a headline rate.",
        shareOfVoice: 0.36,
        recentMove: "Cut its savings rate twice since September but kept the ad spend.",
      },
      {
        id: "hs-comp-oakline",
        name: "Oakline Private",
        positioning: "Relationship banking for high-net-worth clients.",
        shareOfVoice: 0.22,
        recentMove: "Sponsoring two business podcasts this quarter.",
      },
    ],
    signals: [
      {
        id: "hs-sig-rate-attention",
        signal: "Searches for 'sweep account rate' are up 40% since the October rate decision.",
        source: "Search trend panel",
        trend: "up",
      },
      {
        id: "hs-sig-trust",
        signal: "Prospects rank deposit insurance above rate when choosing where to hold cash.",
        source: "Investor survey, 2,000 respondents",
        trend: "flat",
      },
      {
        id: "hs-sig-idle-balances",
        signal: "Average idle checking balances among existing clients grew 12% this year.",
        source: "Internal balance analytics, aggregated",
        trend: "up",
      },
    ],
    guidelines: {
      voice: "Calm, precise and plain-spoken. Explain, never hype. No exclamation marks.",
      palette: [
        { name: "Deep Harbor", hex: "#0B2545" },
        { name: "Slate", hex: "#5C6B73" },
        { name: "Brass", hex: "#C9A227" },
        { name: "Fog White", hex: "#F4F6F8" },
      ],
      typography: "Headlines in a transitional serif; body and figures in a tabular sans.",
      imageryDo: ["calm interiors", "hands reviewing a statement", "harbor at dawn"],
      imageryDont: ["stacks of cash", "luxury cars", "upward arrows"],
      bannedPhrases: ["guaranteed returns", "risk-free", "get rich", "best rate"],
      requiredDisclosure:
        "Rates are variable and may change. Deposits are FDIC insured up to applicable limits.",
    },
    benchmarks: {
      "paid-search": bench("paid-search", 62, 0.038, 5000),
      display: bench("display", 7.5, 0.0015, 3000),
      "online-video": bench("online-video", 24, 0.005, 6000),
      email: bench("email", 1.8, 0.026, 500),
      podcast: bench("podcast", 28, 0.002, 6000),
      "paid-social": bench("paid-social", 12, 0.008, 4000),
    },
  },
  "Lumera Therapeutics": {
    category: "Heart failure therapy awareness among US cardiologists",
    segments: [
      {
        id: "lt-seg-hf-specialists",
        name: "Heart failure specialists",
        size: 4200,
        description: "Advanced heart failure and transplant cardiologists.",
        affinity: { email: 1.9, display: 1.3, "paid-search": 1.0 },
      },
      {
        id: "lt-seg-general-cardiology",
        name: "General cardiologists",
        size: 22000,
        description: "Office-based cardiologists who manage heart failure among other conditions.",
        affinity: { display: 1.4, email: 1.3, "online-video": 1.1, "paid-search": 1.0 },
      },
      {
        id: "lt-seg-hf-nurses",
        name: "Heart failure nurse practitioners",
        size: 9800,
        description: "Nurse practitioners who run heart failure clinics and titrate therapy.",
        affinity: { email: 1.5, podcast: 1.3, "online-video": 1.2 },
      },
    ],
    competitors: [
      {
        id: "lt-comp-veltrix",
        name: "Veltrix Pharma",
        positioning: "Established ARNI with broad guideline support.",
        shareOfVoice: 0.48,
        recentMove: "Heavy medical-journal display around the November congress.",
      },
      {
        id: "lt-comp-norvane",
        name: "Norvane Bio",
        positioning: "Newer entrant emphasizing once-daily dosing.",
        shareOfVoice: 0.17,
        recentMove: "Launched a nurse-practitioner education podcast.",
      },
    ],
    signals: [
      {
        id: "lt-sig-congress-data",
        signal: "Outcomes data presented at the November congress drove a spike in HCP searches.",
        source: "HCP search panel",
        trend: "up",
      },
      {
        id: "lt-sig-np-role",
        signal: "Nurse practitioners now initiate a growing share of heart failure titrations.",
        source: "Prescribing trend panel, aggregated",
        trend: "up",
      },
      {
        id: "lt-sig-email-fatigue",
        signal: "HCP email open rates fall when a brand sends more than twice a month.",
        source: "HCP engagement benchmark",
        trend: "down",
      },
    ],
    guidelines: {
      voice: "Clinical, balanced and evidence-led. State results, never promise outcomes.",
      palette: [
        { name: "Lumera Teal", hex: "#00797C" },
        { name: "Pulse Coral", hex: "#F26B5B" },
        { name: "Graphite", hex: "#2E3440" },
        { name: "Clinic White", hex: "#FAFAFA" },
      ],
      typography: "Headlines in a geometric sans; body in a highly legible text sans.",
      imageryDo: ["clinicians in conversation", "data visualizations", "a heart rhythm line"],
      imageryDont: ["patients in distress", "before-and-after images", "competitor products"],
      bannedPhrases: ["cure", "miracle", "superior to", "best treatment", "guaranteed"],
      requiredDisclosure:
        "For US healthcare professionals only. See full Prescribing Information, including Boxed Warning.",
    },
    benchmarks: {
      email: bench("email", 3.5, 0.034, 1000),
      display: bench("display", 28, 0.0022, 8000),
      "paid-search": bench("paid-search", 85, 0.03, 6000),
      "online-video": bench("online-video", 45, 0.004, 10000),
      podcast: bench("podcast", 35, 0.002, 8000),
    },
  },
};

export const teamMarket = (brand: Brand): BrandMarket => TEAM_MARKETS[brand];
