import type { FlowEvent, FlowToolStep } from "@northstar/architecture";

// The asset a journey is building, read from the flow's events as they stream: the module the
// authoring agent wrote, block by block, its channel versions, what the probes and readiness
// found, and what never made it in (topics refused for want of an approved claim, and wording the
// service rejected). Nothing here is fetched; it is what the agents' tool calls returned.

export type BlockRole = "headline" | "framing" | "claim" | "disclosure";
export type BlockStatus = "kept" | "rejected" | "refused";
export type AssetFinding = { probe: string; severity: string; message: string; byAgent?: boolean };

export type AssetBlock = {
  id: string;
  role: BlockRole;
  status: BlockStatus;
  text: string;
  claimUrn?: string;
  disclosureUrn?: string;
  topic?: string;
  /** Why the service refused or rejected it. */
  reason?: string;
  /** The agent and the tool call that put it here (or tried to). */
  by: { agent: string; tool: string; policyId?: string };
  /** For a channel headline, which channel it was for. */
  channel?: string;
  findings: AssetFinding[];
};

export type AssetVersion = {
  urn: string;
  channel: string;
  title: string;
  state: string;
  blocks: AssetBlock[];
  /** Channel versions only: characters used, the channel's limit, and whether it fits. */
  length?: number;
  limit?: number;
  blockers: string[];
};

export type Asset = {
  audience?: { theme?: string; segment?: string; audienceSize?: number; sendOn?: string };
  master?: AssetVersion;
  variants: AssetVersion[];
  /** Blocks that never made it into the asset. */
  rejected: AssetBlock[];
  /** Findings not tied to one block. */
  findings: AssetFinding[];
  readiness?: { ready: boolean; blockers: Array<{ code: string; message: string }> };
  /** The authoring agent is working and nothing has come back yet. */
  drafting: boolean;
};

type ModuleView = {
  urn: string;
  title: string;
  state: string;
  attributes: {
    headline: string;
    channel: string;
    topics?: string[];
    blocks: Array<{ text: string; claimUrn?: string; disclosureUrn?: string }>;
  };
};
type By = AssetBlock["by"];

const quoted = (text: string) => `"${text}"`;

/**
 * The pieces of the agent's own words a service error rejected. The service checks each sentence
 * and quotes the one it is about, so the quoted text is what was rejected, and the input it came
 * from says whether it was the headline or the framing.
 */
