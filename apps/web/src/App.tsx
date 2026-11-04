import { useAgentChat } from "@cloudflare/ai-chat/react";
import {
  type Confirmation,
  currentFocusVersion,
  type GeneratedCampaignImage,
  GeneratedCampaignImageSchema,
  initialOrchestratorState,
  type OperationControls,
  OperationControlsSchema,
  type OrchestratorState,
  OrchestratorStateSchema,
  PHASE_2_CURATED_TOOLS,
  WRITE_TOOL_BY_ACTION,
} from "@northstar/contracts";
import {
  normalizeAssistantText,
  salesforceRecordUrl,
  shouldShowChatError,
  unwrapAssistantText,
} from "@northstar/ui";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { ActionCards } from "./ActionCards";
import { ArchitectureView } from "./architecture/ArchitectureView";
import { JourneysView } from "./architecture/JourneysView";
import { MarketingWriteDetails, PermissionDetails } from "./ConfirmationDetails";
import { EvaluationView } from "./EvaluationView";
import { GraphEvidencePanel } from "./GraphEvidence";
import { GraphView } from "./graph/GraphView";
import { HistoryView } from "./HistoryView";
import { LearnView } from "./learn/LearnView";
import { Markdown } from "./Markdown";
import { SalesforceAgentsPanel } from "./SalesforceAgents";
import { ToolActivity } from "./ToolActivity";
import { ScopeBar } from "./ScopeBar";
import { BRAND_IMAGE_CONCEPT, BRAND_PLACEHOLDER, useScope } from "./scope";
import { executionTrace } from "./turn-trace";
import { UseCasesView } from "./usecases/UseCasesView";
import { WorkspacePanel } from "./WorkspacePanel";
import { WriteProgress } from "./WriteProgress";

