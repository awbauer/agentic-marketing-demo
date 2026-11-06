import { LightningElement, track } from "lwc";
import { errorMessage, isSignedIn, request, SignedOutError, signIn, signOut } from "c/northstarApi";

const SCOPE_KEY = "northstar.scope";
const CONNECT_POLL_MS = 2000;
const CONNECT_POLL_LIMIT = 90;
const SALESFORCE_STATES = {
  ready: { label: "Connected", className: "slds-theme_success" },
  authenticating: { label: "Authorizing", className: "slds-theme_warning" },
  expired: { label: "Expired", className: "slds-theme_warning" },
  error: { label: "Needs attention", className: "slds-theme_error" },
  disconnected: { label: "Not connected", className: "" },
  "not-configured": { label: "Not configured", className: "" },
};

function loadScope() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SCOPE_KEY));
    return { brand: stored?.brand ?? "all", persona: stored?.persona ?? "marketer" };
  } catch {
    return { brand: "all", persona: "marketer" };
  }
}

/** The page: Login, the brand and role, the connections, and the Chat, Use cases, History tabs. */
export default class NorthstarWorkbench extends LightningElement {
  signedIn = isSignedIn();
  loading = false;
  signingIn = false;
  error = "";
  activeTab = "chat";
  draft = "";
  historyKey = 0;
  connector = null;
  connecting = false;
  knowledgeGraph = "";
  @track scope = loadScope();
  bootstrap = null;

  connectedCallback() {
    if (this.signedIn) this.load();
  }

  disconnectedCallback() {
    window.clearTimeout(this.connectTimer);
  }

  async load() {
    this.loading = true;
    this.error = "";
    try {
      const [bootstrap, connector, operations] = await Promise.all([
        request("bootstrap"),
        request("salesforceStatus"),
        request("operations"),
      ]);
      this.bootstrap = bootstrap;
      this.connector = connector;
      this.knowledgeGraph = operations.knowledgeGraph ?? "";
      if (!bootstrap.personas.some((persona) => persona.value === this.scope.persona))
        this.setScope({ persona: "marketer" });
    } catch (error) {
      this.handleError(error);
    } finally {
      this.loading = false;
    }
  }

  handleError(error) {
    if (error instanceof SignedOutError) {
      this.signedIn = false;
      this.bootstrap = null;
    }
    this.error = errorMessage(error);
  }

  async handleLogin() {
    this.signingIn = true;
    this.error = "";
    try {
      await signIn();
      this.signedIn = true;
      await this.load();
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.signingIn = false;
    }
  }

  handleLogout() {
    signOut();
    this.signedIn = false;
    this.bootstrap = null;
    this.connector = null;
    this.error = "";
  }

  setScope(change) {
    this.scope = { ...this.scope, ...change };
    try {
      window.localStorage.setItem(SCOPE_KEY, JSON.stringify(this.scope));
    } catch {
      // Blocked storage just doesn't remember the choice.
    }
  }

  handleBrand(event) {
    this.setScope({ brand: event.detail.value });
  }

  handlePersona(event) {
    this.setScope({ persona: event.detail.value });
  }

  handleTab(event) {
    this.activeTab = event.target.value;
    if (this.activeTab === "history") this.historyKey += 1;
  }

  handleTry(event) {
    this.draft = event.detail.prompt;
    this.activeTab = "chat";
  }

  handleTurnSettled() {
    this.historyKey += 1;
  }

  handleChatError(event) {
    this.handleError(event.detail.error);
  }

  async handleConnect() {
    this.connecting = true;
    this.error = "";
    try {
      const connector = await request("salesforceConnect");
      this.connector = connector;
      if (connector.authUrl)
        window.open(connector.authUrl, "northstar-salesforce", "width=560,height=760");
      this.watchConnection(0);
    } catch (error) {
      this.connecting = false;
      this.handleError(error);
    }
  }

  async watchConnection(attempt) {
    try {
      const connector = await request("salesforceStatus");
      this.connector = connector;
      if (connector.state === "authenticating" && attempt < CONNECT_POLL_LIMIT) {
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this.connectTimer = window.setTimeout(
          () => this.watchConnection(attempt + 1),
          CONNECT_POLL_MS,
        );
        return;
      }
    } catch (error) {
      this.handleError(error);
    }
    this.connecting = false;
  }

  async handleDisconnect() {
    try {
      this.connector = await request("salesforceDisconnect");
    } catch (error) {
      this.handleError(error);
    }
  }

  get ready() {
    return this.signedIn && Boolean(this.bootstrap);
  }

  get needsLogin() {
    return !this.signedIn;
  }

  get identity() {
    return this.bootstrap?.principal.email ?? "";
  }

  get brandOptions() {
    return [
      { label: "All brands", value: "all" },
      ...(this.bootstrap?.brands ?? []).map((brand) => ({ label: brand, value: brand })),
    ];
  }

  get personaOptions() {
    return this.bootstrap?.personas ?? [];
  }

  get placeholder() {
    return this.bootstrap?.placeholders[this.scope.brand] ?? "";
  }

  get useCases() {
    return this.bootstrap?.useCases ?? [];
  }

  get salesforceState() {
    return SALESFORCE_STATES[this.connector?.state] ?? SALESFORCE_STATES.disconnected;
  }

  get salesforceMessage() {
    return this.connector?.message ?? "";
  }

  get salesforceConnected() {
    return this.connector?.state === "ready";
  }

  get connectLabel() {
    return this.connector?.state === "expired" ? "Reconnect" : "Connect";
  }

  get mcpServers() {
    return (this.bootstrap?.mcpServers ?? []).map((server) => ({
      ...server,
      detail:
        server.id === "knowledge-graph" && this.knowledgeGraph
          ? `In the Worker, ${this.knowledgeGraph} backend`
          : "In the Worker, behind your sign-in",
    }));
  }

  get gatewayId() {
    return this.bootstrap?.gateway.id ?? "";
  }

  get modelId() {
    return this.bootstrap?.gateway.model ?? "";
  }
}
