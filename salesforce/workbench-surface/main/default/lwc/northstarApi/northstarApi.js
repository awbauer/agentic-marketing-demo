import call from "@salesforce/apex/NorthstarWorkbenchController.call";

/**
 * The surface's one connection to the Worker: Login, and every call after it. Calls go through
 * Apex with the person's Cloudflare Access token, so the Worker sees the same person as the
 * browser app and this org needs no CORS or CSP exception.
 */
export const WORKER_ORIGIN = "https://marketing.becurious.one";
const SESSION_KEY = "northstar.access";
const SIGN_IN_TIMEOUT_MS = 300000;
const POPUP_CHECK_MS = 500;

export class SignedOutError extends Error {}

function readSession() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(SESSION_KEY));
    return stored?.token && stored.expiresAt > Date.now() ? stored : null;
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Blocked storage only means signing in again after a reload.
  }
}

let current = readSession();

export const isSignedIn = () => Boolean(current);

export function signOut() {
  current = null;
  writeSession(null);
}

/**
 * Opens Cloudflare Access in a window. Access signs the person in and lands on the Worker's login
 * page, which posts their token back here. Must run from a click, or the browser blocks the window.
 */
export function signIn() {
  const url = `${WORKER_ORIGIN}/api/surface/login?origin=${encodeURIComponent(window.location.origin)}`;
  const popup = window.open(url, "northstar-login", "width=520,height=720");
  if (!popup)
    return Promise.reject(
      new Error("Your browser blocked the sign-in window. Allow pop-ups for Salesforce."),
    );
  return new Promise((resolve, reject) => {
    let watcher;
    const finish = (settle, value) => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(watcher);
      window.clearTimeout(timeout);
      settle(value);
    };
    const onMessage = (event) => {
      if (event.origin !== WORKER_ORIGIN || event.data?.type !== "northstar-access") return;
      current = { token: event.data.token, expiresAt: event.data.expiresAt };
      writeSession(current);
      finish(resolve, current);
    };
    const timeout = window.setTimeout(
      () => finish(reject, new Error("Sign-in timed out. Press Log in to try again.")),
      SIGN_IN_TIMEOUT_MS,
    );
    window.addEventListener("message", onMessage);
    watcher = window.setInterval(() => {
      if (popup.closed)
        finish(reject, new Error("Sign-in didn't finish. Press Log in to try again."));
    }, POPUP_CHECK_MS);
  });
}

function parse(body) {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return {};
  }
}

/** Calls a named Worker operation and returns its JSON, or throws what the person should read. */
export async function request(operation, body) {
  if (!current) throw new SignedOutError("Log in to continue.");
  const result = await call({
    operation,
    accessToken: current.token,
    body: body === undefined ? null : JSON.stringify(body),
  });
  const parsed = parse(result.body);
  if (result.status === 401) {
    signOut();
    throw new SignedOutError(parsed.error?.message ?? "Your sign-in expired. Log in again.");
  }
  if (result.status >= 400) {
    throw new Error(parsed.error?.message ?? `The workbench returned HTTP ${result.status}.`);
  }
  return parsed;
}

/** What to show for an error from Apex or the Worker. */
export function errorMessage(error) {
  return error?.body?.message ?? error?.message ?? "Something went wrong. Try again.";
}