function rawMessageText(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

function messageText(message: UIMessage) {
  const text = rawMessageText(message);
  return message.role === "assistant" ? normalizeAssistantText(text) : text;
}

function TechnicalTrace({
  rows,
  live,
}: {
  rows: ReturnType<typeof executionTrace>;
  live: boolean;
}) {
  if (rows.length === 0) return null;
  const errors = rows.filter((row) => row.state === "error").length;
  return (
    <details className="execution-trace" open={live || errors > 0}>
      <summary>
        Behind the scenes · technical trace
        <span className="trace-summary-meta">
          {` · ${rows.length} events${errors ? ` · ${errors} with issues` : ""}${live ? " · live" : ""}`}
        </span>
      </summary>
      <ol>
        {rows.map((row) => (
          <li className={`trace-${row.state} trace-kind-${row.kind}`} key={row.key}>
            <i className={`trace-indicator indicator-${row.state}`} />
            <div className="trace-detail">
              <div className="trace-heading">
                <strong>{row.label}</strong>
                {row.elapsed && <time className="trace-time">{row.elapsed}</time>}
              </div>
              <span className="trace-copy">{row.detail}</span>
              {row.payload && (
                <details className="payload-viewer">
                  <summary>{row.payloadLabel ?? "Sanitized payload"}</summary>
                  <pre>{row.payload}</pre>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="trace-boundary">
        Every model and tool lifecycle event for this turn, in order, with times from the start of
        the turn. Credentials, confirmation material, and personal data are redacted.
      </p>
    </details>
  );
}

const CONFIRMATION_COPY = {
  "save-marketing-brief": { title: "Save brief in Marketing Cloud?", confirm: "Confirm save" },
  "create-marketing-campaign": {
    title: "Create the campaign in Marketing Cloud?",
    confirm: "Confirm create",
  },
  "create-review-task": { title: "Create Salesforce review task?", confirm: "Confirm create" },
  "attach-generated-image": {
    title: "Attach image to the Salesforce campaign?",
    confirm: "Confirm attach",
  },
  "create-inventory-case": {
    title: "Open a Salesforce case for the store manager?",
    confirm: "Confirm case",
  },
} as const;

/** What an inventory case will list: the store manager, the forecast, and each low item. */
function InventoryCaseDetails({ confirmation }: { confirmation: Confirmation }) {
  const details = confirmation.inventoryCase;
  if (!details) return null;
  return (
    <div className="inventory-case">
      <p>
        <strong>For {details.manager.name}</strong>, store manager, Coastline Kitchen {details.city}{" "}
        · forecast: {details.conditions.join(", ")}
      </p>
      <table>
        <caption className="sr-only">Items that won't cover the forecast</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">On hand</th>
            <th scope="col">On order</th>
            <th scope="col">Needed</th>
            <th scope="col">Dishes</th>
          </tr>
        </thead>
        <tbody>
          {details.items.map((item) => (
            <tr key={item.name}>
              <th scope="row">{item.name}</th>
              <td>
                {item.onHand} {item.unit}
              </td>
              <td>
                {item.onOrder} {item.unit}
              </td>
              <td>
                {item.projectedNeed} {item.unit}
              </td>
              <td>{item.menuItems.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<OrchestratorState>(initialOrchestratorState);
  const [input, setInput] = useState("");
  const { scope } = useScope();
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "error">("loading");
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<Confirmation | null>(null);
  /** True from the moment Confirm is clicked until the write finishes. */
  const [executing, setExecuting] = useState(false);
  // What's being prepared for confirmation: an action card's id, or "image" for an attachment.
  const [preparing, setPreparing] = useState<string | null>(null);
  const [createdRecord, setCreatedRecord] = useState<{
    objectApiName: "Task";
    recordId: string;
    subject: string;
    priority: string;
    dueDate: string;
    status: string;
    campaignId: string;
  } | null>(null);
  const [openedCase, setOpenedCase] = useState<{
    recordId: string;
    caseNumber: string;
    subject: string;
    priority: string;
    contactName: string;
    source: string;
  } | null>(null);
  const [savedRecord, setSavedRecord] = useState<{
    label: string;
    title: string;
    objectType: string;
    recordId: string;
    agent: string;
    actions: string[];
    note?: string;
  } | null>(null);
  const [attachedImage, setAttachedImage] = useState<{
    contentDocumentId: string;
    contentVersionId: string;
    campaignId: string;
    title: string;
    contentSize: number;
    contentHash: string;
  } | null>(null);
  // The concept starts from the header brand until the person edits it.
  const [editedConcept, setEditedConcept] = useState<string | null>(null);
  const imageConcept = editedConcept ?? BRAND_IMAGE_CONCEPT[scope.brand];
  const setImageConcept = setEditedConcept;
  useEffect(() => {
    setEditedConcept(null);
  }, [scope.brand]);
  const [images, setImages] = useState<GeneratedCampaignImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const generatedImage =
    images.find((image) => image.id === selectedImageId) ??
    images.find((image) => image.lifecycle !== "rejected") ??
    null;
  // Writes act on the Salesforce campaign this chat has open, if any.
  const openCampaign = state.workingSet.records.find(
    (record) => record.system === "salesforce" && record.objectType === "Campaign",
  );
  const briefCampaignId = openCampaign?.recordId;
  const [imageBusy, setImageBusy] = useState(false);
  const [operations, setOperations] = useState<OperationControls>({
    writesEnabled: true,
    memoryEnabled: true,
    disabledTools: [],
  });
  const [view, setView] = useState<
    | "chat"
    | "history"
    | "evaluations"
    | "learn"
    | "graph"
    | "usecases"
    | "journeys"
    | "architecture"
  >("chat");
  // History and the use-case library open from the chat page, so the rail shows them as Chat.
  const chatViews: ReadonlyArray<typeof view> = ["chat", "history", "usecases"];
  const confirmationRef = useRef<HTMLElement>(null);
  const connectorStatusLoaded = useRef(false);
  /** The confirmation the server holds, from its latest state: a failed write may have spent it. */
  const serverConfirmationId = useRef<string | null>(null);
  const agent = useAgent<OrchestratorState>({
    agent: "MarketingOrchestrator",
    basePath: "agent",
    onStateUpdate(next) {
      const parsed = OrchestratorStateSchema.safeParse(next);
      if (parsed.success) {
        setState((current) => ({
          ...parsed.data,
          connector: connectorStatusLoaded.current ? current.connector : parsed.data.connector,
        }));
        serverConfirmationId.current = parsed.data.pendingConfirmation?.id ?? null;
        if (parsed.data.pendingConfirmation) {
          setPendingConfirmation(parsed.data.pendingConfirmation);
        }
      }
    },
  });
  const { messages, sendMessage, stop, clearHistory, status, isRecovering, error } = useAgentChat({
    agent,
    resume: true,
    cancelOnClientAbort: false,
  });

  useEffect(() => {
    fetch("/api/session")
      .then((response) => {
        if (!response.ok) throw new Error("session");
        return response.json();
      })
      .then(() => setSessionState("ready"))
      .catch(() => setSessionState("error"));
    fetch("/agent/operations")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const parsed = OperationControlsSchema.safeParse(body);
        if (parsed.success) setOperations(parsed.data);
      })
      .catch(() => undefined);
    loadConnector().catch(() => {
      connectorStatusLoaded.current = true;
      setState((current) => ({
        ...current,
        connector: {
          ...current.connector,
          state: "error",
          message: "Salesforce connection status is unavailable. Retry the page to recover.",
        },
      }));
    });
  }, []);
  const busy = status === "submitted" || status === "streaming" || isRecovering;
  const [resetting, setResetting] = useState(false);
  const salesforceReady = state.connector.state === "ready";
  const showChatError = shouldShowChatError(
    status === "error" && Boolean(error) && !isRecovering,
    messages.map((message) => ({
      role: message.role,
      text: messageText(message),
      hasCompletedToolOutput: message.parts.some(
        (part) => "state" in part && part.state === "output-available",
      ),
    })),
  );

  useEffect(() => {
    if (state.connector.state !== "authenticating") return;
    const timer = window.setInterval(() => {
      void loadConnector().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [state.connector.state]);

  // Scroll to a confirmation once, when it appears. State broadcasts (such as a write's progress)
  // re-deliver the same confirmation, which must not pull the view back to the card's top.
  const pendingConfirmationId = pendingConfirmation?.id;
  useEffect(() => {
    if (pendingConfirmationId) confirmationRef.current?.scrollIntoView({ block: "nearest" });
  }, [pendingConfirmationId]);

  function writeBlock(action: keyof typeof WRITE_TOOL_BY_ACTION) {
    if (!operations.writesEnabled) return "Writes paused by an operator";
    return (operations.disabledTools as readonly string[]).includes(WRITE_TOOL_BY_ACTION[action])
      ? "Turned off by an operator"
      : null;
  }

  async function agentAction<T>(path: string, body?: unknown) {
    setActionError("");
    const response = await fetch(`/agent/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let result: T & { error?: { message?: string } };
    try {
      result = (await response.json()) as T & { error?: { message?: string } };
    } catch {
      throw new Error(
        response.ok
          ? "The server returned an unreadable response. Try again."
          : "The server could not complete the request. Try again or reconnect Salesforce.",
      );
    }
    if (!response.ok)
      throw new Error(result.error?.message ?? "The action could not be completed.");
    return result;
  }

  async function loadConnector() {
    const response = await fetch("/agent/salesforce/status");
    if (!response.ok) throw new Error("Salesforce connection status is unavailable.");
    const connector = OrchestratorStateSchema.shape.connector.parse(await response.json());
    connectorStatusLoaded.current = true;
    setState((current) => ({ ...current, connector }));
    return connector;
  }

  async function connectSalesforce() {
    setConnectorBusy(true);
    try {
      const result = await agentAction<OrchestratorState["connector"]>("salesforce/connect");
      setState((current) => ({ ...current, connector: result }));
      if (result.authUrl) window.location.assign(result.authUrl);
    } catch (actionError) {
      setActionError(actionError instanceof Error ? actionError.message : "Connection failed.");
    } finally {
      setConnectorBusy(false);
    }
  }

  async function disconnectSalesforce() {
    setConnectorBusy(true);
    try {
      const connector = await agentAction<OrchestratorState["connector"]>("salesforce/disconnect");
      setState((current) => ({ ...current, connector }));
    } catch (actionError) {
      setActionError(actionError instanceof Error ? actionError.message : "Disconnect failed.");
    } finally {
      setConnectorBusy(false);
    }
  }

  /**
   * Clears the conversation and its working set together. Sending waits until the server has
   * reset, so a reset that lands late can't wipe what the new chat's first turn added. The
   * cleared workspace arrives through the agent's state broadcast, which is always the newest.
   */
  function startNewChat() {
    clearHistory();
    setSavedRecord(null);
    setOpenedCase(null);
    setImages([]);
    setSelectedImageId(null);
    setResetting(true);
    agentAction<OrchestratorState["workingSet"]>("working-set/reset")
      .catch((resetError: unknown) =>
        setActionError(
          resetError instanceof Error ? resetError.message : "The workspace could not be cleared.",
        ),
      )
      .finally(() => setResetting(false));
  }

  /** Accepting an action card prepares its confirmation, with the Salesforce permission check. */
  async function acceptSuggestion(id: string) {
    if (preparing) return;
    startPreparing(id);
    try {
      const confirmation = await agentAction<Confirmation>(`suggestions/${id}/accept`);
      setPendingConfirmation(confirmation);
      setState((current) => ({ ...current, pendingConfirmation: confirmation }));
    } catch (actionError) {
      setActionError(actionError instanceof Error ? actionError.message : "Preflight failed.");
    } finally {
      setPreparing(null);
    }
  }

  /** Clears the last run's steps so the panel shows only this preparation's, as the Worker sends them. */
  function startPreparing(what: string) {
    setPreparing(what);
    setActionError("");
    setState((current) => ({ ...current, writeProgress: null }));
  }

  async function dismissSuggestion(id: string) {
    try {
      await agentAction(`suggestions/${id}/dismiss`);
      setState((current) => ({
        ...current,
        suggestions: (current.suggestions ?? []).filter((item) => item.id !== id),
      }));
    } catch (actionError) {
      setActionError(actionError instanceof Error ? actionError.message : "Dismiss failed.");
    }
  }

  async function generateCampaignImage() {
    const campaign = openCampaign;
    if (!campaign) return;
    setImageBusy(true);
    try {
      const image = await agentAction<GeneratedCampaignImage>("images/generate", {
        campaignId: campaign.recordId,
        channel: "email",
        concept: imageConcept,
      });
      setActionError("");
      setImages((current) => [image, ...current.filter((existing) => existing.id !== image.id)]);
      setSelectedImageId(image.id);
    } catch (actionError) {
      setActionError(
        actionError instanceof Error ? actionError.message : "Image generation failed.",
      );
    } finally {
      setImageBusy(false);
    }
  }

  // Variants persist server-side for seven days, so reloads keep the review gallery.
  useEffect(() => {
    if (!briefCampaignId) return;
    fetch(`/agent/images?campaignId=${encodeURIComponent(briefCampaignId)}`)
      .then((response) => (response.ok ? response.json() : { images: [] }))
      .then((body: { images?: unknown[] }) => {
        const loaded = (body.images ?? []).flatMap((image) => {
          const parsed = GeneratedCampaignImageSchema.safeParse(image);
          return parsed.success ? [parsed.data] : [];
        });
        setImages((current) => (current.length ? current : loaded));
      })
      .catch(() => undefined);
  }, [briefCampaignId]);

  async function rejectImage(imageId: string) {
    try {
      await agentAction(`images/${imageId}/reject`);
      setImages((current) =>
        current.map((image) =>
          image.id === imageId ? { ...image, lifecycle: "rejected" } : image,
        ),
      );
      setSelectedImageId(null);
    } catch (actionError) {
      setActionError(actionError instanceof Error ? actionError.message : "Reject failed.");
    }
  }

  async function requestImageAttachment() {
    if (!generatedImage || preparing) return;
    startPreparing("image");
    try {
      const confirmation = await agentAction<Confirmation>("confirmations", {
        action: "attach-generated-image",
        recordId: generatedImage.campaignId,
        imageId: generatedImage.id,
      });
      setPendingConfirmation(confirmation);
      setState((current) => ({ ...current, pendingConfirmation: confirmation }));
    } catch (actionError) {
      setActionError(actionError instanceof Error ? actionError.message : "Preflight failed.");
    } finally {
      setPreparing(null);
    }
  }

  async function resolveConfirmation(decision: "execute" | "deny") {
    const action = pendingConfirmation?.action;
    if (decision === "execute") {
      if (executing) return;
      setExecuting(true);
      setActionError("");
    }
    try {
      const result = await agentAction<{
        result?: {
          recordId: string;
          campaignId: string;
          objectType?: string;
          readBack: boolean;
          status: string;
          subject: string;
          priority: string;
          dueDate: string;
          contentVersionId?: string;
          title?: string;
          contentSize?: number;
          contentHash?: string;
          agent?: { label: string; kind: string };
          actions?: Array<{ label: string }>;
          brief?: { id: string; name: string };
          preview?: unknown[];
          campaign?: { id: string; name: string; flow: { label: string } | null };
          note?: string;
          caseNumber?: string;
          contactName?: string;
          source?: string;
        };
      }>(`confirmations/${decision}`);
      setPendingConfirmation(null);
      setState((current) => ({
        ...current,
        pendingConfirmation: null,
      }));
      if (decision === "execute" && result.result?.readBack && action === "create-inventory-case") {
        setActionError("");
        setOpenedCase({
          recordId: result.result.recordId,
          caseNumber: result.result.caseNumber ?? "",
          subject: result.result.subject,
          priority: result.result.priority,
          contactName: result.result.contactName ?? "",
          source: result.result.source ?? "salesforce",
        });
      } else if (
        decision === "execute" &&
        result.result?.readBack &&
        action === "attach-generated-image"
      ) {
        setActionError("");
        setAttachedImage({
          contentDocumentId: result.result.recordId,
          contentVersionId: result.result.contentVersionId ?? "",
          campaignId: result.result.campaignId,
          title: result.result.title ?? "Campaign image",
          contentSize: result.result.contentSize ?? 0,
          contentHash: result.result.contentHash ?? "",
        });
        const attachedId = pendingConfirmation?.imageId;
        setImages((current) =>
          current.map((image) =>
            image.id === attachedId ? { ...image, lifecycle: "attached" } : image,
          ),
        );
      } else if (decision === "execute" && result.result?.readBack && pendingConfirmation?.write) {
        setActionError("");
        const campaign = result.result.campaign;
        const brief = result.result.brief;
        setSavedRecord(
          campaign && pendingConfirmation.write.kind === "campaign"
            ? {
                label: "Campaign and flow created in Marketing Cloud",
                title: `${campaign.name}${campaign.flow ? ` · ${campaign.flow.label}` : ""}`,
                objectType: "Campaign",
                recordId: campaign.id,
                agent: result.result.agent?.label ?? "Campaign Creation agent",
                actions: (result.result.actions ?? []).map((item) => item.label),
                note: result.result.note,
              }
            : {
                label: "Brief saved in Marketing Cloud",
                title: `${brief?.name ?? ""} · ${result.result.preview?.length ?? 0}-step campaign preview`,
                objectType: "Brief",
                recordId: brief?.id ?? result.result.recordId,
                agent: result.result.agent?.label ?? "Campaign Creation agent",
                actions: (result.result.actions ?? []).map((item) => item.label),
                note: result.result.note,
              },
        );
      } else if (decision === "execute" && result.result?.readBack) {
        setActionError("");
        setCreatedRecord({
          objectApiName: "Task",
          recordId: result.result.recordId,
          subject: result.result.subject,
          priority: result.result.priority,
          dueDate: result.result.dueDate,
          status: result.result.status,
          campaignId: result.result.campaignId,
        });
      }
    } catch (actionError) {
      setActionError(actionError instanceof Error ? actionError.message : "Confirmation failed.");
      // A Marketing Cloud write spends its confirmation before calling the agent, so after a
      // failure there may be nothing left to confirm: drop the card rather than offer a dead button.
      if (serverConfirmationId.current !== pendingConfirmation?.id) setPendingConfirmation(null);
    } finally {
      if (decision === "execute") setExecuting(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark">N</div>
        <div>
          <p>Northstar</p>
          <h1>Marketing workbench</h1>
        </div>
        <div className="top-actions">
          <ScopeBar />
          <span className={`connection ${sessionState}`}>
            {sessionState === "ready"
              ? "Demo workspace"
              : sessionState === "error"
                ? "Connection issue"
                : "Connecting"}
          </span>
          <button type="button" className="avatar" aria-label="User menu">
            AE
          </button>
        </div>
      </header>
      <div className="workspace">
        <nav className="rail" aria-label="Workspace navigation">
          <div>
            <p className="nav-label">Workspace</p>
            <button
              type="button"
              className={`nav-item ${chatViews.includes(view) ? "active" : ""}`}
              aria-current={chatViews.includes(view) ? "page" : undefined}
              onClick={() => setView("chat")}
            >
              <span>◆</span>Chat
            </button>
            <button
              type="button"
              className={`nav-item ${view === "evaluations" ? "active" : ""}`}
              aria-current={view === "evaluations" ? "page" : undefined}
              onClick={() => setView("evaluations")}
            >
              <span>✓</span>Evaluations
            </button>
            <button
              type="button"
              className={`nav-item ${view === "learn" ? "active" : ""}`}
              aria-current={view === "learn" ? "page" : undefined}
              onClick={() => setView("learn")}
            >
              <span>◎</span>Learn
            </button>
            <button
              type="button"
              className={`nav-item ${view === "graph" ? "active" : ""}`}
              aria-current={view === "graph" ? "page" : undefined}
              onClick={() => setView("graph")}
            >
              <span>⋈</span>Graph
            </button>
            <button
              type="button"
              className={`nav-item ${view === "journeys" ? "active" : ""}`}
              aria-current={view === "journeys" ? "page" : undefined}
              onClick={() => setView("journeys")}
            >
              <span>↝</span>Journeys
            </button>
            <button
              type="button"
              className={`nav-item ${view === "architecture" ? "active" : ""}`}
              aria-current={view === "architecture" ? "page" : undefined}
              onClick={() => setView("architecture")}
            >
              <span>◫</span>Architecture
            </button>
          </div>
          <div>
            <p className="nav-label">Sources</p>
            <div className="source-row">
              <i className={`dot ${salesforceReady ? "ready" : "stale"}`} />
              Salesforce CRM
            </div>
            <div className="source-row">
              <i className={`dot ${salesforceReady ? "ready" : "stale"}`} />
              Marketing Cloud Next
            </div>
            <div className="source-row">
              <i className={`dot ${salesforceReady ? "ready" : "stale"}`} />
              Data 360
            </div>
            <div className="source-row">
              <i
                className={`dot ${operations.disabledTools.includes("get_restaurant_profile") ? "stale" : "ready"}`}
              />
              Restaurant data
            </div>
            <div className="source-row">
              <i
                className={`dot ${operations.disabledTools.includes("get_current_weather") ? "stale" : "ready"}`}
              />
              Weather · Open-Meteo
            </div>
            <div className="source-row">
              <i
                className={`dot ${operations.disabledTools.includes("get_public_holidays") ? "stale" : "ready"}`}
              />
              Holidays · Nager.Date
            </div>
            <div className="source-row">
              <i
                className={`dot ${operations.disabledTools.includes("get_weather_alerts") ? "stale" : "ready"}`}
              />
              Weather alerts · NWS
            </div>
            <div className="source-row">
              <i
                className={`dot ${operations.disabledTools.includes("get_fed_announcements") ? "stale" : "ready"}`}
              />
              Rate news · Federal Reserve
            </div>
            <div className="source-row">
              <i
                className={`dot ${operations.knowledgeGraph === "neo4j" && !operations.disabledTools.includes("get_graph_overview") ? "ready" : "stale"}`}
              />
              {operations.knowledgeGraph === "fixture"
                ? "Knowledge graph · demo copy"
                : "Knowledge graph · Neo4j"}
            </div>
          </div>
          <section className="connector-panel" aria-labelledby="salesforce-connector-title">
            <strong id="salesforce-connector-title">{state.connector.label}</strong>
            <span role={state.connector.state === "error" ? "alert" : undefined}>
              {state.connector.message}
            </span>
            <small className={`connector-state state-${state.connector.state}`}>
              {state.connector.state.replace("-", " ")}
            </small>
            <details className="tool-catalog">
              <summary>
                {state.connector.state === "ready"
                  ? `${state.connector.toolCount} discovered tools`
                  : `${PHASE_2_CURATED_TOOLS.length} configured tools`}
              </summary>
              <p>
                {state.connector.state === "ready"
                  ? "Discovered through the Salesforce MCP portal and filtered by the host allowlist."
                  : "The host allowlist that will be matched against the Salesforce MCP catalog after connection."}
              </p>
              <ul>
                {PHASE_2_CURATED_TOOLS.map((tool) => (
                  <li key={tool}>
                    <code>{tool}</code>
                  </li>
                ))}
              </ul>
            </details>
            {state.connector.state === "authenticating" && state.connector.authUrl && (
              <a href={state.connector.authUrl}>Resume authorization</a>
            )}
            {state.connector.state === "ready" ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void disconnectSalesforce()}
                disabled={connectorBusy}
              >
                {connectorBusy ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : state.connector.state !== "not-configured" ? (
              <div className="connector-actions">
                <button
                  type="button"
                  onClick={() => void connectSalesforce()}
                  disabled={connectorBusy}
                >
                  {connectorBusy
                    ? "Connecting…"
                    : state.connector.state === "disconnected"
                      ? "Connect"
                      : "Reconnect"}
                </button>
                {state.connector.state === "authenticating" && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void loadConnector()}
                  >
                    Check status
                  </button>
                )}
              </div>
            ) : null}
          </section>
          <div className="rail-footer">
            <span>Guided demo</span>
            <small>Fictional sample data</small>
          </div>
        </nav>
        {view === "evaluations" && <EvaluationView onClose={() => setView("chat")} />}
        {view === "learn" && (
          <LearnView
            onClose={() => setView("chat")}
            onTryPrompt={(prompt) => {
              setInput(prompt);
              setView("chat");
            }}
            onOpenView={setView}
          />
        )}
        {view === "graph" && <GraphView onClose={() => setView("chat")} />}
        {view === "journeys" && (
          <JourneysView
            onClose={() => setView("chat")}
            onOpenArchitecture={() => setView("architecture")}
          />
        )}
        {view === "architecture" && (
          <ArchitectureView
            onClose={() => setView("chat")}
            onOpenJourneys={() => setView("journeys")}
          />
        )}
        {view === "usecases" && (
          <UseCasesView
            onClose={() => setView("chat")}
            onTryPrompt={(prompt) => {
              setInput(prompt);
              setView("chat");
            }}
          />
        )}
        {view === "history" && (
          <HistoryView
            refreshKey={busy ? -1 : messages.length}
            onClose={() => setView("chat")}
            focusTitle={
              state.workingSet.focus ? currentFocusVersion(state.workingSet.focus).title : undefined
            }
          />
        )}
        <section className="conversation" aria-labelledby="chat-title" hidden={view !== "chat"}>
          <div className="section-header">
            <div>
              <p className="kicker">Orchestrator</p>
              <h2 id="chat-title">Campaign intelligence</h2>
            </div>
            <div className="chat-actions">
              <button type="button" className="text-button" onClick={() => startNewChat()}>
                New chat
              </button>
              <button type="button" className="text-button" onClick={() => setView("history")}>
                History
              </button>
              <button
                type="button"
                className="text-button compact-nav"
                onClick={() => setView("evaluations")}
              >
                Evaluations
              </button>
              <button
                type="button"
                className="text-button compact-nav"
                onClick={() => setView("learn")}
              >
                Learn
              </button>
              <button
                type="button"
                className="text-button compact-nav"
                onClick={() => setView("graph")}
              >
                Graph
              </button>
              <button
                type="button"
                className="quickstart-button"
                onClick={() => setView("usecases")}
              >
                Use cases
              </button>
              <span className="agent-badge">
                <i />
                Agent online
              </span>
            </div>
          </div>
          <div className="messages" aria-live="polite">
            <article className="message assistant">
              <div className="message-author">Northstar orchestrator</div>
              <p>
                Explore the fictional Northstar campaign with governed Salesforce data. I can
                summarize context, draft content, check readiness, and prepare a review task for
                your confirmation. Nothing is published or sent.
              </p>
            </article>
            {messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-author">
                  {message.role === "user" ? "You" : "Northstar orchestrator"}
                </div>
                {message.role === "assistant" && (
                  <ToolActivity
                    message={message}
                    live={busy && message.id === messages.at(-1)?.id}
                  />
                )}
                {message.role === "assistant" ? (
                  <Markdown text={unwrapAssistantText(rawMessageText(message))} />
                ) : (
                  <p>{messageText(message)}</p>
                )}
                {message.role === "assistant" && <SalesforceAgentsPanel message={message} />}
                {message.role === "assistant" && <GraphEvidencePanel message={message} />}
                {message.role === "assistant" && (
                  <TechnicalTrace
                    rows={executionTrace(message)}
                    live={busy && message.id === messages.at(-1)?.id}
                  />
                )}
              </article>
            ))}
            {busy && (
              <section className="live-trace" aria-live="polite">
                <div className="trace-pulse" />
                <div className="live-trace-detail">
                  <strong>Northstar orchestrator is working</strong>
                  <span className="live-trace-copy">
                    Tool selection and Salesforce agent calls will appear in the trace.
                  </span>
                </div>
              </section>
            )}
            {isRecovering && (
              <div className="recovery" role="status">
                Recovering the durable conversation…
              </div>
            )}
            {showChatError && (
              <div className="error-banner" role="alert">
                The turn was interrupted. Your saved conversation is still available; retry when
                ready.
              </div>
            )}
            {actionError && (
              <div className="error-banner" role="alert">
                {actionError}
              </div>
            )}
            {createdRecord && (
              <section className="success-banner" role="status">
                <div>
                  <strong>{createdRecord.subject}</strong>
                  <span>{` · ${createdRecord.priority} priority · due ${createdRecord.dueDate}`}</span>
                </div>
                <a
                  href={salesforceRecordUrl(createdRecord.objectApiName, createdRecord.recordId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open task in Salesforce <span aria-hidden="true">↗</span>
                </a>
                <details className="write-trace">
                  <summary>Inspect confirmed Salesforce execution</summary>
                  <ol>
                    <li>Orchestrator verified same-user, unexpired confirmation.</li>
                    <li>Salesforce MCP invoked create_campaign_review_request.</li>
                    <li>Apex created one Task with Campaign in the native Related To field.</li>
                    <li>Salesforce returned authoritative Task fields and relationship.</li>
                  </ol>
                  <pre>
                    {JSON.stringify(
                      {
                        request: {
                          action: "create-review-task",
                          campaignId: createdRecord.campaignId,
                          confirmation: "[redacted]",
                          idempotencyKey: "[redacted]",
                        },
                        response: {
                          taskId: createdRecord.recordId,
                          relatedToCampaignId: createdRecord.campaignId,
                          subject: createdRecord.subject,
                          status: createdRecord.status,
                          priority: createdRecord.priority,
                          dueDate: createdRecord.dueDate,
                          readBack: true,
                        },
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </section>
            )}
            {!pendingConfirmation && !preparing && (
              <WriteProgress progress={state.writeProgress} running={false} />
            )}
            {openedCase && (
              <section className="success-banner" role="status">
                <div>
                  <strong>
                    Case {openedCase.caseNumber} opened for {openedCase.contactName}
                  </strong>
                  <span>{` · ${openedCase.subject} · ${openedCase.priority} priority`}</span>
                  <small className="saved-agent">
                    create_inventory_case · Apex verified the signed confirmation and the case
                    contents · read back from{" "}
                    {openedCase.source === "salesforce" ? "Salesforce" : "the local fixture"}
                  </small>
                </div>
                <a
                  href={salesforceRecordUrl("Case", openedCase.recordId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open case in Salesforce <span aria-hidden="true">↗</span>
                </a>
              </section>
            )}
            {savedRecord && (
              <section className="success-banner" role="status">
                <div>
                  <strong>{savedRecord.label}</strong>
                  <span>{` · ${savedRecord.title}`}</span>
                  <small className="saved-agent">
                    By the {savedRecord.agent} agent · {savedRecord.actions.join(" → ")} · read back
                    from Salesforce{savedRecord.note ? ` · ${savedRecord.note}` : ""}
                  </small>
                </div>
                <a
                  href={salesforceRecordUrl(savedRecord.objectType, savedRecord.recordId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Salesforce <span aria-hidden="true">↗</span>
                </a>
              </section>
            )}
            {attachedImage && (
              <section className="success-banner" role="status">
                <div>
                  <strong>Image attached to the campaign</strong>
                  <span>{` · ${attachedImage.title} · ${Math.round(attachedImage.contentSize / 1024)} KB`}</span>
                </div>
                <a
                  href={salesforceRecordUrl("ContentDocument", attachedImage.contentDocumentId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open file in Salesforce <span aria-hidden="true">↗</span>
                </a>
                <details className="write-trace">
                  <summary>Inspect confirmed Salesforce execution</summary>
                  <ol>
                    <li>Orchestrator verified same-user, unexpired confirmation.</li>
                    <li>Orchestrator re-checked the stored image against the confirmed hash.</li>
                    <li>Salesforce MCP invoked attach_campaign_image.</li>
                    <li>Apex verified the hash and created one file linked to the Campaign.</li>
                    <li>
                      Salesforce returned the file, its stored checksum, and the Campaign link.
                    </li>
                  </ol>
                  <pre>
                    {JSON.stringify(
                      {
                        request: {
                          action: "attach-generated-image",
                          campaignId: attachedImage.campaignId,
                          contentHash: attachedImage.contentHash,
                          confirmation: "[redacted]",
                          idempotencyKey: "[redacted]",
                        },
                        response: {
                          contentDocumentId: attachedImage.contentDocumentId,
                          contentVersionId: attachedImage.contentVersionId,
                          linkedCampaignId: attachedImage.campaignId,
                          title: attachedImage.title,
                          contentSize: attachedImage.contentSize,
                          readBack: true,
                        },
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </section>
            )}
            {!pendingConfirmation && (
              <ActionCards
                suggestions={state.suggestions ?? []}
                preparing={preparing}
                onAccept={(id) => void acceptSuggestion(id)}
                onDismiss={(id) => void dismissSuggestion(id)}
              />
            )}
            {!pendingConfirmation && preparing && (
              <WriteProgress
                running
                phase="prepare"
                progress={state.writeProgress?.phase === "prepare" ? state.writeProgress : null}
              />
            )}
            {pendingConfirmation && (
              <section
                ref={confirmationRef}
                className="confirmation-card"
                aria-labelledby="confirmation-title"
              >
                <p className="kicker">Confirmation required</p>
                <h3 id="confirmation-title">
                  {CONFIRMATION_COPY[pendingConfirmation.action].title}
                </h3>
                <p className="confirmation-summary">{pendingConfirmation.summary}</p>
                <MarketingWriteDetails confirmation={pendingConfirmation} />
                <InventoryCaseDetails confirmation={pendingConfirmation} />
                {pendingConfirmation.action === "attach-generated-image" &&
                  generatedImage &&
                  generatedImage.id === pendingConfirmation.imageId && (
                    <img
                      className="confirmation-image"
                      src={generatedImage.imageUrl}
                      alt={`Draft to attach: ${generatedImage.promptSummary}`}
                    />
                  )}
                <dl>
                  {pendingConfirmation.focus && (
                    <div className="confirmation-detail">
                      <dt>Draft</dt>
                      <dd>
                        {pendingConfirmation.focus.title} · version{" "}
                        {pendingConfirmation.focus.version}
                      </dd>
                    </div>
                  )}
                  {!pendingConfirmation.write && !pendingConfirmation.inventoryCase && (
                    <div className="confirmation-detail">
                      <dt>Campaign</dt>
                      <dd>
                        <a
                          href={salesforceRecordUrl("Campaign", pendingConfirmation.recordId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {pendingConfirmation.recordId} <span aria-hidden="true">↗</span>
                        </a>
                      </dd>
                    </div>
                  )}
                  {pendingConfirmation.contentHash && (
                    <div className="confirmation-detail">
                      <dt>Image hash</dt>
                      <dd>
                        <code>{pendingConfirmation.contentHash.slice(0, 16)}…</code>
                      </dd>
                    </div>
                  )}
                  <div className="confirmation-detail">
                    <dt>Expires</dt>
                    <dd>{new Date(pendingConfirmation.expiresAt).toLocaleTimeString()}</dd>
                  </div>
                </dl>
                <PermissionDetails confirmation={pendingConfirmation} />
                {executing && (
                  <WriteProgress
                    running
                    progress={
                      state.writeProgress?.confirmationId === pendingConfirmation.id
                        ? state.writeProgress
                        : null
                    }
                  />
                )}
                <div className="confirmation-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={executing}
                    onClick={() => void resolveConfirmation("deny")}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="confirm-button"
                    disabled={executing}
                    aria-busy={executing}
                    onClick={() => void resolveConfirmation("execute")}
                  >
                    {executing ? "Working…" : CONFIRMATION_COPY[pendingConfirmation.action].confirm}
                  </button>
                </div>
              </section>
            )}
          </div>
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              const text = input.trim();
              if (!text || busy || resetting) return;
              void sendMessage({ text }, { body: { scope } });
              setInput("");
            }}
          >
            <label htmlFor="prompt" className="sr-only">
              Message the orchestrator
            </label>
            <div className="composer-row">
              <textarea
                id="prompt"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={BRAND_PLACEHOLDER[scope.brand]}
                rows={3}
              />
              {busy ? (
                <button type="button" className="send" onClick={() => stop()}>
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="send"
                  disabled={!input.trim() || resetting}
                  aria-label="Send message"
                >
                  <span aria-hidden="true">↑</span>
                </button>
              )}
            </div>
            <div className="composer-footer">
              <span>Fictional data · Confirm before writes · No publish actions</span>
            </div>
          </form>
        </section>
        <aside className="insights" aria-labelledby="insights-title" hidden={view !== "chat"}>
          <div className="section-header">
            <div>
              <p className="kicker">This chat</p>
              <h2 id="insights-title">Workspace</h2>
            </div>
            <span className="count">
              {state.workingSet.records.length + state.workingSet.cards.length}
            </span>
          </div>
          {!operations.writesEnabled && (
            <div className="operations-notice" role="status">
              Salesforce writes are paused by an operator. Reading and drafting still work; nothing
              can be saved, created, or attached until writes are resumed.
            </div>
          )}
          <WorkspacePanel workingSet={state.workingSet} />
          <details className="image-workflow-toggle">
            <summary>
              <span className="kicker">External creative workflow</span>
              <span className="image-workflow-summary">Generate campaign visual</span>
            </summary>
            <section className="image-workflow" aria-labelledby="image-workflow-title">
              <div>
                <h3 id="image-workflow-title" className="sr-only">
                  Generate campaign visual
                </h3>
                <p>
                  {openCampaign
                    ? `For ${openCampaign.title}. Workers AI creates a private seven-day draft; nothing is attached or published.`
                    : "Open a campaign in the chat to create a visual for it. Drafts stay private for seven days."}
                </p>
              </div>
              <label htmlFor="image-concept">Creative concept</label>
              <textarea
                id="image-concept"
                rows={3}
                maxLength={280}
                value={imageConcept}
                onChange={(event) => setImageConcept(event.target.value)}
              />
              <button
                type="button"
                onClick={() => void generateCampaignImage()}
                disabled={!openCampaign || imageBusy || imageConcept.trim().length < 8}
              >
                {imageBusy ? "Generating…" : "Generate draft"}
              </button>
              {(imageBusy || generatedImage) && (
                <ol className="image-trace" aria-label="Image generation progress">
                  <li className={imageBusy ? "active" : "complete"}>
                    Orchestrator bounded the prompt
                  </li>
                  <li className={imageBusy ? "active" : "complete"}>
                    Workers AI generated a 1024×1024 PNG
                  </li>
                  <li className={imageBusy ? "pending" : "complete"}>
                    R2 stored the private draft and D1 provenance
                  </li>
                </ol>
              )}
              {images.length > 1 && (
                <fieldset className="variant-gallery">
                  <legend>{`Variants (${images.length})`}</legend>
                  {images.map((image, index) => (
                    <button
                      type="button"
                      key={image.id}
                      className={`variant-thumb lifecycle-${image.lifecycle}`}
                      aria-pressed={image.id === generatedImage?.id}
                      aria-label={`Variant ${images.length - index}: ${image.promptSummary} (${image.lifecycle})`}
                      onClick={() => setSelectedImageId(image.id)}
                    >
                      <img src={image.imageUrl} alt="" />
                      <span className="variant-label">
                        {image.lifecycle === "draft"
                          ? `#${images.length - index}`
                          : image.lifecycle}
                      </span>
                    </button>
                  ))}
                </fieldset>
              )}
              {generatedImage && (
                <figure className="generated-image-card">
                  <img src={generatedImage.imageUrl} alt="Generated Northstar campaign draft" />
                  <figcaption>
                    <strong>
                      {generatedImage.lifecycle === "attached"
                        ? "Attached to the campaign"
                        : generatedImage.lifecycle === "rejected"
                          ? "Rejected variant"
                          : "Reviewable draft"}
                    </strong>
                    <span className="generated-image-summary">{generatedImage.promptSummary}</span>
                    <small className="generated-image-metadata">
                      {generatedImage.width}×{generatedImage.height} ·{" "}
                      {generatedImage.lifecycle === "attached"
                        ? "Salesforce holds the attached file; this draft copy expires in seven days"
                        : "expires in seven days · not attached to Salesforce"}
                    </small>
                    {generatedImage.lifecycle === "draft" && (
                      <button
                        type="button"
                        className="secondary-button attach-image-button"
                        onClick={() => void requestImageAttachment()}
                        aria-busy={preparing === "image"}
                        disabled={
                          pendingConfirmation !== null ||
                          preparing !== null ||
                          writeBlock("attach-generated-image") !== null
                        }
                      >
                        {preparing === "image" ? "Preparing…" : "Attach to campaign"}
                      </button>
                    )}
                    {generatedImage.lifecycle === "draft" && (
                      <button
                        type="button"
                        className="text-button reject-image-button"
                        onClick={() => void rejectImage(generatedImage.id)}
                        disabled={pendingConfirmation?.imageId === generatedImage.id}
                      >
                        Reject variant
                      </button>
                    )}
                    <details className="payload-viewer image-payload">
                      <summary>Technical payload and provenance</summary>
                      <pre>
                        {JSON.stringify(
                          {
                            provider: "Cloudflare Workers AI binding",
                            model: generatedImage.model,
                            input: {
                              campaignId: generatedImage.campaignId,
                              channel: generatedImage.channel,
                              concept: generatedImage.promptSummary,
                              width: generatedImage.width,
                              height: generatedImage.height,
                            },
                            output: {
                              imageId: generatedImage.id,
                              contentHash: generatedImage.contentHash,
                              lifecycle: generatedImage.lifecycle,
                              authorizedAssetUrl: generatedImage.imageUrl,
                              expiresAt: generatedImage.expiresAt,
                            },
                            storage: ["R2 private object", "D1 provenance row"],
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </figcaption>
                </figure>
              )}
            </section>
          </details>
          <section className="activity">
            <h3>Activity</h3>
            {state.activity.length === 0 && (
              <p className="activity-empty">Confirmed actions in this chat appear here.</p>
            )}
            {state.activity.map((item) => (
              <div className="activity-row" key={item.id}>
                <i />
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </div>
                <time>{item.occurredAt}</time>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </main>
  );
}
