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

// jsdom ResizeObserver da sağlamaz — cmdk (komut paleti) liste yüksekliğini
// ölçmek için mount'ta bir tane kurar ve yoksa render "ResizeObserver is not
// defined" ile düşer. No-op stub davranışı değiştirmez (ölçüm yalnız CSS
// değişkeni yazar), yalnız jsdom boşluğunu kapatır.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
}

// jsdom Pointer Events API'sini uygulamaz; Radix Select/DropdownMenu trigger'ı
// pointerdown'da hasPointerCapture çağırır ve test "target.hasPointerCapture is not
// a function" ile patlar. Ayrıca açılan liste seçili öğeye scrollIntoView yapar.
// No-op stub'lar davranışı değiştirmez, yalnız jsdom boşluğunu kapatır.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
});
