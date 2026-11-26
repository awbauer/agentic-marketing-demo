# ADR-021: The AI platform is chosen apart from the host

Status: accepted

Date: 2026-11-25

## Context

ADR-018 tied the models to the host: Workers AI on Cloudflare, Vertex AI on Google Cloud. Andrew asked for a clean interface between the app and its models, so a Cloudflare deployment can run Google's models (and, later, the reverse), with a menu in the top bar, like Brand and Run as, to pick the provider. He chose to build only the Cloudflare-to-Vertex pairing for now, on the Vercel AI SDK the app already uses, and asked for a broader name than "Models". He also asked whether the Cedar engine should move to a separate Worker.

## Decision

- **One registry of AI SDK providers.** `apps/edge/src/platform/models.ts` builds every platform this server can reach and registers each one in the AI SDK's provider registry (`createProviderRegistry`), so a model is named `workers-ai:@cf/openai/gpt-oss-120b` or `vertex:@cf/openai/gpt-oss-120b`. Each platform keeps the pieces the registry doesn't cover: images, the answer-quality judge and the squad's vendor routing.
  - **Workers AI** comes from the Worker's AI binding, through AI Gateway. Only Cloudflare has it.
  - **Vertex AI** (`platform/vertex.ts`, moved from the GCP app; plain fetch and WebCrypto, so it runs in workerd) needs a project and a Google access token. On Cloud Run the token comes from the service account's own credentials, with no key. From a Worker it comes from Workload Identity Federation (`GOOGLE_WORKLOAD_IDENTITY`), or from a service-account key (`GOOGLE_SERVICE_ACCOUNT_KEY`) where keys are allowed. Both are signed with WebCrypto (`platform/google-token.ts`).
  - **Workload Identity Federation, with the Worker as its own issuer.** The Worker holds a signing key; the public half is uploaded to the provider `cloudflare-worker` in the workload identity pool `northstar-workers`, so Google never fetches anything from the Worker. On each mint the Worker signs a ten-minute JWT (subject `northstar-worker`). Google's Security Token Service exchanges it for a federated token, and IAM Credentials exchanges that for a one-hour access token of `northstar-vertex-worker`. That service account holds `roles/aiplatform.user` only, and the pool's one subject holds `roles/iam.workloadIdentityUser` on it, nothing more. The provider accepts only that subject.
- **Chosen per request.** The top bar's **AI platform** menu, a broader name than "Models", lists what `/api/ai-platforms` reports: the platforms this host could run, each marked available or with the reason it isn't. The browser sends the choice with every chat message (`aiPlatform`, beside `scope`) and every workspace request (`x-ai-platform`). A choice the server can't run gets the server's default: `AI_PLATFORM` if set, else Workers AI where it is bound, else Vertex AI.
- **An operator can narrow the menu.** `AI_PLATFORMS_ENABLED` (comma-separated; unset means all) leaves a platform out entirely: it isn't built, listed or run, and a request that names it gets the default. The proof Worker sets `workers-ai,vertex` in `wrangler.jsonc`.
- **What follows the choice.** The chat orchestrator, the classifier, campaign images, the Architecture agents and the squad's open-model tier. The squad's Anthropic and OpenAI vendors keep the host's route: AI Gateway on Cloudflare, Claude on Vertex on Google Cloud. The answer-quality judge uses the default platform.
- **The trace names the platform.** `turn-start` carries `aiPlatform`. The route map draws Vertex AI with no AI Gateway hop and Workers AI behind AI Gateway, whichever host served the page.
- **Cedar stays in-process.** A decision takes about 0.1 ms in the process that asks. A separate Worker would add a network round trip to every tool offer and every tool call, and from Cloud Run a trip to another cloud, for no isolation gain: the policies are data compiled into each bundle, and the gateway functions (`toolsAllowed`, `authorizeTool`) are already the seam to move behind if a shared policy service is ever needed.

## Consequences

- A Cloudflare Worker with `VERTEX_PROJECT` set and Google credentials offers both platforms. Without credentials, the menu shows Vertex AI as "not set up", with the reason.
- **No service-account key exists.** An IAM deny policy in the organization forbids creating them (`iam.serviceAccountKeys.create`). Andrew chose federation instead, knowing it sits beside that ban. The Worker's signing key is still a long-lived secret, but it is not a Google key: deleting the provider, or its public key, revokes it at once, and it can act only as `northstar-vertex-worker`. The credential JSON lives in Secret Manager as `northstar-vertex-worker-identity` until it is put on the Worker.
- Verified live on 2026-11-25: a Worker-shaped environment holding the credential listed both platforms, exchanged its token, and got an answer from gpt-oss-120b on Vertex AI. The exchange adds two calls once an hour; tokens are cached until five minutes before they expire.
- **To turn it on for the proof Worker:** pipe the credential straight into `wrangler secret put GOOGLE_WORKLOAD_IDENTITY` (see `infra/cloudflare/pot/README.md`), then deploy this branch.
- On Vertex, every chat model runs on gpt-oss-120b (ADR-018), so switching a Cloudflare turn to Vertex also moves the orchestrator from 20b to 120b. The trace names the model actually served.
- Google Cloud offers Vertex AI alone. Running Workers AI from Cloud Run (the reverse pairing) is not built.

## Supersedes

ADR-018's binding of models to host: the GCP host now supplies Vertex credentials rather than a model platform, and the shared code builds the platform.
