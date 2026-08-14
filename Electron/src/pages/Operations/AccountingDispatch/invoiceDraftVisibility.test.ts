// =============================================================================
// BEKÇİ — "Faturala (iç)" düğmesi görünürlüğü
// =============================================================================
// İki iddia:
//  ⭐ FABRİKADA HİÇ ÇIKMAZ (ticaret paketinin sıfır-fark kuralı).
//  ⭐ ZATEN FATURALANMIŞ sevkiyatta çıkmaz — backend "bir sevkiyat → tek aktif
//     fatura" diyor; düğmenin çıkması, kullanıcıyı kesin bir 409'a yürütürdü.
// =============================================================================
import { describe, it, expect } from "vitest";
import { canDraftInvoice } from "./invoiceDraftVisibility";

const acik = { invoiceNo: null };
const faturali = { invoiceNo: "FTR-2026-001" };

describe("İç fatura taslağı görünürlüğü", () => {
  it("⭐ FABRİKADA (finance kapalı) hiçbir satırda çıkmaz", () => {
    expect(canDraftInvoice(acik, false)).toBe(false);
    expect(canDraftInvoice(faturali, false)).toBe(false);
  });

  it("ticaret rejiminde faturasız satırda çıkar", () => {
    expect(canDraftInvoice(acik, true)).toBe(true);
  });

  it("⭐ zaten faturalanmış satırda çıkmaz (tek aktif fatura kuralı)", () => {
    expect(canDraftInvoice(faturali, true)).toBe(false);
  });

  it("boş string fatura no 'faturalanmamış' sayılır", () => {
    // Backend işareti kaldırırken alanı null'lar; boş string yine de
    // "numara yok" demektir ve düğme çıkmalı (aksi halde satır sonsuza dek
    // faturalanamaz görünürdü).
    expect(canDraftInvoice({ invoiceNo: "" }, true)).toBe(true);
  });
});
