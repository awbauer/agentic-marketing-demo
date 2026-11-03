import { BRAND_RULES, type Brand } from "@northstar/architecture";
import { Fragment, useEffect, useRef, useState } from "react";
import { shortUrn } from "./api";
import type { Asset, AssetBlock, AssetFinding, AssetVersion } from "./asset";

const ROLE_LABEL: Record<AssetBlock["role"], string> = {
  headline: "Headline",
  framing: "Agent’s own words",
  claim: "Approved claim",
  disclosure: "Required disclosure",
  image: "Image",
};
const STATUS_LABEL: Record<AssetBlock["status"], string> = {
  kept: "In the asset",
  rejected: "Rejected wording",
  refused: "Refused: no approved claim",
  passed: "Passed over",
};
const STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted for review",
  in_review: "In review",
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};
const WHY: Record<AssetBlock["role"], string> = {
  headline:
    "The agent wrote this subject line. It may name the occasion and the product, but the service rejects any word that asserts an outcome, benefit, comparison or reason.",
  framing:
    "The agent wrote these words around the claims. They may greet, set the occasion and say what to do next; the service rejects any sentence that states a fact or asserts what the product does.",
  claim:
    "The service inserted this claim’s approved text exactly. The agent chose the topic; it did not write or reword the sentence.",
  disclosure:
    "A cited claim requires this disclosure, so the service attached it. The agent cannot leave it out.",
  image:
    "The service picked this image from the brand’s asset library, the way it inserts claims: approved, in rights on the send date, and showing nothing the module doesn’t cite. The agent didn’t choose it.",
};

function blockTag(block: AssetBlock) {
  if (block.status === "refused") return "Refused";
  if (block.status === "rejected") return "Rejected";
  if (block.status === "passed") return "Image passed over";
  if (block.image) return `Image from ${block.image.source}`;
  return ROLE_LABEL[block.role];
}

function Flags({ findings }: { findings: AssetFinding[] }) {
  if (!findings.length) return null;
  const blocking = findings.some((finding) => finding.severity === "block");
  return (
    <span className={`asset-flag ${blocking ? "block" : "warn"}`}>
      {findings.length} {blocking ? "blocking" : "warning"}
    </span>
  );
}

/** One block in the composition: click it for where it came from and what was found. */
function Block({
  block,
  selected,
  onSelect,
  inline,
}: {
  block: AssetBlock;
  selected: boolean;
  onSelect: (id: string) => void;
  inline?: boolean;
}) {
  const Tag = inline ? "span" : "div";
  return (
    <Tag
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${blockTag(block)}: ${block.text}`}
      className={`asset-block role-${block.role} status-${block.status} ${selected ? "selected" : ""} ${block.findings.length ? "flagged" : ""}`}
      onClick={() => onSelect(block.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(block.id);
        }
      }}
    >
      {!inline && (
        <span className="asset-block-tag">
          {blockTag(block)}
          <Flags findings={block.findings} />
        </span>
      )}
      <span className="asset-block-text">{block.text}</span>
    </Tag>
  );
}

/**
 * An image from the asset library. The library is mocked, so the preview draws a placeholder in the
 * brand's color with the image's alt text, where the real file from the library would go.
 */
function Image({
  block,
  brand,
  selected,
  onSelect,
}: {
  block: AssetBlock;
  brand: Brand;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const image = block.image;
  if (!image) return null;
  const accent = BRAND_RULES[brand].accent;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${blockTag(block)}: ${image.title}`}
      className={`asset-image placement-${image.placement ?? "inline"} ${selected ? "selected" : ""}`}
      style={{ "--asset-accent": accent } as React.CSSProperties}
      onClick={() => onSelect(block.id)}
    >
      {image.placement === "header" ? (
        <span className="asset-image-logo">{image.alt ?? image.title}</span>
      ) : (
        <>
          <span className="asset-image-frame" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                fill="currentColor"
                d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v8.6l3.8-3.8a1 1 0 0 1 1.4 0l2.3 2.3 3.3-3.3a1 1 0 0 1 1.4 0L19 12.6V7H5Zm4 2.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
              />
            </svg>
          </span>
          <span className="asset-image-caption">
            <span className="asset-block-tag">
              {image.source} · {image.sourceId}
            </span>
            <span>{image.alt ?? image.title}</span>
          </span>
        </>
      )}
    </button>
  );
}

