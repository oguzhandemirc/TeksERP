// Vitest global setup — Testing Library jest-dom matcher'ları (toBeInTheDocument vb.)
// + vitest-axe a11y matcher'ı (toHaveNoViolations) + her testten sonra DOM temizliği.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";
import * as axeMatchers from "vitest-axe/matchers";

// a11y matcher'larını global expect'e kaydet → her *.a11y.test.tsx içinde hazır.
expect.extend(axeMatchers);

// jsdom IntersectionObserver sağlamaz — DataTable / useInfiniteScroll (sonsuz
// kaydırma sentinel'i) render'da bir tane kurar. No-op stub testlerin patlamasını
// önler (gerçek tetikleme Electron/Chromium'da gerçekleşir, testte gerekmez).
if (!("IntersectionObserver" in globalThis)) {
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: IntersectionObserverStub,
  });
}

afterEach(() => {
  cleanup();
});
