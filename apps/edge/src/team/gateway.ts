// Every vendor request the squad makes goes through the Cloudflare AI Gateway, and the vendor keys
// live on the gateway (BYOK, stored in Secrets Store), never in this Worker. The vendor SDKs build
// their requests as usual; this fetch sends each one to the gateway's provider-native endpoint
// instead of the vendor, with the vendor's key header removed so the gateway supplies its stored key.
//
// The usual path is the Worker's AI binding, which authenticates to the gateway itself
// (`env.AI.fetch` on https://workers-binding.ai/ai-gateway/gateways/{gateway}/{provider}/{path}).
// Where the binding has no fetch, the public gateway URL is used with a gateway token
// (`cf-aig-authorization`), if CF_AIG_TOKEN is set.

/** Vendor hosts the squad calls, the gateway's name for each, and the headers that carry a key. */
const VENDORS = [
  { host: "api.anthropic.com", provider: "anthropic", keyHeaders: ["x-api-key", "authorization"] },
  { host: "api.openai.com", provider: "openai", keyHeaders: ["authorization"] },
] as const;

export type GatewayVendor = (typeof VENDORS)[number]["provider"];

/** Placeholder key for the vendor SDKs, which require one. It is removed before anything is sent. */
export const GATEWAY_HELD_KEY = "held-by-ai-gateway";

type BindingWithFetch = Ai & { fetch?: (input: string, init?: RequestInit) => Promise<Response> };

export type GatewayRoute = {
  ai: Ai;
  gatewayId: string;
  /** Only for the public-URL fallback, when the binding has no fetch. */
  token?: string;
  /** Logged with each request on the gateway, so its logs show which agent called. */
  metadata?: Record<string, string>;
};

/** Whether the binding can carry a provider-native request itself. */
export const bindingCanFetch = (ai: Ai) => typeof (ai as BindingWithFetch).fetch === "function";

/** The gateway provider and path for a vendor URL, or undefined for a host the squad doesn't use. */
export function vendorRoute(url: string) {
  const parsed = new URL(url);
  const vendor = VENDORS.find((item) => item.host === parsed.host);
  if (!vendor) return undefined;
  return {
    provider: vendor.provider,
    path: `${parsed.pathname.replace(/^\/+/, "")}${parsed.search}`,
    keyHeaders: vendor.keyHeaders,
  };
}

/**
 * A fetch for a vendor SDK that sends every request through the gateway. A request for any other
 * host is refused rather than sent around the gateway.
 */
export function gatewayFetch(route: GatewayRoute): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const target = vendorRoute(request.url);
    if (!target)
      throw new Error(`${new URL(request.url).host} is not routed through the AI Gateway.`);
    const headers = new Headers(request.headers);
    // With no key on the request, the gateway uses the key stored for this provider.
    for (const name of target.keyHeaders) headers.delete(name);
    // Never fall back to Cloudflare-billed credentials: a missing stored key is an error.
    headers.set("cf-aig-no-wholesale", "true");
    if (route.metadata) headers.set("cf-aig-metadata", JSON.stringify(route.metadata));
    const body = request.body ? await request.arrayBuffer() : null;
    const binding = route.ai as BindingWithFetch;
    if (binding.fetch)
      return binding.fetch(
        `https://workers-binding.ai/ai-gateway/gateways/${encodeURIComponent(route.gatewayId)}/${target.provider}/${target.path}`,
        { method: request.method, headers, body, signal: request.signal },
      );
    if (!route.token)
      throw new Error(
        "This AI binding cannot send vendor requests itself. Set CF_AIG_TOKEN (an AI Gateway token) so requests can go to the gateway's public URL.",
      );
    headers.set("cf-aig-authorization", `Bearer ${route.token}`);
    const base = (await route.ai.gateway(route.gatewayId).getUrl(target.provider)).replace(
      /\/+$/,
      "",
    );
    return fetch(`${base}/${target.path}`, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
    });
  }) as typeof fetch;
}
