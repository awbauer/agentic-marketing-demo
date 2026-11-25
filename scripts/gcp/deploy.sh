#!/usr/bin/env bash
# Builds and deploys the workbench to Cloud Run (ADR-018, WU-077). Idempotent. Run after
# scripts/gcp/bootstrap.sh, from a clean checkout:
#   GCP_PROJECT=burner-andbauer-7311 IAP_MEMBERS=you@example.com scripts/gcp/deploy.sh
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT explicitly; this script never guesses a project.}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${GCP_SERVICE:-northstar-workbench}"
REPO="${GCP_ARTIFACT_REPO:-northstar}"
BUCKET="${GCP_ASSET_BUCKET:-${GCP_PROJECT}-campaign-assets}"
TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo -dirty)}"
IMAGE="$REGION-docker.pkg.dev/$GCP_PROJECT/$REPO/workbench:$TAG"
RUN_SA="$SERVICE-run@$GCP_PROJECT.iam.gserviceaccount.com"
SCHEDULER_SA="$SERVICE-scheduler@$GCP_PROJECT.iam.gserviceaccount.com"
BUILD_SA="$SERVICE-build@$GCP_PROJECT.iam.gserviceaccount.com"
# Evaluators, comma-separated; each gets IAP access and a Firestore member row (role evaluator).
IAP_MEMBERS="${IAP_MEMBERS:-}"
SECRETS=(
  NEO4J_URI NEO4J_USERNAME NEO4J_PASSWORD NEO4J_DATABASE NEO4J_QUERY_URL
  CONFIRMATION_SIGNING_KEY ARCH_TOKEN_SECRET TOKEN_ENCRYPTION_KEY
  SALESFORCE_CLIENT_ID SALESFORCE_CLIENT_SECRET SALESFORCE_MCP_URL
)
# Collections whose rows carry `expireAt`, Firestore's TTL backstop to the hourly prune.
TTL_COLLECTIONS=(
  confirmation_audit confirmation_idempotency campaign_image_drafts arch_objects arch_state
  arch_history arch_gateway_log arch_eval_samples arch_agent_state arch_orchestrations
)

g() { gcloud --project "$GCP_PROJECT" --quiet "$@"; }
say() { printf '\n== %s\n' "$*"; }
# New service accounts and agents take a while to be visible to IAM; retry until they are.
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    "$@" && return 0
    echo "  ...not ready yet (attempt $attempt/10); retrying in 30s" >&2
    sleep 30
  done
  return 1
}

PROJECT_NUMBER="$(g projects describe "$GCP_PROJECT" --format='value(projectNumber)')"

if [ -n "${SKIP_BUILD:-}" ]; then
  say "Using the existing image $IMAGE"
else
say "Building $IMAGE with Cloud Build"
# A regional staging bucket: organization policy may forbid the default "us" multi-region one.
g builds submit --region="$REGION" --config cloudbuild.gcp.yaml \
  --default-buckets-behavior=regional-user-owned-bucket \
  --service-account="projects/$GCP_PROJECT/serviceAccounts/$BUILD_SA" \
  --substitutions="_IMAGE=$IMAGE" .
fi

say "Secrets with a value are mounted; empty ones are skipped"
SECRET_FLAGS=()
for name in "${SECRETS[@]}"; do
  if g secrets versions list "$name" --filter='state:ENABLED' --limit=1 --format='value(name)' 2>/dev/null | grep -q .; then
    SECRET_FLAGS+=("$name=$name:latest")
  fi
