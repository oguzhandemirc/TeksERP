// =============================================================================
// Sevke hazır işler ayar satırları (D4-J1, 2026-10-30)
// =============================================================================
// Backend: `shipping.ready.rule` (ALL_DONE | METER_THRESHOLD, varsayılan ALL_DONE) ve
// `shipping.ready.tolerancePct` (0-20, varsayılan 2). Panel satırı backend sınırlarının ve
// varsayılanının AYNASIDIR; ayrışırsa panel geçerli değeri yazamaz ya da yanlış "Varsayılan"
// rozeti basar. Backend tarafı: `Teks-Erp/scripts/test_feature_flag_contract.ts` + `test_sevke_hazir.ts`.
// =============================================================================
import { describe, it, expect } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-config";
import { FLAG_MODULE } from "./flag-modules";
import { decodeEnumSet, encodeEnumSet, toggleEnumSet } from "./enum-set-codec";

const shipping = SETTINGS_CATEGORIES.find((c) => c.id === "shipping");

describe("Sevke hazır işler ayar satırları", () => {
  it("kural enum satırı: ALL_DONE varsayılan, iki seçenek, Sevke hazır işler grubunda", () => {
    const row = shipping?.enumFlags?.find((r) => r.enumKey === "shippingReadyRule");
    expect(row).toBeDefined();
    expect(row?.defaultValue).toBe("ALL_DONE");
    expect(row?.options.map((o) => o.value)).toEqual(["ALL_DONE", "METER_THRESHOLD"]);
    expect(row?.group).toBe("Sevke hazır işler");
  });

  it("tolerans sayı satırı: 0-20 %, varsayılan 2", () => {
    const row = shipping?.numberFlags?.find((r) => r.key === "shippingReadyTolerancePct");
    expect(row).toBeDefined();
    expect(row?.min).toBe(0);
    expect(row?.max).toBe(20);
    expect(row?.fallback).toBe(2);
    expect(row?.unit).toBe("%");
    expect(row?.group).toBe("Sevke hazır işler");
  });

  it("iki satır da çekirdek sevkiyata ait", () => {
    for (const k of ["shippingReadyRule", "shippingReadyTolerancePct"] as const) {
      expect(FLAG_MODULE[k]).toBe("cekirdek");
    }
  });
});

// D4-J2 (2026-10-31): bildirim birimleri (küme, backend dizi; varsayılan boş = kapalı) + tarama periyodu (1-60 dk, 5).

describe("Sevke hazır bildirimi ayar satırları (D4-J2)", () => {
  const units = shipping?.enumFlags?.find((r) => r.enumKey === "shippingReadyNotifyUnits");

  it("birim satırı: küme (checks), varsayılan boş, seçenekler backend kümesi IE·GB·PARTI", () => {
    expect(units?.display).toBe("checks");
    expect(units?.defaultValue).toBe("");
    expect(units?.options.map((o) => o.value)).toEqual(["IE", "GB", "PARTI"]);
    expect(units?.group).toBe("Sevke hazır işler");
  });

  it("periyot satırı: 1-60 dk, varsayılan 5", () => {
    const row = shipping?.numberFlags?.find((r) => r.key === "shippingReadyScanMinutes");
    expect([row?.min, row?.max, row?.fallback, row?.unit]).toEqual([1, 60, 5, "dk"]);
  });

  it("küme kodlayıcı: sunucu dizisi kanonik metne, metin diziye; tanınmayan eleman düşer", () => {
    const opts = units!.options;
    expect(encodeEnumSet(["PARTI", "IE", "XX"], opts)).toBe("IE,PARTI");
    expect(encodeEnumSet([], opts)).toBe("");
    expect(encodeEnumSet("PARTI", opts)).toBeNull();
    expect(decodeEnumSet("")).toEqual([]);
    expect(decodeEnumSet("IE,PARTI")).toEqual(["IE", "PARTI"]);
    expect(toggleEnumSet("PARTI", "IE", opts)).toBe("IE,PARTI");
    expect(toggleEnumSet("IE,PARTI", "IE", opts)).toBe("PARTI");
  });

  it("iki satır da çekirdek sevkiyata ait", () => {
    expect(FLAG_MODULE.shippingReadyNotifyUnits).toBe("cekirdek");
    expect(FLAG_MODULE.shippingReadyScanMinutes).toBe("cekirdek");
  });
});
