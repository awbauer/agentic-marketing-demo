import { api, LightningElement } from "lwc";
import { request } from "c/northstarApi";

const POLL_MS = 900;
const POLL_FAILURE_LIMIT = 4;

const ACTION_LABELS = {
  "save-marketing-brief": "Save the marketing brief",
  "create-marketing-campaign": "Create the marketing campaign",
  "create-review-task": "Create the review task",
  "attach-generated-image": "Attach the generated image",
  "create-inventory-case": "Create the inventory case",
};

/** The conversation: runs a turn, polls its progress, and holds a write until a person decides. */
export default class NorthstarChat extends LightningElement {
  @api scope;
  @api placeholder;
  messages = [];
  live = null;
  active = false;
  loaded = false;
  prompt = "";
  confirmation = null;
  deciding = false;
  notice = "";
  failures = 0;

  @api
  get draft() {
    return this.prompt;
  }
  set draft(value) {
    if (value) this.prompt = value;
  }

  connectedCallback() {
    this.refresh();
  }

  disconnectedCallback() {
    window.clearTimeout(this.pollTimer);
  }

  report(error) {
    this.dispatchEvent(
      new CustomEvent("chaterror", { detail: { error }, bubbles: true, composed: true }),
    );
  }

  /** Reloads the settled transcript, and follows along if a turn is already running. */
  async refresh() {
    try {
      const snapshot = await request("messages");
      this.messages = snapshot.messages;
      this.confirmation = snapshot.confirmation;
      this.live = snapshot.message;
      this.active = snapshot.active;
      this.loaded = true;
      if (snapshot.active) this.schedulePoll();
    } catch (error) {
      this.report(error);
    }
  }

  schedulePoll() {
    window.clearTimeout(this.pollTimer);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.pollTimer = window.setTimeout(() => this.poll(), POLL_MS);
  }

  async poll() {
    try {
      const progress = await request("progress");
      this.failures = 0;
      this.live = progress.message ?? this.live;
      this.confirmation = progress.confirmation;
      if (progress.active) {
        this.schedulePoll();
        return;
      }
      this.active = false;
      await this.refresh();
      this.live = null;
      this.dispatchEvent(new CustomEvent("turnsettled"));
    } catch (error) {
      this.failures += 1;
      if (this.failures < POLL_FAILURE_LIMIT) {
        this.schedulePoll();
        return;
      }
      this.active = false;
      this.report(error);
    }
  }

  handlePrompt(event) {
    this.prompt = event.target.value;
  }

  handleKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.handleSend();
    }
  }

  async handleSend() {
    const text = this.prompt.trim();
    if (!text || this.active) return;
    this.prompt = "";
    this.notice = "";
    this.active = true;
    this.live = null;
    try {
      const { turnId } = await request("startTurn", { text, scope: this.scope });
      this.messages = [
        ...this.messages,
        { id: turnId, role: "user", text, toolCalls: [], trace: [], live: false },
      ];
      this.schedulePoll();
    } catch (error) {
      this.active = false;
      this.prompt = text;
      this.report(error);
    }
  }

  async handleStop() {
    try {
      await request("stopTurn");
    } catch (error) {
      this.report(error);
    }
  }

  async handleClear() {
    try {
      await request("clearChat");
      this.notice = "";
      await this.refresh();
    } catch (error) {
      this.report(error);
    }
  }

  async decide(operation, notice) {
    this.deciding = true;
    try {
      await request(operation);
      this.confirmation = null;
      this.notice = notice;
      await this.refresh();
    } catch (error) {
      this.report(error);
    } finally {
      this.deciding = false;
    }
  }

  handleConfirm() {
    this.decide("confirmWrite", "Salesforce completed the confirmed write.");
  }

  handleDecline() {
    this.decide("declineWrite", "Declined. Nothing was changed.");
  }

  get transcript() {
    return this.live ? [...this.messages, this.live] : this.messages;
  }

  get empty() {
    return this.loaded && this.transcript.length === 0 && !this.active;
  }

  get sendDisabled() {
    return this.active || !this.prompt.trim();
  }

  get clearDisabled() {
    return this.active || this.messages.length === 0;
  }

  get pendingConfirmation() {
    return this.confirmation?.status === "pending" ? this.confirmation : null;
  }

  get confirmationTitle() {
    return ACTION_LABELS[this.confirmation?.action] ?? "Confirm this write";
  }

  get confirmationExpiry() {
    return this.confirmation ? new Date(this.confirmation.expiresAt).toLocaleTimeString() : "";
  }

  get confirmDisabled() {
    return this.deciding || this.confirmation?.permitted === false;
  }

  get notPermitted() {
    return this.confirmation?.permitted === false;
  }
}
