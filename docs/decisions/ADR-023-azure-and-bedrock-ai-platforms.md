# ADR-023: Azure AI Foundry and Amazon Bedrock as AI platforms

Status: accepted

Date: 2026-11-26

## Context

ADR-021 separated the AI platform from the host. The page, the database and the hosting stay on Cloudflare, and each request picks where its models run: Workers AI, or Vertex AI reached from the Worker. Andrew asked for the same for Azure and AWS, keeping Cloudflare as the only frontend and database for now.

## Decision

Add two platforms to the registry in `apps/edge/src/platform/models.ts`, built like Vertex AI. Each uses plain fetch, so it runs in workerd and in Node, and each is called directly, with no AI Gateway hop.

- **Azure AI Foundry** (`platform/azure.ts`, id `azure`).
  - **Chat:** chat models go through the resource's OpenAI-compatible v1 API (`<endpoint>/openai/v1`). gpt-oss-120b runs as a deployment named `gpt-oss-120b`, and `AZURE_AI_DEPLOYMENTS` maps other catalog ids to other deployments. Ids without a deployment run on gpt-oss-120b, as on Vertex.
  - **Images:** campaign images come from a GPT Image deployment (`AZURE_AI_IMAGE_DEPLOYMENT`, `gpt-image-1` by default).
  - **Credentials:** the resource's key (`AZURE_AI_API_KEY`). Where key access is turned off on the resource, a Microsoft Entra service principal (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) with the Cognitive Services OpenAI User role is used instead. Its tokens are cached until five minutes before they expire.
- **Amazon Bedrock** (`platform/bedrock.ts`, id `bedrock`).
  - **Chat:** chat models go through Bedrock's OpenAI-compatible Chat Completions endpoint in `BEDROCK_REGION` (`us-west-2` by default). That endpoint serves both gpt-oss-120b and gpt-oss-20b, so the orchestrator keeps 20b on Bedrock.
  - **Images:** campaign images come from Amazon Nova Canvas through InvokeModel, in `BEDROCK_IMAGE_REGION` (`us-east-1` by default).
  - **Credentials:** a Bedrock API key (`BEDROCK_API_KEY`), sent as a bearer token, so no SigV4 signing is needed.
- **Shared gpt-oss handling.** All three platforms reuse Vertex's wrapper (`openModelCompat`), which:
  - translates the Workers AI reasoning effort;
  - turns a forced tool choice into an instruction;
  - recovers a call the endpoint dropped.

  The three also reuse the rubric judge (`rubricJudge`), where gpt-oss answers Clef's rubric. Whether the Azure and Bedrock endpoints share Vertex's quirks is not yet measured; the wrapper is harmless where they don't.
- **On the menu only when meant.** Azure and Bedrock are listed once any of their settings is present, as available or with what is missing. A deployment that never set them shows only Workers AI and Vertex AI, as before. `AI_PLATFORMS_ENABLED` and `AI_PLATFORM` accept `azure` and `bedrock`.
- **What follows the choice is unchanged.** As in ADR-021, the following run on whichever platform is chosen:
  - the orchestrator and the classifier;
  - campaign images;
  - the Architecture agents;
  - the squad's open-model tier.

  The squad's Anthropic and OpenAI vendors keep the host's route: AI Gateway on Cloudflare, Claude on Vertex AI on Google Cloud. Azure and Bedrock have no vendor route, so making either the default (`AI_PLATFORM`) leaves the vendors on the host's route (`vendorPlatform`) rather than turning them off. The trace, the route map and each squad run name the platform.

## Consequences

- **These credentials are secrets.** Vertex AI is reached through Workload Identity Federation with no Google key. Azure and AWS are reached with a resource key, a client secret or a Bedrock API key, each scoped to model invocation and stored as Worker secrets. A keyless path exists on both clouds: an Entra federated credential, and an IAM OIDC identity provider with `AssumeRoleWithWebIdentity`. Unlike Google's provider, though, both fetch the issuer's discovery document and keys from a public HTTPS URL. The Worker would have to publish an OIDC issuer outside Cloudflare Access first. That is not built.
- **Not yet verified live.** The request shapes are tested against a fake fetch (`apps/gcp/test/platform/azure-bedrock.test.ts`). No Azure resource or Bedrock key has been put on the proof Worker. The first live run should check three things:
  - tool calling on both endpoints, including whether forced choices are refused;
  - `reasoning_effort` on Bedrock;
  - the Nova Canvas image size limits.
- **Model access is per cloud.** gpt-oss must be deployed in the Foundry resource and granted in the Bedrock console's model access page before the platform answers.
- Google Cloud can offer these platforms too, since its host passes its environment through. Nothing there sets them.

## Supersedes

None. Extends ADR-021.
