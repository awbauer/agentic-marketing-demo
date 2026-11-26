// An ID you can click or tap for a small card of details: claims, segments, competitors, signals,
// results, images and the other sources the squad's agents cite. The card renders outside the
// chip's own containers (into the page, or into an open modal dialog, which sits in the browser's
// top layer), fixed to the viewport, so a scrolling table or the agent details can't clip or hide
// it, as they did on an iPad.
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const CARD_WIDTH = 380;
const MARGIN = 8;

/**
 * Just under the chip, or above it when there's no room below; always on screen. A card taller
 * than the window (a short landscape screen, a zoomed page) is capped to it and scrolls inside.
 */
export function cardPlacement(chip: DOMRect, measured: { height: number }): CSSProperties {
  const maxHeight = Math.max(0, window.innerHeight - MARGIN * 2);
  const card = { height: Math.min(measured.height, maxHeight) };
  const width = Math.min(CARD_WIDTH, window.innerWidth - MARGIN * 2);
  const left = Math.max(MARGIN, Math.min(chip.left, window.innerWidth - width - MARGIN));
  const below = chip.bottom + 4;
  const above = chip.top - 4 - card.height;
  const top =
    below + card.height <= window.innerHeight - MARGIN || above < MARGIN
      ? Math.min(below, Math.max(MARGIN, window.innerHeight - card.height - MARGIN))
      : above;
  return { position: "fixed", top, left, width, maxHeight, overflowY: "auto" };
}

/** Off screen at its final width, so its height can be measured before it's placed. */
const measuring = (): CSSProperties => ({
  position: "fixed",
  top: 0,
  left: 0,
  width: Math.min(CARD_WIDTH, window.innerWidth - MARGIN * 2),
  visibility: "hidden",
});

/** A chip that opens a card. Click or tap toggles it; Escape, a tap outside or a scroll closes it. */
export function IdCard({
  label,
  cardLabel,
  hint,
  tone,
  children,
}: {
  label: string;
  /** The card's accessible name, such as "Claim CLM-CRD-0042". */
  cardLabel: string;
  /** The chip's tooltip on hover. */
  hint: string;
  /** "warn" marks an ID that can't be used here, such as an unusable claim or unapproved image. */
  tone?: "warn";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });
  const chip = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = chip.current?.getBoundingClientRect();
      // The content's full height, even when an earlier placement capped the card.
      const height = card.current ? card.current.scrollHeight + 2 : null;
      if (anchor && height !== null) setStyle(cardPlacement(anchor, { height }));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Pointer events cover mouse, pen and touch; the card and its own chip don't close it.
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!chip.current?.contains(target) && !card.current?.contains(target)) setOpen(false);
    };
    // Fixed to the viewport, the card would drift from its chip as the page scrolls; close it.
    const onScroll = (event: Event) => {
      if (!card.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);
  return (
    <span className="team-claim">
      <button
        ref={chip}
        type="button"
        className={`team-claim-chip${tone === "warn" ? " unusable" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        title={hint}
        onClick={() => {
          setStyle(measuring());
          setOpen((value) => !value);
        }}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <span
            ref={card}
            id={panelId}
            className="team-claim-card"
            role="dialog"
            aria-label={cardLabel}
            style={style}
          >
            {children}
          </span>,
          chip.current?.closest("dialog[open]") ?? document.body,
        )}
    </span>
  );
}