function rejectedWords(error: string, pieces: ReadonlyArray<[BlockRole, string]>) {
  const found = new Map<string, { role: BlockRole; reasons: string[] }>();
  for (const part of error.split(/(?<=\.)\s+(?=")/)) {
    const text = /^"(.+?)"(?= )/.exec(part)?.[1];
    const role = text ? pieces.find(([, piece]) => piece.includes(text))?.[0] : undefined;
    if (!text || !role) continue;
    const entry = found.get(text) ?? { role, reasons: [] };
    entry.reasons.push(part);
    found.set(text, entry);
  }
  return [...found].map(([text, { role, reasons }]) => ({ text, role, reason: reasons.join(" ") }));
}

function versionOf(view: ModuleView, by: By): AssetVersion {
  const topics = [...(view.attributes.topics ?? [])];
  const blocks: AssetBlock[] = [
    {
      id: `${view.urn}#headline`,
      role: "headline",
      status: "kept",
      text: view.attributes.headline,
      by,
      findings: [],
    },
    ...view.attributes.blocks.map((block, index): AssetBlock => {
      const role: BlockRole = block.claimUrn
        ? "claim"
        : block.disclosureUrn
          ? "disclosure"
          : "framing";
      return {
        id: `${view.urn}#${index}`,
        role,
        status: "kept",
        text: block.text,
        ...(block.claimUrn ? { claimUrn: block.claimUrn, topic: topics.shift() } : {}),
        ...(block.disclosureUrn ? { disclosureUrn: block.disclosureUrn } : {}),
        by,
        findings: [],
      };
    }),
  ];
  return {
    urn: view.urn,
    channel: view.attributes.channel,
    title: view.title,
    state: view.state,
    blocks,
    blockers: [],
  };
}

/** Pins each finding to the block whose text it quotes; the rest belong to the asset. */
function pinFindings(version: AssetVersion, findings: AssetFinding[]) {
  const loose: AssetFinding[] = [];
  for (const block of version.blocks) block.findings = [];
  for (const finding of findings) {
    const block = version.blocks.find(
      (item) =>
        finding.message.includes(quoted(item.text)) ||
        (item.text.length > 20 && finding.message.includes(item.text.slice(0, 80))) ||
        (item.claimUrn && finding.message.includes(item.claimUrn)) ||
        (item.disclosureUrn && finding.message.includes(item.disclosureUrn)),
    );
    if (block) block.findings.push(finding);
    else loose.push(finding);
  }
  return loose;
}

const asObject = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/** The asset as the events so far describe it. */
export function assetOf(events: readonly FlowEvent[]): Asset {
  const asset: Asset = { variants: [], rejected: [], findings: [], drafting: false };
  const agents = new Map<string, string>();
  const open = new Set<string>();
  const findingsByUrn = new Map<string, AssetFinding[]>();
  const advisory: AssetFinding[] = [];
  const seen = new Set<string>();
  const reject = (block: AssetBlock) => {
    const key = `${block.role}|${block.status}|${block.channel ?? ""}|${block.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    asset.rejected.push(block);
  };
  const ours = (urn: unknown) =>
    typeof urn === "string" &&
    (urn === asset.master?.urn || asset.variants.some((item) => item.urn === urn));

  const onTool = (callId: string, step: FlowToolStep) => {
    const by: By = {
      agent: agents.get(callId) ?? "An agent",
      tool: step.tool,
      ...(step.decision ? { policyId: step.decision.policyId } : {}),
    };
    const input = asObject(step.input);
    const output = asObject(step.output);
    if (step.tool === "draft_brief" && step.ok) {
      const wave = asObject(asObject(output.brief).wave);
      asset.audience = {
        theme: wave.theme as string | undefined,
        segment: wave.segment as string | undefined,
        audienceSize: wave.audienceSize as number | undefined,
        sendOn: wave.sendOn as string | undefined,
      };
    }
    if (step.tool === "author_module") {
      const error = step.error ?? (output.error as string | undefined);
      if (!step.ok || error) {
        // The service rejected the agent's own words; each problem quotes the text it is about.
        const pieces: Array<[BlockRole, string]> = [
          ...(typeof input.headline === "string"
            ? [["headline", input.headline] as [BlockRole, string]]
            : []),
          ...[input.opening, input.closing, input.framing].flatMap((texts) =>
            Array.isArray(texts)
              ? texts
                  .filter((text): text is string => typeof text === "string")
                  .map((text) => ["framing", text] as [BlockRole, string])
              : [],
          ),
        ];
        for (const { role, text, reason } of error ? rejectedWords(error, pieces) : [])
          reject({
            id: `${callId}:${role}:${text}`,
            role,
            status: "rejected",
            text,
            reason,
            by,
            findings: [],
          });
        return;
      }
      const module = output.module as ModuleView | undefined;
      if (module?.attributes) {
        // A new module starts the checks over: earlier ones were about another draft.
        asset.master = versionOf(module, by);
        asset.variants = [];
        asset.readiness = undefined;
      }
      for (const item of (output.refused as Array<{ topic: string; reason: string }>) ?? [])
        reject({
          id: `${callId}:refused:${item.topic}`,
          role: "claim",
          status: "refused",
          text: item.topic,
          topic: item.topic,
          reason: item.reason,
          by,
          findings: [],
        });
      return;
    }
    if (step.tool === "atomize_module") {
      const error = step.error ?? (output.error as string | undefined);
      if (!step.ok || error) {
        const headlines = Object.entries(asObject(input.headlines)).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        );
        const pieces = headlines.map(([, text]) => ["headline", text] as [BlockRole, string]);
        for (const { text, reason } of error ? rejectedWords(error, pieces) : [])
          reject({
            id: `${callId}:headline:${text}`,
            role: "headline",
            status: "rejected",
            text,
            channel: headlines.find(([, headline]) => headline.includes(text))?.[0],
            reason,
            by,
            findings: [],
          });
        return;
      }
      if (!Array.isArray(step.output) || !ours(input.moduleUrn)) return;
      for (const item of step.output as Array<{
        variant: ModuleView;
        length: number;
        limit: number;
        blockers: string[];
      }>) {
        const version = {
          ...versionOf(item.variant, by),
          length: item.length,
          limit: item.limit,
          blockers: item.blockers,
        };
        asset.variants = [
          ...asset.variants.filter((existing) => existing.channel !== version.channel),
          version,
        ];
      }
      return;
    }
    if (!step.ok) return;
    if (step.tool === "run_farm" && Array.isArray(step.output) && ours(input.moduleUrn))
      findingsByUrn.set(
        input.moduleUrn as string,
        (step.output as Array<AssetFinding>).map(({ probe, severity, message }) => ({
          probe,
          severity,
          message,
        })),
      );
    if (step.tool === "report_finding" && typeof input.message === "string")
      advisory.push({
        probe: String(input.probe ?? "agent"),
        severity: "warn",
        message: input.message,
        byAgent: true,
      });
    if (step.tool === "check_readiness" && ours(output.moduleUrn))
      asset.readiness = {
        ready: Boolean(output.ready),
        blockers: (output.blockers as Array<{ code: string; message: string }>) ?? [],
      };
    if (step.tool === "propose_transition" && ours(input.moduleUrn)) {
      // Submitting runs readiness first, so its answer is a readiness result too.
      const blockers = (output.blockers as Array<{ code: string; message: string }>) ?? [];
      const master = input.moduleUrn === asset.master?.urn;
      if (output.proposed) {
        const target = [asset.master, ...asset.variants].find(
          (item) => item?.urn === input.moduleUrn,
        );
        if (target) target.state = "submitted";
        if (master) asset.readiness = { ready: true, blockers: [] };
      } else if (blockers.length && master) asset.readiness = { ready: false, blockers };
    }
  };

  for (const event of events) {
    if (event.type === "delegate") {
      agents.set(event.callId, event.name);
      if (event.agent === "module-authoring") open.add(event.callId);
    } else if (event.type === "tool") onTool(event.callId, event.step);
    else if (event.type === "delegated") open.delete(event.callId);
    else if (event.type === "decided") {
      const target = [asset.master, ...asset.variants].find(
        (item) => item?.urn === event.moduleUrn,
      );
      if (target) target.state = event.state;
    }
  }
  asset.drafting = open.size > 0;
  if (asset.master) {
    const farm = findingsByUrn.get(asset.master.urn) ?? [];
    // Readiness repeats the probes' blockers; keep only what it adds (unsubstantiated claims,
    // missing disclosures).
    const readiness = (asset.readiness?.blockers ?? [])
      .filter((blocker) => !farm.some((finding) => finding.message === blocker.message))
      .map((blocker) => ({ probe: "readiness", severity: "block", message: blocker.message }));
    asset.findings = [...pinFindings(asset.master, [...farm, ...readiness]), ...advisory];
    for (const variant of asset.variants)
      asset.findings.push(...pinFindings(variant, findingsByUrn.get(variant.urn) ?? []));
  } else asset.findings = advisory;
  return asset;
}
