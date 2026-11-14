import { afterEach, describe, expect, it, vi } from "vitest";
import { keepInViewport } from "./keepInViewport";

function menuAt(left: number, width: number): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, bottom: 10, height: 10, x: left, y: 0, toJSON() {} }) as DOMRect;
  return element;
}

describe("keepInViewport", () => {
  afterEach(() => vi.restoreAllMocks());

  function windowWidth(width: number) {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(width);
  }

  it("slides a menu that opens past the left edge back into the window", () => {
    windowWidth(520);
    const menu = menuAt(-150, 384);
    keepInViewport(menu);
    expect(menu.style.translate).toBe("158px 0");
  });

  it("slides a menu that opens past the right edge back into the window", () => {
    windowWidth(520);
    const menu = menuAt(300, 384);
    keepInViewport(menu);
    expect(menu.style.translate).toBe("-172px 0");
  });

  it("leaves a menu that fits where it is", () => {
    windowWidth(1440);
    const menu = menuAt(900, 384);
    keepInViewport(menu);
    expect(menu.style.translate).toBe("");
  });

  it("prefers the left edge when the menu is wider than the window", () => {
    windowWidth(300);
    const menu = menuAt(-100, 400);
    keepInViewport(menu);
    expect(menu.style.translate).toBe("108px 0");
  });
});