done
SECRET_ARG=()
if ((${#SECRET_FLAGS[@]})); then SECRET_ARG=(--set-secrets "$(IFS=,; echo "${SECRET_FLAGS[*]}")"); fi
echo "  mounted: ${SECRET_FLAGS[*]:-none}"

# Two ways in, chosen by GCP_INGRESS:
# - "load-balancer" (default): a global HTTPS load balancer with IAP, in front of a service whose
#   ingress is internal-and-cloud-load-balancing. Needed where organization policy restricts
#   Cloud Run ingress (constraints/run.allowedIngress) or forbids allUsers bindings.
# - "direct": IAP on the Cloud Run service itself, with no load balancer.
INGRESS="${GCP_INGRESS:-load-balancer}"
LB="$SERVICE"

say "Deploying Cloud Run service $SERVICE ($INGRESS ingress)"
# One instance keeps each chat on a single writer (snapshots are also generation-checked) and
# lets WebSockets stay put; session affinity covers reconnects.
ENV_VARS="ENVIRONMENT=proof,AUTH_MODE=iap,GCP_PROJECT=$GCP_PROJECT,GCP_REGION=$REGION,GCP_ASSET_BUCKET=$BUCKET"
ENV_VARS+=",SCHEDULER_SERVICE_ACCOUNT=$SCHEDULER_SA"
if [ "$INGRESS" = "direct" ]; then
  ACCESS=(--no-allow-unauthenticated --iap)
else
  # Ingress admits only the load balancer and Google-internal callers (Cloud Scheduler). IAP calls
  # the service as its service agent, so the invoker check stays on (organization policy requires
  # it), and the app also verifies IAP's signed assertion on every request (apps/edge/src/auth.ts).
  ACCESS=(--ingress internal-and-cloud-load-balancing --no-allow-unauthenticated)
fi
g run deploy "$SERVICE" \
  --image "$IMAGE" --region "$REGION" --service-account "$RUN_SA" "${ACCESS[@]}" \
  --min-instances "${MIN_INSTANCES:-0}" --max-instances 1 --concurrency 80 \
  --session-affinity --timeout 3600 --memory 1Gi --cpu 1 --cpu-boost \
  --set-env-vars "$ENV_VARS" "${SECRET_ARG[@]}"
RUN_URL="$(g run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"

if [ "$INGRESS" = "direct" ]; then
  PUBLIC_URL="$RUN_URL"
  IAP_AUDIENCE="/projects/$PROJECT_NUMBER/locations/$REGION/services/$SERVICE"
  IAP_RESOURCE=(--resource-type=cloud-run --service="$SERVICE" --region="$REGION")
else
  say "HTTPS load balancer with IAP"
  g compute addresses describe "$LB-ip" --global >/dev/null 2>&1 ||
    g compute addresses create "$LB-ip" --global --ip-version=IPV4
  IP="$(g compute addresses describe "$LB-ip" --global --format='value(address)')"
  # Without a domain of its own, nip.io names the address so a Google-managed certificate can be
  # issued for it; set GCP_DOMAIN to use a real one (point its A record at $IP first).
  DOMAIN="${GCP_DOMAIN:-$IP.nip.io}"
  g compute network-endpoint-groups describe "$LB-neg" --region "$REGION" >/dev/null 2>&1 ||
    g compute network-endpoint-groups create "$LB-neg" --region "$REGION" \
      --network-endpoint-type=serverless --cloud-run-service="$SERVICE"
  # No protocol or port name: serverless network endpoint groups accept neither.
  g compute backend-services describe "$LB-backend" --global >/dev/null 2>&1 ||
    g compute backend-services create "$LB-backend" --global --load-balancing-scheme=EXTERNAL_MANAGED
  if ! g compute backend-services describe "$LB-backend" --global --format='value(backends[].group)' |
    grep -q "$LB-neg"; then
    g compute backend-services add-backend "$LB-backend" --global \
      --network-endpoint-group="$LB-neg" --network-endpoint-group-region="$REGION"
  fi
  # Serverless backends take their timeout from Cloud Run (an hour here, for chat WebSockets).
  g compute backend-services update "$LB-backend" --global --iap=enabled >/dev/null 2>&1
  g compute url-maps describe "$LB-map" --global >/dev/null 2>&1 ||
    g compute url-maps create "$LB-map" --global --default-service="$LB-backend"
  CERT="$LB-cert-$(echo "$DOMAIN" | tr '.' '-' | cut -c1-40)"
  g compute ssl-certificates describe "$CERT" --global >/dev/null 2>&1 ||
    g compute ssl-certificates create "$CERT" --global --domains="$DOMAIN"
  # An explicit TLS policy: organization policy may forbid the default (compute.requireSslPolicy).
  g compute ssl-policies describe "$LB-tls" --global >/dev/null 2>&1 ||
    g compute ssl-policies create "$LB-tls" --global --profile=MODERN --min-tls-version=1.2
  if g compute target-https-proxies describe "$LB-proxy" --global >/dev/null 2>&1; then
    g compute target-https-proxies update "$LB-proxy" --global --ssl-certificates="$CERT" \
      --ssl-policy="$LB-tls" >/dev/null
  else
    g compute target-https-proxies create "$LB-proxy" --global --url-map="$LB-map" \
      --ssl-certificates="$CERT" --ssl-policy="$LB-tls"
  fi
  g compute forwarding-rules describe "$LB-https" --global >/dev/null 2>&1 ||
    g compute forwarding-rules create "$LB-https" --global --load-balancing-scheme=EXTERNAL_MANAGED \
      --address="$LB-ip" --target-https-proxy="$LB-proxy" --ports=443
  PUBLIC_URL="https://$DOMAIN"
  BACKEND_ID="$(g compute backend-services describe "$LB-backend" --global --format='value(id)')"
  IAP_AUDIENCE="/projects/$PROJECT_NUMBER/global/backendServices/$BACKEND_ID"
  IAP_RESOURCE=(--resource-type=backend-services --service="$LB-backend")
  echo "  $PUBLIC_URL (certificate: $(g compute ssl-certificates describe "$CERT" --global --format='value(managed.status)'))"
fi
g run services update "$SERVICE" --region "$REGION" \
  --update-env-vars "IAP_AUDIENCE=$IAP_AUDIENCE,SCHEDULER_AUDIENCE=$RUN_URL" >/dev/null
# IAP reaches the service as its service agent, in both modes.
gcloud --project "$GCP_PROJECT" beta services identity create --service=iap.googleapis.com >/dev/null
retry g run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member="serviceAccount:service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com" \
  --role=roles/run.invoker >/dev/null

say "IAP: listed evaluators may pass the proxy and are workspace members"
TOKEN="$(gcloud auth print-access-token)"
IFS=',' read -r -a members <<<"$IAP_MEMBERS"
for member in "${members[@]}"; do
  member="$(echo "$member" | tr '[:upper:]' '[:lower:]' | xargs)"
  [ -z "$member" ] && continue
  g iap web add-iam-policy-binding "${IAP_RESOURCE[@]}" \
    --member="user:$member" --role=roles/iap.httpsResourceAccessor >/dev/null
  curl -sf -X PATCH -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
    "https://firestore.googleapis.com/v1/projects/$GCP_PROJECT/databases/(default)/documents/members/$member" \
    -d '{"fields":{"role":{"stringValue":"evaluator"}}}' >/dev/null
  echo "  member: $member"
done

say "Firestore TTL policies on expireAt"
for collection in "${TTL_COLLECTIONS[@]}"; do
  g firestore fields ttls update expireAt --collection-group="$collection" --enable-ttl --async \
    >/dev/null 2>&1 || echo "  (TTL for $collection already set or pending)"
done

say "Cloud Scheduler: hourly maintenance at :17"
# Scheduler calls the service's own URL, which internal ingress admits; the app checks its token.
g run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member="serviceAccount:$SCHEDULER_SA" --role=roles/run.invoker >/dev/null
JOB=(--location "$REGION" --schedule "17 * * * *" --time-zone UTC --http-method POST
  --uri "$RUN_URL/internal/scheduled" --oidc-service-account-email "$SCHEDULER_SA"
  --oidc-token-audience "$RUN_URL")
if g scheduler jobs describe "$SERVICE-maintenance" --location "$REGION" >/dev/null 2>&1; then
  g scheduler jobs update http "$SERVICE-maintenance" "${JOB[@]}" >/dev/null
else
  g scheduler jobs create http "$SERVICE-maintenance" "${JOB[@]}" >/dev/null
fi

say "Deployed $IMAGE"
echo "  $PUBLIC_URL"
g run services describe "$SERVICE" --region "$REGION" --format='value(status.latestReadyRevisionName)'
