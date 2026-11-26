import { afterEach, describe, expect, it } from "vitest";
import { cardPlacement } from "./IdCard";

const chip = (top: number) => ({ top, bottom: top + 20, left: 40 }) as DOMRect;
const setWindow = (height: number) =>
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
const original = window.innerHeight;

afterEach(() => setWindow(original));

describe("ID card placement", () => {
  it("caps a card taller than the window and lets it scroll inside", () => {
    setWindow(400);
    const style = cardPlacement(chip(100), { height: 900 });
    expect(style.maxHeight).toBe(384);
    expect(style.overflowY).toBe("auto");
    expect(style.top).toBe(8);
  });

  it("places a short card just under its chip", () => {
    setWindow(800);
    const style = cardPlacement(chip(100), { height: 200 });
    expect(style.top).toBe(124);
  });
});
