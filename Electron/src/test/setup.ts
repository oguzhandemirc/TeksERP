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

// jsdom (Node 22+ altında) `localStorage` SAĞLAMAZ — Node'un kendi deneysel
// localStorage'ı `--localstorage-file` olmadan `undefined` döner ve jsdom'unkini
// gölgeler. zustand `persist` deposu bu yüzden `undefined` olur ve store'a yazan
// HER test "Cannot read properties of undefined (reading 'setItem')" ile düşer
// (2026-09-05: sekme defteri persist'e alınınca 4 bekçi bu yüzden kırmızıydı).
// Bellek-içi stub davranışı değiştirmez: gerçek renderer'da Chromium'un
// localStorage'ı vardır; testte kalıcılık zaten istenmez ve dosyalar arası
// sızıntı olmaması TERCİH EDİLİR.
if (typeof globalThis.localStorage === "undefined") {
  const mem = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return mem.size;
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    writable: true,
    configurable: true,
    value: stub,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    writable: true,
    configurable: true,
    value: stub,
  });
}

// jsdom'un `AbortSignal`'i ile global `Request` (Node/undici) AYRI SINIFLARDIR:
// undici marka kontrolünü kendi sınıfıyla yapar ve jsdom sinyali gelince
// "RequestInit: Expected signal to be an instance of AbortSignal" fırlatır.
// react-router her gezinmede `new Request(url, { signal })` kurar → gezinme
// SESSİZCE iptal olur ve test "yol değişmedi" der (2026-09-05: PageHeader geri
// oku bekçisinin 3 testi bu yüzden kırmızıydı; kod doğruydu).
// Çözüm: yalnız uyumsuzluk ÖLÇÜLDÜYSE sinyali düşüren ince bir sarmalayıcı.
// İptal semantiği bu bekçilerde ölçülmüyor; gerçek Chromium'da tek sınıf var.
{
  const OriginalRequest = globalThis.Request;
  let signalRejected = false;
  try {
    new OriginalRequest("http://localhost/__probe", { signal: new AbortController().signal });
  } catch {
    signalRejected = true;
  }
  if (signalRejected) {
    class TestRequest extends OriginalRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        if (init?.signal) {
          const { signal: _signal, ...rest } = init;
          super(input, rest);
          return;
        }
        super(input, init);
      }
    }
    Object.defineProperty(globalThis, "Request", {
      writable: true,
      configurable: true,
      value: TestRequest,
    });
  }
}

afterEach(() => {
  cleanup();
});
