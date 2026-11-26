#!/usr/bin/env bash
# One-time, idempotent provisioning of the Google Cloud target (ADR-018, WU-077).
# Creates billable resources. Run it yourself after `gcloud auth login`:
#   GCP_PROJECT=burner-andbauer-7311 scripts/gcp/bootstrap.sh
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT explicitly; this script never guesses a project.}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${GCP_SERVICE:-northstar-workbench}"
BUCKET="${GCP_ASSET_BUCKET:-${GCP_PROJECT}-campaign-assets}"
REPO="${GCP_ARTIFACT_REPO:-northstar}"
RUN_SA="${SERVICE}-run"
SCHEDULER_SA="${SERVICE}-scheduler"
BUILD_SA="${SERVICE}-build"
SECRETS=(
  NEO4J_URI NEO4J_USERNAME NEO4J_PASSWORD NEO4J_DATABASE NEO4J_QUERY_URL
  CONFIRMATION_SIGNING_KEY ARCH_TOKEN_SECRET TOKEN_ENCRYPTION_KEY
  SALESFORCE_CLIENT_ID SALESFORCE_CLIENT_SECRET SALESFORCE_MCP_URL
)

command -v gcloud >/dev/null || { echo "Install the Google Cloud CLI first." >&2; exit 1; }
gcloud auth print-access-token >/dev/null 2>&1 || { echo "Run 'gcloud auth login' first." >&2; exit 1; }

g() { gcloud --project "$GCP_PROJECT" --quiet "$@"; }
say() { printf '\n== %s\n' "$*"; }
# Newly enabled APIs can take minutes to propagate; retry a step until they answer.
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    "$@" && return 0
    echo "  ...not ready yet (attempt $attempt/10); retrying in 30s" >&2
    sleep 30
  done
  return 1
}

say "Project $GCP_PROJECT, region $REGION"
g projects describe "$GCP_PROJECT" --format='value(projectNumber)' >/dev/null

say "Enabling APIs"
g services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com \
  aiplatform.googleapis.com iap.googleapis.com cloudscheduler.googleapis.com \
  logging.googleapis.com iamcredentials.googleapis.com compute.googleapis.com \
  cloudresourcemanager.googleapis.com orgpolicy.googleapis.com

say "Firestore (default) database, native mode"
if ! g firestore databases describe --database='(default)' >/dev/null 2>&1; then
  retry g firestore databases create --database='(default)' --location="$REGION" --type=firestore-native
fi

say "Asset bucket gs://$BUCKET"
if ! g storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  g storage buckets create "gs://$BUCKET" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention
fi
# Generated images are kept seven days, then deleted (AGENTS.md); chat snapshots are not touched.
LIFECYCLE="$(mktemp)"
cat >"$LIFECYCLE" <<'JSON'
{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 7, "matchesPrefix": ["drafts/"]}}]}
JSON
g storage buckets update "gs://$BUCKET" --lifecycle-file="$LIFECYCLE" >/dev/null
rm -f "$LIFECYCLE"

say "Artifact Registry repository $REPO"
if ! g artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
  retry g artifacts repositories create "$REPO" --location="$REGION" --repository-format=docker
fi

say "Service accounts"
for sa in "$RUN_SA" "$SCHEDULER_SA" "$BUILD_SA"; do
  if ! g iam service-accounts describe "$sa@$GCP_PROJECT.iam.gserviceaccount.com" >/dev/null 2>&1; then
    g iam service-accounts create "$sa" --display-name="$sa"
  fi
done
RUN_MEMBER="serviceAccount:$RUN_SA@$GCP_PROJECT.iam.gserviceaccount.com"
for role in roles/datastore.user roles/aiplatform.user roles/logging.logWriter roles/cloudtrace.agent; do
  retry g projects add-iam-policy-binding "$GCP_PROJECT" --member="$RUN_MEMBER" --role="$role" \
    --condition=None >/dev/null
done
retry g storage buckets add-iam-policy-binding "gs://$BUCKET" --member="$RUN_MEMBER" \
  --role=roles/storage.objectAdmin >/dev/null

# Builds run as their own account: the organization turns off the default account's grants.
BUILD_MEMBER="serviceAccount:$BUILD_SA@$GCP_PROJECT.iam.gserviceaccount.com"
for role in roles/logging.logWriter roles/storage.objectViewer; do
  retry g projects add-iam-policy-binding "$GCP_PROJECT" --member="$BUILD_MEMBER" --role="$role" \
    --condition=None >/dev/null
done
retry g artifacts repositories add-iam-policy-binding "$REPO" --location="$REGION" \
  --member="$BUILD_MEMBER" --role=roles/artifactregistry.writer >/dev/null

say "Secrets (created empty; add values with 'gcloud secrets versions add')"
for name in "${SECRETS[@]}"; do
  if ! g secrets describe "$name" >/dev/null 2>&1; then
    retry g secrets create "$name" --replication-policy=user-managed --locations="$REGION"
  fi
  retry g secrets add-iam-policy-binding "$name" --member="$RUN_MEMBER" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done

say "Done. Next steps (manual) are in infra/gcp/README.md."
