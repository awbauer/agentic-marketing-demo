import type { Brand, Persona } from "@northstar/architecture";
import { useCallback, useEffect, useState } from "react";

export type Scope = { persona: Persona; brand: Brand | "all" };

export class ArchApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function archFetch<T>(
  path: string,
  scope: Scope,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`/api/arch${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      "x-persona": scope.persona,
      ...(scope.brand === "all" ? {} : { "x-brand": scope.brand }),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string } & Record<string, unknown>;
  };
  if (!response.ok) {
    const { code, message, ...extra } = body.error ?? {};
    throw new ArchApiError(
      response.status,
      code ?? "ERROR",
      message ?? `The request failed (${response.status}).`,
      extra,
    );
  }
  return body as T;
}

export type Loaded<T> = {
  data: T | null;
  error: ArchApiError | null;
  loading: boolean;
  reload: () => void;
};

/** Loads a read endpoint for the current persona and brand, reloading when either changes. */
export function useArch<T>(path: string | null, scope: Scope, refreshKey = 0): Loaded<T> {
  const [state, setState] = useState<{
    data: T | null;
    error: ArchApiError | null;
    loading: boolean;
  }>({
    data: null,
    error: null,
    loading: path !== null,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    archFetch<T>(path, scope)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch(
        (error: unknown) =>
          live &&
          setState({
            data: null,
            loading: false,
            error:
              error instanceof ArchApiError
                ? error
                : new ArchApiError(0, "NETWORK", "The workbench could not be reached.", {}),
          }),
      );
    return () => {
      live = false;
    };
    // The scope object is rebuilt each render; its fields are the real dependencies.
  }, [path, scope.persona, scope.brand, refreshKey, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, reload };
}

export const shortUrn = (urn: string) => urn.replace("urn:northstar:", "");
export const kindOfUrn = (urn: string) => urn.split(":")[2] ?? "object";
export const relative = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
};

/** Posts to an endpoint that streams newline-delimited JSON events, handing each one over as it arrives. */
export async function archStream<E>(
  path: string,
  scope: Scope,
  body: unknown,
  onEvent: (event: E) => void,
): Promise<void> {
  const response = await fetch(`/api/arch${path}`, {
    method: "POST",
    headers: {
      "x-persona": scope.persona,
      ...(scope.brand === "all" ? {} : { "x-brand": scope.brand }),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const parsed = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string } & Record<string, unknown>;
    };
    const { code, message, ...extra } = parsed.error ?? {};
    throw new ArchApiError(
      response.status,
      code ?? "ERROR",
      message ?? `The request failed (${response.status}).`,
      extra,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as E);
}
