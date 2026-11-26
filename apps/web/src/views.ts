// The workspace's pages and their addresses, so a reload, a shared link or the browser's back
// button lands on the same page. Both hosts serve the app for any path that isn't a file or an API
// route (Cloudflare's single-page-application handling; the Node host's index.html fallback).
import { useCallback, useEffect, useState } from "react";

export const VIEW_PATHS = {
  chat: "/",
  history: "/history",
  // Not /evals: public/evals/ holds the published evaluation reports.
  evaluations: "/evaluations",
  learn: "/learn",
  graph: "/graph",
  usecases: "/use-cases",
  journeys: "/journeys",
  architecture: "/architecture",
  team: "/squad",
} as const;

export type View = keyof typeof VIEW_PATHS;

/** The page a path names; anything else is the chat. A trailing slash is ignored. */
export function viewFromPath(pathname: string): View {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const found = (Object.entries(VIEW_PATHS) as Array<[View, string]>).find(
    ([, value]) => value === path,
  );
  return found ? found[0] : "chat";
}

const current = () => (typeof window === "undefined" ? "chat" : viewFromPath(location.pathname));

/** The open page, kept in the address bar: choosing a page adds a history entry. */
export function useView(): [View, (next: View) => void] {
  const [view, setView] = useState<View>(current);
  useEffect(() => {
    const onPop = () => setView(current());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const open = useCallback((next: View) => {
    setView(next);
    const path = VIEW_PATHS[next];
    if (location.pathname !== path) history.pushState(null, "", `${path}${location.search}`);
  }, []);
  return [view, open];
}
