import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE, THEME_TRANSITION_ATTR, THEME_TRANSITION_MS, applyAppearance, beginThemeTransition } from "./appearance";

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
}

describe("görünüm renk geçişi penceresi", () => {
  let el: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    el = document.createElement("div");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("görünüm değişince öznitelik konur, süre sonunda kalkar", () => {
    applyAppearance(DEFAULT_APPEARANCE, el);
    applyAppearance({ ...DEFAULT_APPEARANCE, preset: "teal" }, el, { animate: true });
    expect(el.hasAttribute(THEME_TRANSITION_ATTR)).toBe(true);
    vi.advanceTimersByTime(THEME_TRANSITION_MS + 1);
    expect(el.hasAttribute(THEME_TRANSITION_ATTR)).toBe(false);
  });

  it("ilk uygulamada (animate yok) konmaz", () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, preset: "teal" }, el);
    expect(el.hasAttribute(THEME_TRANSITION_ATTR)).toBe(false);
  });

  it("değişim yoksa animate olsa da konmaz", () => {
    applyAppearance(DEFAULT_APPEARANCE, el);
    applyAppearance(DEFAULT_APPEARANCE, el, { animate: true });
    expect(el.hasAttribute(THEME_TRANSITION_ATTR)).toBe(false);
  });

  it("azaltılmış harekette konmaz", () => {
    mockReducedMotion(true);
    beginThemeTransition(el);
    expect(el.hasAttribute(THEME_TRANSITION_ATTR)).toBe(false);
  });
});
