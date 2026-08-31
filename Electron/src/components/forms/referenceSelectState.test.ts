// =============================================================================
// BEKÇİ — pasif seçim sınıfı (ReferenceSelect ortak düzeltmesi)
// =============================================================================
// ⭐ ROZET KESİN BİLGİYE BAKAR (`isActive === false`), "listede yok"a DEĞİL:
//    liste 50 satırlık ve aramayla süzülü olduğu için "listede yok" ölçütü
//    aktif kayıtlarda sürekli yanlış alarm üretir ve rozeti işe yaramaz kılar.
// ⭐ "BİLMİYORUM" PASİF DEĞİLDİR: alanı taşımayan modelde rozet basılmaz.
// =============================================================================
import { describe, it, expect } from "vitest";
import {
  PASSIVE_HINT,
  PASSIVE_SUFFIX,
  decorateSelectedLabel,
  isPassiveRecord,
} from "./referenceSelectState";

describe("isPassiveRecord", () => {
  it("⭐ yalnız isActive === false pasiftir", () => {
    expect(isPassiveRecord({ id: "1", isActive: false })).toBe(true);
    expect(isPassiveRecord({ id: "1", isActive: true })).toBe(false);
  });

  it("⭐ alan yoksa / kayıt yüklenmediyse PASİF DEMEZ", () => {
    expect(isPassiveRecord({ id: "1" })).toBe(false);
    expect(isPassiveRecord(undefined)).toBe(false);
    expect(isPassiveRecord(null)).toBe(false);
  });

  it("string 'false' pasif SAYILMAZ (filtre değeri ile kolon karıştırılmasın)", () => {
    expect(isPassiveRecord({ id: "1", isActive: "false" })).toBe(false);
  });

  it("nesne olmayan değerde patlamaz", () => {
    expect(isPassiveRecord("x")).toBe(false);
    expect(isPassiveRecord(0)).toBe(false);
  });
});

describe("decorateSelectedLabel", () => {
  it("pasif kayıtta ad + ek basılır", () => {
    expect(decorateSelectedLabel("MUS-1 — ARZU", true)).toBe(`MUS-1 — ARZU${PASSIVE_SUFFIX}`);
  });

  it("aktif kayıtta ad AYNEN kalır (mevcut görünüm bayt-bayt)", () => {
    expect(decorateSelectedLabel("MUS-1 — ARZU", false)).toBe("MUS-1 — ARZU");
  });

  it("etiket henüz çözülmemişse dokunulmaz (yer tutucu bozulmasın)", () => {
    expect(decorateSelectedLabel(undefined, true)).toBeUndefined();
  });
});

describe("uyarı metni", () => {
  it("⭐ hatayı Kaydet'ten ÖNCE söyler ve çıkış yolu gösterir", () => {
    expect(PASSIVE_HINT).toMatch(/PASİF/);
    expect(PASSIVE_HINT).toMatch(/aktifleştirin|başka kayıt/);
  });
});
