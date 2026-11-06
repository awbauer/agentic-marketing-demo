# ADR-012: A Lightning surface over the same Worker

Status: accepted

Date: 2026-11-06

## Context

WU-072 adds a Lightning Web Component so people can use the demo from Salesforce. It has to reach the same MCP servers and AI Gateway as the browser app, and keep tool transparency, use cases, the brand and role selectors, and history.

Three constraints shape it. The Worker is behind one Cloudflare Access application that covers every hostname, with no service-token policy. Each person's chat, Salesforce OAuth connection, and history live in a Durable Object keyed by their Access identity, so a new identity would be a separate workspace with its own Salesforce connection. Chat runs over a WebSocket, which Apex cannot hold.

## Decision

- **Sign in with Access.** Login opens a Worker page behind Access, which posts the person's Access token to the window that opened it, using `postMessage` with an exact target origin taken from `SURFACE_ALLOWED_ORIGINS`.
- **Relay through Apex.** The component calls one Apex method with a named operation. Apex sends the token in Access's `cf-access-token` header. The Worker needs no new auth mode: `resolvePrincipal` sees the same identity as in the browser, so the surface shares that person's agent, Salesforce connection, and history. Access needs no change, and the org needs no CORS or CSP exception.
- **Start and poll a turn.** `POST /agent/surface/turn` runs the turn through `saveMessages`, which reaches the same `onChatMessage` as a browser's turn. The component polls `GET /agent/surface/turn` about once a second. The Worker builds tool calls and trace rows with the browser's code, so the surface has no second copy of the logic.
- **Use the platform's Design System.** Components use Lightning base components, SLDS classes, and `--slds-g-*` styling hooks, and ship no copy of SLDS, so they follow the org's current SLDS theme.

The Lightning org hosts only the UI. The Salesforce MCP stays pointed at the proof org.

## Consequences

- The browser holds a person's Access token for the rest of its session, in session storage, and Apex forwards it per call. It is accepted only by this Access application, but it is a bearer token until it expires. A token is never stored by Apex.
- Polling is coarser than streaming: tool steps appear live, but text arrives in about one-second steps.
- Reading the in-progress answer uses `AIChatAgent`'s private `_streamingMessage`, because the SDK offers no reader. `surface.worker.test.ts` runs a turn through it, so an SDK upgrade that moves it fails a test rather than a demo.
- A person must be allowed by the Workbench's Access policy to sign in, and by the portal's Access policy to connect Salesforce. The portal currently allows fewer people than the Workbench.
- Each new org needs its Lightning origin added to `SURFACE_ALLOWED_ORIGINS` and a Worker deploy.

## Supersedes

none
