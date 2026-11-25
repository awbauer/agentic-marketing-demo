# ADR-021: The AI platform is chosen apart from the host

Status: accepted

Date: 2026-11-25

## Context

ADR-018 tied the models to the host: Workers AI on Cloudflare, Vertex AI on Google Cloud. Andrew asked for a clean interface between the app and its models, so a Cloudflare deployment can run Google's models (and, later, the reverse), with a menu in the top bar, like Brand and Run as, to pick the provider. He chose to build only the Cloudflare-to-Vertex pairing for now, on the Vercel AI SDK the app already uses, and asked for a broader name than "Models". He also asked whether the Cedar engine should move to a separate Worker.

## Decision

- **One registry of AI SDK providers.** `apps/edge/src/platform/models.ts` builds every platform this server can reach and registers each one in the AI SDK's provider registry (`createProviderRegistry`), so a model is named `workers-ai:@cf/openai/gpt-oss-120b` or `vertex:@cf/openai/gpt-oss-120b`. Each platform keeps the pieces the registry doesn't cover: images, the answer-quality judge and the squad's vendor routing.
  - **Workers AI** comes from the Worker's AI binding, through AI Gateway. Only Cloudflare has it.
  - **Vertex AI** (`platform/vertex.ts`, moved from the GCP app; plain fetch and WebCrypto, so it runs in workerd) needs a project and a Google access token. On Cloud Run the token comes from the service account's own credentials, with no key. From a Worker it comes from `GOOGLE_SERVICE_ACCOUNT_KEY`, signed with WebCrypto (`platform/google-token.ts`).
- **Chosen per request.** The top bar's **AI platform** menu, a broader name than "Models", lists what `/api/ai-platforms` reports: the platforms this host could run, each marked available or with the reason it isn't. The browser sends the choice with every chat message (`aiPlatform`, beside `scope`) and every workspace request (`x-ai-platform`). A choice the server can't run gets the server's default: `AI_PLATFORM` if set, else Workers AI where it is bound, else Vertex AI.
- **What follows the choice.** The chat orchestrator, the classifier, campaign images, the Architecture agents and the squad's open-model tier. The squad's Anthropic and OpenAI vendors keep the host's route: AI Gateway on Cloudflare, Claude on Vertex on Google Cloud. The answer-quality judge uses the default platform.
- **The trace names the platform.** `turn-start` carries `aiPlatform`. The route map draws Vertex AI with no AI Gateway hop and Workers AI behind AI Gateway, whichever host served the page.
- **Cedar stays in-process.** A decision takes about 0.1 ms in the process that asks. A separate Worker would add a network round trip to every tool offer and every tool call, and from Cloud Run a trip to another cloud, for no isolation gain: the policies are data compiled into each bundle, and the gateway functions (`toolsAllowed`, `authorizeTool`) are already the seam to move behind if a shared policy service is ever needed.

## Consequences

- A Cloudflare Worker with `VERTEX_PROJECT` set and Google credentials offers both platforms. Without credentials, the menu shows Vertex AI as "not set up", with the reason.
- **Credentials for the proof Worker are not in place.** An IAM deny policy in the organization forbids creating service-account keys (`iam.serviceAccountKeys.create`), so `GOOGLE_SERVICE_ACCOUNT_KEY` can't be issued for this project. The service account `northstar-vertex-worker` exists with `roles/aiplatform.user` only. The keyless alternative is Workload Identity Federation, with the Worker as its own token issuer. It needs a decision from the project's owner, since it is a way around the key ban, even if it is the way Google recommends.
- On Vertex, every chat model runs on gpt-oss-120b (ADR-018), so switching a Cloudflare turn to Vertex also moves the orchestrator from 20b to 120b. The trace names the model actually served.
- Google Cloud offers Vertex AI alone. Running Workers AI from Cloud Run (the reverse pairing) is not built.

## Supersedes

ADR-018's binding of models to host: the GCP host now supplies Vertex credentials rather than a model platform, and the shared code builds the platform.
