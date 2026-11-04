import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TechnicalTrace } from "./TechnicalTrace";
import type { executionTrace } from "./turn-trace";

afterEach(cleanup);

const rows = [
  { key: "a", kind: "step", label: "Step 1 started", state: "complete" },
] as unknown as ReturnType<typeof executionTrace>;
const details = (container: HTMLElement) =>
  container.querySelector("details.execution-trace") as HTMLDetailsElement;

describe("the technical trace", () => {
  it("opens while the answer streams and stays open when it finishes", () => {
    const { container, rerender } = render(<TechnicalTrace rows={rows} live />);
    expect(details(container).open).toBe(true);
    rerender(<TechnicalTrace rows={rows} live={false} />);
    expect(details(container).open).toBe(true);
  });

  it("stays as the person leaves it", () => {
    const { container, rerender } = render(<TechnicalTrace rows={rows} live />);
    details(container).open = false;
    fireEvent(details(container), new Event("toggle"));
    rerender(<TechnicalTrace rows={rows} live={false} />);
    expect(details(container).open).toBe(false);
  });

  it("starts closed for an answer that finished cleanly before it was shown", () => {
    const { container } = render(<TechnicalTrace rows={rows} live={false} />);
    expect(details(container).open).toBe(false);
  });
});
