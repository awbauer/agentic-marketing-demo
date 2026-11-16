import { api, LightningElement } from "lwc";

/**
 * The components the latest turn has passed through, lit as it runs. The Worker builds the route
 * from the turn's trace with the browser's code, so this only draws it.
 */
export default class NorthstarRoute extends LightningElement {
  @api route;

  get panelClass() {
    return `panel${this.route.live ? " panel_live" : ""}`;
  }

  get lanes() {
    return this.route.lanes.map((lane) => ({
      ...lane,
      nodes: lane.nodes.map((node) => ({
        ...node,
        className: `node node_${node.state}${node.branch ? " node_branch" : ""}`,
      })),
    }));
  }
}
