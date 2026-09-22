// =============================================================================
// Bekçi: Mükerrer onay modu — panel manuel top girişi (2026-09-22)
//   §1 Uyarı açıkken ana düğmeler "Yine de Kaydet"e döner ve `confirmDuplicate:true` taşır
//   §2 Uyarı kapalıyken normal etiketler, `confirmDuplicate:false` (tuzak hep devrede)
//   §3 Parmak izi sunucunun ikiz alanlarıyla aynı: itemId · colorId · initialQty · width
//   §4 Form parmak izinden sapınca uyarı DÜŞER (metraj değişti ⇒ artık aynı top iddiası yok)
//   §5 Aynı parmak izi ⇒ uyarı durur (renk null ↔ null eşit sayılır)
//   §6 Bekleme durumunda etiket "Ekleniyor...", mod korunur
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-22):
//   (a) `submitButtonView` uyarı modunda `confirmDuplicate:false` bıraktı -> §1 KIRMIZI
//   (b) `dupFingerprint` width'i düşürdü -> §4b KIRMIZI (en değişikliği uyarıyı düşürmedi)
// =============================================================================
import { describe, expect, it } from "vitest";
import { dupFingerprint, dupWarnStillValid, submitButtonView } from "./dupConfirm";

const base = { itemId: "it-1", colorId: "c-1", initialQty: 120.5, width: 150 };

describe("submitButtonView", () => {
  it("§1 uyarı açık ⇒ Yine de Kaydet + confirmDuplicate", () => {
    const v = submitButtonView(true, { add: false, addPrint: false });
    expect(v).toEqual({ confirmDuplicate: true, addLabel: "Yine de Kaydet", addPrintLabel: "Yine de Kaydet ve Bas", amber: true });
  });
  it("§2 uyarı kapalı ⇒ normal etiketler, tuzak devrede", () => {
    const v = submitButtonView(false, { add: false, addPrint: false });
    expect(v).toEqual({ confirmDuplicate: false, addLabel: "Ekle", addPrintLabel: "Ekle ve Etiket Bas", amber: false });
  });
  it("§6 beklerken 'Ekleniyor...' ve mod korunur", () => {
    expect(submitButtonView(true, { add: true, addPrint: false })).toMatchObject({ addLabel: "Ekleniyor...", addPrintLabel: "Yine de Kaydet ve Bas", confirmDuplicate: true, amber: true });
    expect(submitButtonView(false, { add: false, addPrint: true })).toMatchObject({ addLabel: "Ekle", addPrintLabel: "Ekleniyor...", confirmDuplicate: false });
  });
});

describe("dupFingerprint / dupWarnStillValid", () => {
  it("§3 dört alan, sıra sabit", () => {
    expect(dupFingerprint(base)).toBe("it-1|c-1|120.5|150");
    expect(dupFingerprint({ ...base, colorId: null, width: null })).toBe("it-1||120.5|");
  });
  it("§4 metraj değişti ⇒ uyarı düşer", () => {
    const warn = { barcode: "T1", fingerprint: dupFingerprint(base) };
    expect(dupWarnStillValid(warn, { ...base, initialQty: 121 })).toBe(false);
  });
  it("§4b en değişti ⇒ uyarı düşer", () => {
    const warn = { barcode: "T1", fingerprint: dupFingerprint(base) };
    expect(dupWarnStillValid(warn, { ...base, width: 160 })).toBe(false);
  });
  it("§5 aynı parmak izi ⇒ uyarı durur; uyarı yoksa false", () => {
    const warn = { barcode: "T1", fingerprint: dupFingerprint({ ...base, colorId: null }) };
    expect(dupWarnStillValid(warn, { ...base, colorId: null })).toBe(true);
    expect(dupWarnStillValid(null, base)).toBe(false);
  });
});