/** Who the wave reaches and when, read from the brief the flow drafted. */
function Audience({ asset }: { asset: Asset }) {
  const audience = asset.audience;
  return (
    <>
      {audience?.segment && (
        <div>
          <dt>To</dt>
          <dd>
            {audience.segment}
            {audience.audienceSize ? ` · ${audience.audienceSize.toLocaleString()} people` : ""}
          </dd>
        </div>
      )}
      {audience?.sendOn && (
        <div>
          <dt>Sends</dt>
          <dd>{audience.sendOn}</dd>
        </div>
      )}
    </>
  );
}

function Email({
  version,
  brand,
  asset,
  selected,
  onSelect,
}: {
  version: AssetVersion;
  brand: Brand;
  asset: Asset;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [headline, ...rest] = version.blocks;
  const body = rest.filter((block) => block.role !== "disclosure");
  const disclosures = rest.filter((block) => block.role === "disclosure");
  const rules = BRAND_RULES[brand];
  const placed = (placement: string) =>
    version.images.filter((block) => block.image?.placement === placement);
  const logo = placed("header")[0];
  // The inline image sits after the last claim, before the closing words.
  const lastClaim = body.map((block) => block.role).lastIndexOf("claim");
  const image = (block: AssetBlock) => (
    <Image
      key={block.id}
      block={block}
      brand={brand}
      selected={selected === block.id}
      onSelect={onSelect}
    />
  );
  return (
    <div className="asset-email" style={{ borderTopColor: rules.accent }}>
      <dl className="asset-email-meta">
        <div>
          <dt>From</dt>
          <dd>{brand}</dd>
        </div>
        <Audience asset={asset} />
        <div>
          <dt>Subject</dt>
          <dd>
            {headline && (
              <Block block={headline} selected={selected === headline.id} onSelect={onSelect} />
            )}
          </dd>
        </div>
      </dl>
      <div className="asset-email-body">
        {logo ? (
          image(logo)
        ) : (
          <p className="asset-brandmark" style={{ color: rules.accent }}>
            {brand}
          </p>
        )}
        {placed("banner").map(image)}
        {body.map((block, index) => (
          <Fragment key={block.id}>
            <Block block={block} selected={selected === block.id} onSelect={onSelect} />
            {index === lastClaim && placed("inline").map(image)}
          </Fragment>
        ))}
      </div>
      {disclosures.length > 0 && (
        <footer className="asset-email-footer">
          <strong>{rules.disclosureLabel}</strong>
          {disclosures.map((block) => (
            <Block
              key={block.id}
              block={block}
              selected={selected === block.id}
              onSelect={onSelect}
            />
          ))}
        </footer>
      )}
    </div>
  );
}

function Short({
  version,
  brand,
  asset,
  selected,
  onSelect,
}: {
  version: AssetVersion;
  brand: Brand;
  asset: Asset;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [headline, ...rest] = version.blocks;
  const rules = BRAND_RULES[brand];
  const push = version.channel === "push";
  return (
    <div className={`asset-phone ${push ? "push" : "sms"}`}>
      {asset.audience && (
        <dl className="asset-phone-meta">
          <Audience asset={asset} />
        </dl>
      )}
      <div className="asset-phone-card">
        <p className="asset-phone-app">
          <i style={{ background: rules.accent }} aria-hidden="true">
            {brand.charAt(0)}
          </i>
          {push ? brand : `${brand} · text message`}
          <small>now</small>
        </p>
        {push &&
          version.images.map((block) => (
            <Image
              key={block.id}
              block={block}
              brand={brand}
              selected={selected === block.id}
              onSelect={onSelect}
            />
          ))}
        {push && headline && (
          <p className="asset-phone-title">
            <Block
              block={headline}
              selected={selected === headline.id}
              onSelect={onSelect}
              inline
            />
          </p>
        )}
        <p className="asset-phone-body">
          {rest.map((block) => (
            <Block
              key={block.id}
              block={block}
              selected={selected === block.id}
              onSelect={onSelect}
              inline
            />
          ))}
        </p>
      </div>
      {version.limit !== undefined && version.length !== undefined && (
        <p className={`asset-meter ${version.length > version.limit ? "over" : ""}`}>
          {version.length} of {version.limit} characters
        </p>
      )}
    </div>
  );
}

function Detail({
  block,
  onOpen,
  onClose,
}: {
  block: AssetBlock;
  onOpen: (urn: string) => void;
  onClose: () => void;
}) {
  // The details sit below the asset; bring them into view when a block is picked.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [block.id]);
  return (
    <section ref={ref} className={`asset-detail status-${block.status}`} aria-label="Block details">
      <header>
        <div>
          <p className="kicker">
            {ROLE_LABEL[block.role]}
            {block.channel ? ` · ${block.channel}` : ""} · {STATUS_LABEL[block.status]}
          </p>
          <p className="asset-detail-text">
            {block.status === "refused" ? `Requested topic: ${block.text}` : block.text}
          </p>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Close
        </button>
      </header>
      <dl>
        {block.reason && (
          <div>
            <dt>
              {block.status === "refused"
                ? "Why it was refused"
                : block.status === "passed"
                  ? "Why it was passed over"
                  : "Why it was rejected"}
            </dt>
            <dd>{block.reason}</dd>
          </div>
        )}
        {block.image && (
          <>
            <div>
              <dt>Library</dt>
              <dd>
                {block.image.source} · <code>{block.image.sourceId}</code>
              </dd>
            </div>
            {block.image.alt && (
              <div>
                <dt>Alt text</dt>
                <dd>{block.image.alt}</dd>
              </div>
            )}
            {block.image.approvalId && (
              <div>
                <dt>Approval</dt>
                <dd>
                  <code>{block.image.approvalId}</code>
                </dd>
              </div>
            )}
            {block.image.rightsUntil && (
              <div>
                <dt>Usage rights until</dt>
                <dd>{block.image.rightsUntil}</dd>
              </div>
            )}
            {block.image.why && (
              <div>
                <dt>Why this one</dt>
                <dd>{block.image.why}</dd>
              </div>
            )}
          </>
        )}
        <div>
          <dt>How it got here</dt>
          <dd>
            {block.status === "refused"
              ? "The agent asked for this topic. The service found no substantiated claim for it, so it wrote nothing and filed a gap for the content lab instead."
              : block.status === "passed"
                ? "The service considered this image from the brand’s library and left it out. Only approved images, in rights on the send date and showing only claims the module cites, go in."
                : block.status === "rejected"
                  ? "The agent proposed these words. The service checked them and refused the whole draft, so the agent had to try again."
                  : WHY[block.role]}
          </dd>
        </div>
        {block.role !== "image" && (
          <div>
            <dt>Written by</dt>
            <dd>
              {block.role === "claim" && block.status === "kept"
                ? "Compliance approved the text"
                : block.role === "disclosure"
                  ? "Legal text, attached by the service"
                  : block.by.agent}{" "}
              · via <code>{block.by.tool}</code>
              {block.by.policyId && (
                <>
                  {" "}
                  · allowed by <code>{block.by.policyId}</code>
                </>
              )}
            </dd>
          </div>
        )}
        {block.topic && block.status === "kept" && (
          <div>
            <dt>Claim topic</dt>
            <dd>{block.topic}</dd>
          </div>
        )}
        {(block.claimUrn || block.disclosureUrn) && (
          <div>
            <dt>Source</dt>
            <dd>
              <button
                type="button"
                className="arch-link"
                onClick={() => onOpen((block.claimUrn ?? block.disclosureUrn) as string)}
              >
                {shortUrn((block.claimUrn ?? block.disclosureUrn) as string)}
              </button>
            </dd>
          </div>
        )}
        <div>
          <dt>Found by the checks</dt>
          <dd>
            {block.findings.length === 0 ? (
              block.status === "kept" ? (
                "Nothing so far."
              ) : (
                "Not checked: it never reached the asset."
              )
            ) : (
              <ul className="asset-findings">
                {block.findings.map((finding) => (
                  <li key={`${finding.probe}-${finding.message}`} className={finding.severity}>
                    <strong>{finding.probe}</strong> {finding.message}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** The asset as it is built: the channel wrapper with each block in place, and what was kept out. */
export function AssetPreview({
  asset,
  brand,
  onOpen,
}: {
  asset: Asset;
  brand: Brand;
  onOpen: (urn: string) => void;
}) {
  const versions = [asset.master, ...asset.variants].filter((item): item is AssetVersion =>
    Boolean(item),
  );
  const [channel, setChannel] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const version = versions.find((item) => item.channel === channel) ?? versions[0];
  // A new draft replaces the old one; let go of a block that is no longer there.
  const all = [...versions.flatMap((item) => [...item.blocks, ...item.images]), ...asset.rejected];
  const block = all.find((item) => item.id === selected);
  useEffect(() => {
    if (selected && !block) setSelected(null);
  }, [selected, block]);
  const toggle = (id: string) => setSelected((current) => (current === id ? null : id));

  return (
    <aside className="asset-preview" aria-label="Asset preview">
      <header className="asset-head">
        <div>
          <p className="kicker">The asset, as it is built</p>
          <h3>{version?.title ?? "Nothing written yet"}</h3>
        </div>
        {version && (
          <span className={`asset-state ${version.state}`}>
            {STATE_LABEL[version.state] ?? version.state}
          </span>
        )}
      </header>

      {versions.length > 1 && (
        <div role="tablist" aria-label="Channel" className="arch-tabs small">
          {versions.map((item) => (
            <button
              key={item.urn}
              type="button"
              role="tab"
              aria-selected={item === version}
              onClick={() => setChannel(item.channel)}
            >
              {item.channel}
              {item === asset.master ? " · original" : ""}
            </button>
          ))}
        </div>
      )}

      {!version && (
        <div className={`asset-empty ${asset.drafting ? "drafting" : ""}`}>
          <div className="asset-skeleton" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <p className="arch-note" role="status">
            {asset.drafting
              ? "The authoring agent is writing. Blocks appear here as the service accepts them."
              : "When the authoring agent writes, its blocks appear here in place: its own words, the approved claims the service inserted, and the disclosures they require."}
          </p>
        </div>
      )}

      {version &&
        (version.channel === "email" ? (
          <Email
            version={version}
            brand={brand}
            asset={asset}
            selected={selected}
            onSelect={toggle}
          />
        ) : (
          <Short
            version={version}
            brand={brand}
            asset={asset}
            selected={selected}
            onSelect={toggle}
          />
        ))}

      {version && version.blockers.length > 0 && (
        <ul className="arch-blockers">
          {version.blockers.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      {asset.rejected.length > 0 && (
        <section className="asset-kept-out" aria-label="Kept out of the asset">
          <h4>Kept out by the service ({asset.rejected.length})</h4>
          {asset.rejected.map((item) => (
            <Block key={item.id} block={item} selected={selected === item.id} onSelect={toggle} />
          ))}
        </section>
      )}

      {block && <Detail block={block} onOpen={onOpen} onClose={() => setSelected(null)} />}

      {version && (
        <section className="asset-checks" aria-label="Checks">
          <h4>Checks</h4>
          {asset.readiness ? (
            <p className={asset.readiness.ready ? "ok" : "blocked"}>
              {asset.readiness.ready
                ? "Readiness passed: every claim substantiated and every disclosure present."
                : `Readiness blocked by ${asset.readiness.blockers.length} issue${asset.readiness.blockers.length === 1 ? "" : "s"}.`}
            </p>
          ) : (
            <p className="arch-note">Readiness has not been checked yet.</p>
          )}
          {asset.findings.length > 0 && (
            <ul className="asset-findings">
              {asset.findings.map((finding) => (
                <li key={`${finding.probe}-${finding.message}`} className={finding.severity}>
                  <strong>{finding.byAgent ? `${finding.probe} (agent)` : finding.probe}</strong>{" "}
                  {finding.message}
                </li>
              ))}
            </ul>
          )}
          <p className="arch-note">
            Click any block to see who wrote it, where its words come from, and what the checks
            found.
          </p>
        </section>
      )}
    </aside>
  );
}
