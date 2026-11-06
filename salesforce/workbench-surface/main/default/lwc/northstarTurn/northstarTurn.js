import { api, LightningElement } from "lwc";
import { toHtml } from "c/northstarMarkdown";

const TOOL_STATES = {
  running: { iconName: "utility:spinner", label: "Waiting for a result", variant: "" },
  done: { iconName: "utility:success", label: "Result returned", variant: "success" },
  failed: {
    iconName: "utility:error",
    label: "Failed or returned nothing usable",
    variant: "error",
  },
};
const ROW_ICONS = {
  active: { iconName: "utility:spinner", variant: "" },
  complete: { iconName: "utility:success", variant: "success" },
  error: { iconName: "utility:error", variant: "error" },
};

/**
 * One message. An answer shows its tools while they run and a technical trace of every model and
 * tool event. The trace opens while the answer streams or when something failed, then stays as
 * the person left it: finishing the answer doesn't close it.
 */
export default class NorthstarTurn extends LightningElement {
  _message;
  traceOpen = false;
  openPayloads = new Set();
  /** Set once the person toggles the trace, so polling no longer moves it. */
  chosen = false;

  @api
  get message() {
    return this._message;
  }
  set message(value) {
    this._message = value;
    if (!this.chosen && (value.live || this.errorCount(value) > 0)) this.traceOpen = true;
  }

  errorCount(message) {
    return (message.trace ?? []).filter((row) => row.state === "error").length;
  }

  handleTraceToggle() {
    this.chosen = true;
    this.traceOpen = !this.traceOpen;
  }

  handlePayloadToggle(event) {
    const { key } = event.currentTarget.dataset;
    const next = new Set(this.openPayloads);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.openPayloads = next;
  }

  get isUser() {
    return this._message.role === "user";
  }

  get html() {
    return toHtml(this._message.text);
  }

  get hasText() {
    return Boolean(this._message.text);
  }

  get toolActivity() {
    if (!this._message.live) return [];
    return (this._message.toolCalls ?? []).map((call) => ({ ...call, ...TOOL_STATES[call.state] }));
  }

  get hasToolActivity() {
    return this.toolActivity.length > 0;
  }

  get hasTrace() {
    return (this._message.trace ?? []).length > 0;
  }

  get traceSummary() {
    const rows = this._message.trace ?? [];
    const errors = this.errorCount(this._message);
    return [
      `${rows.length} events`,
      ...(errors ? [`${errors} with issues`] : []),
      ...(this._message.live ? ["live"] : []),
    ].join(" · ");
  }

  get sectionClass() {
    return `slds-section slds-m-vertical_x-small${this.traceOpen ? " slds-is-open" : ""}`;
  }

  get ariaExpanded() {
    return String(this.traceOpen);
  }

  get rows() {
    return (this._message.trace ?? []).map((row) => {
      const open = this.openPayloads.has(row.key);
      return {
        ...row,
        ...ROW_ICONS[row.state],
        payloadOpen: open,
        payloadExpanded: String(open),
        payloadButton: `${open ? "Hide" : "Show"} ${(row.payloadLabel ?? "sanitized payload").toLowerCase()}`,
      };
    });
  }
}
