// How a replay is paced. A recorded run carries the time each event was sent; a replay waits the
// same gap between events, sped up by the reader's choice. A long gap (a person deciding, a slow
// model call) is capped, so a replay never sits still for minutes.

export const REPLAY_SPEEDS = [
  { id: "1x", label: "1×", factor: 1 },
  { id: "2x", label: "2×", factor: 2 },
  { id: "5x", label: "5×", factor: 5 },
  { id: "instant", label: "Instant", factor: Number.POSITIVE_INFINITY },
] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]["id"];

/** The longest a replay waits between two events at 1×, however long the run waited. */
export const MAX_GAP_MS = 1500;
/** The pace when a run carries no times: one event every 220 ms at 1×. */
export const FALLBACK_GAP_MS = 220;

/**
 * The wait before each event, in ms: delays[i] is how long after event i - 1 event i appears
 * (delays[0] is 0). Without a time for every event, each gap is the fixed fallback.
 */
export function replayDelays(
  eventCount: number,
  stamps: readonly number[] | null | undefined,
  speed: ReplaySpeed,
): number[] {
  const factor = REPLAY_SPEEDS.find((item) => item.id === speed)?.factor ?? 1;
  const times = stamps && stamps.length === eventCount ? stamps : null;
  return Array.from({ length: eventCount }, (_, index) => {
    if (index === 0 || !Number.isFinite(factor)) return 0;
    const gap = times
      ? Math.min(MAX_GAP_MS, Math.max(0, (times[index] ?? 0) - (times[index - 1] ?? 0)))
      : FALLBACK_GAP_MS;
    return Math.round(gap / factor);
  });
}
