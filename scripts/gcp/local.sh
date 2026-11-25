#!/usr/bin/env bash
# Runs the Google Cloud server locally (ADR-018): the built app and the Node server, against the
# Firestore emulator, signed in as the local evaluator. Nothing leaves this machine except model
# calls, which go to Vertex AI only when GCP_PROJECT is set and you are signed in to gcloud.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-8080}"
EMULATOR="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:8686}"

pnpm build
pnpm build:gcp
(cd dist/server && npm install --omit=dev --no-audit --no-fund --silent)

if [ -z "${FIRESTORE_EMULATOR_HOST:-}" ]; then
  gcloud emulators firestore start --host-port="$EMULATOR" --quiet >/dev/null 2>&1 &
  EMULATOR_PID=$!
  trap 'kill "$EMULATOR_PID" 2>/dev/null || true' EXIT
  until curl -sf "http://$EMULATOR/" >/dev/null; do sleep 0.5; done
fi

echo "Northstar on Google Cloud, locally: http://127.0.0.1:$PORT"
FIRESTORE_EMULATOR_HOST="$EMULATOR" SNAPSHOT_STORE=memory ENVIRONMENT=local AUTH_MODE=development \
  GCP_PROJECT="${GCP_PROJECT:-}" PORT="$PORT" STATIC_DIR=dist/client/client \
  node --enable-source-maps dist/server/server.mjs
