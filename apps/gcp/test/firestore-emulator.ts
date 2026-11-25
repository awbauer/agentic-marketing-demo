// Vitest global setup: starts the Firestore emulator for the repository tests unless one is
// already running (FIRESTORE_EMULATOR_HOST). Without gcloud and Java the suites that need it skip.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";

const HOST = "127.0.0.1:8686";
let emulator: ChildProcess | undefined;

async function ready(host: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}/`);
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/** CI sets REQUIRE_FIRESTORE_EMULATOR so a missing emulator fails the run instead of skipping. */
function unavailable(reason: string) {
  if (process.env.REQUIRE_FIRESTORE_EMULATOR) throw new Error(`[gcp tests] ${reason}`);
  console.warn(`[gcp tests] ${reason}; Firestore suites will skip.`);
}

export default async function setup() {
  if (process.env.FIRESTORE_EMULATOR_HOST) return;
  if (spawnSync("gcloud", ["--version"], { stdio: "ignore" }).status !== 0)
    return unavailable("gcloud is not installed");
  emulator = spawn(
    "gcloud",
    ["emulators", "firestore", "start", `--host-port=${HOST}`, "--quiet"],
    { stdio: "ignore", detached: true },
  );
  if (!(await ready(HOST, 60_000))) {
    teardown();
    return unavailable("the Firestore emulator did not start");
  }
  process.env.FIRESTORE_EMULATOR_HOST = HOST;
  return teardown;
}

function teardown() {
  if (emulator?.pid) {
    try {
      process.kill(-emulator.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}
