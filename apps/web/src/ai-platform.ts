// The AI platform chosen in the top bar (ADR-021): where a turn's models run, apart from where
// the app is hosted. Every chat message and every workspace request carries it; a server that
// can't run the choice uses its own default. Kept in this browser like the brand and role.
import {
  AI_PLATFORM_TERMS,
  type AiPlatformId,
  type AiPlatformOptions,
  isAiPlatformId,
} from "@northstar/contracts";
import { useEffect, useSyncExternalStore } from "react";

const KEY = "northstar.ai-platform";
const listeners = new Set<() => void>();
let options: AiPlatformOptions | null = null;

function stored(): AiPlatformId | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return isAiPlatformId(value) ? value : null;
  } catch {
    return null;
  }
}

let choice: AiPlatformId | null = typeof window === "undefined" ? null : stored();

const notify = () => {
  for (const listener of listeners) listener();
};

/** The platform requests should ask for: the choice when this server can run it, else none. */
export function currentAiPlatform(): AiPlatformId | null {
  if (!options) return choice;
  const available = options.platforms.filter((platform) => platform.available);
  if (choice && available.some((platform) => platform.id === choice)) return choice;
  return options.default;
}

export function setAiPlatform(next: AiPlatformId) {
  choice = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Private windows and blocked storage just don't remember the choice.
  }
  notify();
}

/** The header that carries the choice on workspace requests. */
export function aiPlatformHeaders(): Record<string, string> {
  const platform = currentAiPlatform();
  return platform ? { "x-ai-platform": platform } : {};
}

/** What the server offers, loaded once per page. */
let loading: Promise<void> | null = null;
function load() {
  loading ??= fetch("/api/ai-platforms")
    .then((response) => (response.ok ? (response.json() as Promise<AiPlatformOptions>) : null))
    .then((body) => {
      if (body?.platforms) options = { default: body.default, platforms: body.platforms };
      notify();
    })
    .catch(() => undefined);
  return loading;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The current platform and what the server offers, for the top bar and the trace. */
export function useAiPlatform() {
  useEffect(() => {
    void load();
  }, []);
  const platform = useSyncExternalStore(subscribe, currentAiPlatform, () => null);
  const offered = useSyncExternalStore(
    subscribe,
    () => options,
    () => null,
  );
  return {
    platform,
    label: platform ? AI_PLATFORM_TERMS[platform].label : null,
    options: offered,
    setPlatform: setAiPlatform,
  };
}
