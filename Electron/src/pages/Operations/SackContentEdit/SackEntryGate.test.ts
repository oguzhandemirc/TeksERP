// =============================================================================
// Bekçi: Paketleme/Çuvallar GİRİŞ KAPISI (2026-09-04)
//   §1 Kapı yalnız "çıplak" girişte çizilir — hedefle açılan ekranda ÇİZİLMEZ
//      (scan-anywhere seed'i kaybolmasın: kapı öne konsaydı `useScanSeed`
//      SacksListView mount olana kadar koşmazdı).
//   §2 Kapı seçimi URL süzgecine doğru çevrilir; müşterisiz kovası sentinel'e.
// =============================================================================
import { describe, expect, it } from "vitest";
import { customerFilterValue, shouldShowEntryGate } from "./SackEntryGate";
import { CUSTOMERLESS_FILTER_VALUE } from "./types";

const sp = (q = "") => new URLSearchParams(q);

describe("shouldShowEntryGate — §1", () => {
  it("çıplak giriş → kapı çizilir", () => {
    expect(shouldShowEntryGate(null, sp())).toBe(true);
    expect(shouldShowEntryGate({}, sp())).toBe(true);
    // Filtre OLMAYAN URL anahtarları kapıyı kapatmaz (sıralama/sayfa boyu).
    expect(shouldShowEntryGate(null, sp("sortBy=sackNo&pageSize=50"))).toBe(true);
  });

  it("⭐ scan-anywhere seed'i varsa kapı ÇİZİLMEZ (üç anahtarın hepsi)", () => {
    expect(shouldShowEntryGate({ scanCode: "CV2509040001" }, sp())).toBe(false);
    expect(shouldShowEntryGate({ focusBarcode: "R123" }, sp())).toBe(false);
    expect(shouldShowEntryGate({ scanCodeDispatched: "CV1" }, sp())).toBe(false);
  });

  it("seed anahtarı string DEĞİLSE kapı kapanmaz (boş state ile aynı)", () => {
    expect(shouldShowEntryGate({ scanCode: 42 }, sp())).toBe(true);
    expect(shouldShowEntryGate({ scanCode: null }, sp())).toBe(true);
  });

  it("arama ya da herhangi bir filtre ile açılan ekranda kapı ÇİZİLMEZ", () => {
    expect(shouldShowEntryGate(null, sp("search=CV2509"))).toBe(false);
    expect(shouldShowEntryGate(null, sp("filter%5BcustomerId%5D=none"))).toBe(false);
    expect(shouldShowEntryGate(null, sp("filter%5Bscope%5D=DISPATCHED"))).toBe(false);
  });
});

describe("customerFilterValue — §2", () => {
  it("gerçek cari → id", () => {
    expect(
      customerFilterValue({ customerId: "abc", name: "X", code: null, sackCount: 1 }),
    ).toBe("abc");
  });

  it("⭐ müşterisiz kova → sentinel (küme sessizce kaybolmaz)", () => {
    expect(
      customerFilterValue({ customerId: null, name: "Müşterisiz (genel stok)", code: null, sackCount: 4 }),
    ).toBe(CUSTOMERLESS_FILTER_VALUE);
    expect(CUSTOMERLESS_FILTER_VALUE).toBe("none");
  });
});
