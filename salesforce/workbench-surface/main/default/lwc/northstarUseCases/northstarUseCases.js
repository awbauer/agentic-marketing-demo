import { api, LightningElement } from "lwc";

const TEAMS = ["All", "Marketing", "Sales", "Service", "Financial services", "Life sciences"];

const matches = (useCase, filter) =>
  filter === "All" || useCase.team === filter || useCase.industry === filter;

/** The use-case library: what each scenario is for, the prompts that drive it, and its systems. */
export default class NorthstarUseCases extends LightningElement {
  @api useCases = [];
  @api brand = "all";
  filter = "All";
  selectedId = "";

  get inScope() {
    return this.useCases.filter((useCase) => this.brand === "all" || useCase.brand === this.brand);
  }

  get filters() {
    const available = this.inScope.filter((useCase) => useCase.status === "available");
    return TEAMS.map((team) => ({
      team,
      label: `${team} (${available.filter((useCase) => matches(useCase, team)).length})`,
      variant: team === this.filter ? "brand" : "neutral",
    }));
  }

  get shown() {
    return this.inScope.filter((useCase) => matches(useCase, this.filter));
  }

  get selected() {
    const available = this.shown.filter((useCase) => useCase.status === "available");
    return available.find((useCase) => useCase.id === this.selectedId) ?? available[0] ?? null;
  }

  get cards() {
    const selectedId = this.selected?.id;
    return this.shown
      .filter((useCase) => useCase.status === "available")
      .map((useCase) => ({
        ...useCase,
        pressed: String(useCase.id === selectedId),
        cardClass: `slds-box slds-box_link slds-text-align_left card${useCase.id === selectedId ? " card-selected" : ""}`,
      }));
  }

  get comingSoon() {
    return this.shown.filter((useCase) => useCase.status === "coming-soon");
  }

  get hasComingSoon() {
    return this.comingSoon.length > 0;
  }

  get flowSteps() {
    return (this.selected?.flow ?? []).map((step, index) => ({ ...step, key: `${index}` }));
  }

  get brandNotice() {
    return this.brand === "all"
      ? ""
      : `Showing ${this.brand} use cases. Choose All brands to see every scenario.`;
  }

  handleFilter(event) {
    this.filter = event.currentTarget.dataset.team;
  }

  handleSelect(event) {
    this.selectedId = event.currentTarget.dataset.id;
  }

  handleTry(event) {
    this.dispatchEvent(
      new CustomEvent("try", { detail: { prompt: event.currentTarget.dataset.prompt } }),
    );
  }
}
