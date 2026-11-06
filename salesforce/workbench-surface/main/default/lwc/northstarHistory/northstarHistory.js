import { api, LightningElement } from "lwc";
import { request } from "c/northstarApi";

const ROUTE_LABELS = {
  model: "Model",
  "confirmation-required": "Needs confirmation",
  unsupported: "Blocked action",
  "catalog-unavailable": "Catalog unavailable",
  memory: "Memory",
  "local-fixture": "Local fixture",
};
const OUTCOME_LABELS = {
  completed: "Completed",
  aborted: "Stopped",
  "timed-out": "Timed out",
  failed: "Failed",
};
const FILTERS = [
  { label: "All", value: "all" },
  { label: "With issues", value: "issues" },
  { label: "Used tools", value: "tools" },
  { label: "Policy", value: "policy" },
];
const COLUMNS = [
  { label: "Started", fieldName: "started", initialWidth: 170 },
  { label: "Prompt", fieldName: "utterance", wrapText: true },
  { label: "Scope", fieldName: "scopeLabel", initialWidth: 190, wrapText: true },
  { label: "Route", fieldName: "routeLabel", initialWidth: 150 },
  { label: "Outcome", fieldName: "outcomeLabel", initialWidth: 110 },
  { label: "Time", fieldName: "seconds", initialWidth: 80 },
  { label: "Tools", fieldName: "toolCount", type: "number", initialWidth: 70 },
  { type: "button", initialWidth: 90, typeAttributes: { label: "Details", name: "details" } },
];

const hasIssue = (turn) =>
  turn.outcome !== "completed" ||
  turn.fallback ||
  turn.tools.some((tool) => tool.status === "error");
const pretty = (value) =>
  value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value, null, 2);

/** The last day of turns: how each was routed and what its tools were given and returned. */
export default class NorthstarHistory extends LightningElement {
  columns = COLUMNS;
  filters = FILTERS;
  filter = "all";
  turns = [];
  retentionHours = 24;
  selectedId = "";
  loading = false;
  _refreshKey = 0;

  @api
  get refreshKey() {
    return this._refreshKey;
  }
  set refreshKey(value) {
    this._refreshKey = value;
    this.load();
  }

  async load() {
    this.loading = true;
    try {
      const body = await request("history");
      this.turns = body.turns ?? [];
      this.retentionHours = body.retentionHours ?? 24;
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent("chaterror", { detail: { error }, bubbles: true, composed: true }),
      );
    } finally {
      this.loading = false;
    }
  }

  get rows() {
    return this.turns
      .filter((turn) => {
        if (this.filter === "issues") return hasIssue(turn);
        if (this.filter === "tools") return turn.tools.length > 0;
        if (this.filter === "policy") return turn.route !== "model";
        return true;
      })
      .map((turn) => ({
        id: turn.id,
        started: new Date(turn.startedAt).toLocaleString(),
        utterance: turn.utterance,
        scopeLabel: turn.scope ? `${turn.scope.brand} · ${turn.scope.persona}` : "—",
        routeLabel: ROUTE_LABELS[turn.route] ?? turn.route,
        outcomeLabel: OUTCOME_LABELS[turn.outcome] ?? turn.outcome,
        seconds: `${(turn.durationMs / 1000).toFixed(1)}s`,
        toolCount: turn.tools.length,
      }));
  }

  get empty() {
    return !this.loading && this.rows.length === 0;
  }

  get selected() {
    const turn = this.turns.find((item) => item.id === this.selectedId);
    if (!turn) return null;
    return {
      ...turn,
      tokens: `${turn.inputTokens} in, ${turn.outputTokens} out`,
      tools: turn.tools.map((tool) => ({
        ...tool,
        title: `${tool.toolName} · ${tool.status}`,
        inputText: pretty(tool.input),
        outputText: pretty(tool.error ?? tool.output),
      })),
    };
  }

  get hasSelectedTools() {
    return (this.selected?.tools ?? []).length > 0;
  }

  get retentionNote() {
    return `Turns are kept for ${this.retentionHours} hours, with credentials and personal data redacted.`;
  }

  handleFilter(event) {
    this.filter = event.detail.value;
    this.selectedId = "";
  }

  handleRow(event) {
    this.selectedId = event.detail.row.id;
  }

  handleRefresh() {
    this.load();
  }
}
