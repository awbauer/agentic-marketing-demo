import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteMapPanel } from "./RouteMapPanel";
import { routeMap } from "./turn-route";

afterEach(cleanup);

describe("the route map", () => {
  it("says where the turn is in words, not only with colour", () => {
    const { container } = render(
      <RouteMapPanel route={routeMap(null, { surface: "browser", live: true })} />,
    );
    expect(container.querySelector(".route-map.live")).not.toBeNull();
    const summary = screen.getByText("The policy router is reading the request");
    expect(summary.getAttribute("aria-live")).toBe("polite");
    const router = container.querySelector('[data-node="router"].active') as HTMLElement;
    expect(within(router).getByText(": working now")).toBeTruthy();
  });

  it("shows the Apex relay only for a turn sent from Lightning", () => {
    const { container, rerender } = render(
      <RouteMapPanel route={routeMap(null, { surface: "lightning", live: false })} />,
    );
    expect(container.querySelector('[data-node="relay"]')).not.toBeNull();
    rerender(<RouteMapPanel route={routeMap(null, { surface: "browser", live: false })} />);
    expect(container.querySelector('[data-node="relay"]')).toBeNull();
  });
});
