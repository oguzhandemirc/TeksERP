// =============================================================================
// BEKÇİ — "Faturala (iç)" düğmesi görünürlüğü + iç fatura bağı
// =============================================================================
// Dört iddia:
//  ⭐ FABRİKADA HİÇ ÇIKMAZ (ticaret paketinin sıfır-fark kuralı).
//  ⭐ İÇ FATURASI OLAN satırda çıkmaz — backend "bir sevkiyat → tek aktif
//     fatura" diyor; düğmenin çıkması kullanıcıyı kesin bir 409'a yürütürdü.
//  ⭐ ÖLÇÜT `invoices` BAĞIDIR, `invoiceNo` DEĞİL: `invoiceNo` DIŞ muhasebe
//     programının izidir. Ona bakmak iki yönlü yanlıştı — taslak varken düğme
//     çıkıyor, dış numarası olan sevkiyatta iç faturalama yolu hiç görünmüyordu.
//  ⭐ İPTAL EDİLMİŞ fatura "faturalanmış" SAYILMAZ (storno sonrası yeniden
//     faturalanabilmeli).
// =============================================================================
import { describe, it, expect } from "vitest";
import { canDraftInvoice, internalInvoiceOf, invoiceLinkLabel } from "./invoiceDraftVisibility";

const acik = { invoiceNo: null, kind: "SHIPMENT" as const, invoices: [] };
const taslakli = {
  invoiceNo: null,
  kind: "SHIPMENT" as const,
  invoices: [{ id: "inv-1", docNo: "FTR1508260001", status: "DRAFT" as const }],
};
const onayli = {
  invoiceNo: "FTR1508260001",
  kind: "SHIPMENT" as const,
  invoices: [{ id: "inv-1", docNo: "FTR1508260001", status: "CONFIRMED" as const }],
};

describe("İç fatura taslağı görünürlüğü", () => {
  it("⭐ FABRİKADA (finance kapalı) hiçbir satırda çıkmaz", () => {
    expect(canDraftInvoice(acik, false)).toBe(false);
    expect(canDraftInvoice(taslakli, false)).toBe(false);
  });

  it("ticaret rejiminde faturasız satırda çıkar", () => {
    expect(canDraftInvoice(acik, true)).toBe(true);
  });

  it("⭐ İÇ TASLAK varken çıkmaz (aksi hâlde form doldurulur ve 409 yenir)", () => {
    expect(canDraftInvoice(taslakli, true)).toBe(false);
  });

  it("⭐ İÇ ONAYLI fatura varken de çıkmaz", () => {
    expect(canDraftInvoice(onayli, true)).toBe(false);
  });

  it("⭐ DIŞ fatura no (`invoiceNo`) düğmeyi ARTIK GİZLEMEZ — iç fatura ayrı iştir", () => {
    // Eski yüklem burada `false` döndürüyordu: dış muhasebeye numara işleyen
    // muhasebeci, aynı sevkiyat için iç fatura kesme yolunu tamamen kaybediyordu.
    expect(canDraftInvoice({ invoiceNo: "A-2026-77", kind: "SHIPMENT", invoices: [] }, true)).toBe(true);
  });

  it("⭐ İPTAL EDİLMİŞ fatura 'faturalanmış' saymaz (storno sonrası yeniden kesilebilir)", () => {
    const iptal = {
      invoiceNo: null,
      kind: "SHIPMENT" as const,
      invoices: [{ id: "inv-9", docNo: "FTR-9", status: "CANCELLED" as const }],
    };
    expect(internalInvoiceOf(iptal)).toBeNull();
    expect(canDraftInvoice(iptal, true)).toBe(true);
  });

  it("⭐ FASONDAN DOĞRUDAN SEVKTE çıkmaz — `Invoice.shipmentId` o tabloyu kabul etmez", () => {
    expect(canDraftInvoice({ invoiceNo: null, kind: "DIRECT", invoices: [] }, true)).toBe(false);
  });

  it("eski backend (`invoices` alanı YOK) bugünkü davranışı korur", () => {
    expect(canDraftInvoice({ invoiceNo: null, kind: "SHIPMENT" }, true)).toBe(true);
    expect(internalInvoiceOf({ kind: "SHIPMENT" })).toBeNull();
  });
});

describe("iç fatura bağı", () => {
  it("⭐ TASLAK ile ONAYLI ayrı kelimelerle söylenir (biri iş, diğeri kayıt)", () => {
    expect(invoiceLinkLabel(taslakli, true)).toBe("Taslağı aç");
    expect(invoiceLinkLabel(onayli, true)).toBe("Faturayı aç");
  });

  it("faturası olmayan satırda bağ YOK", () => {
    expect(invoiceLinkLabel(acik, true)).toBeNull();
  });

  it("⭐ fabrikada bağ HİÇ çizilmez (ön muhasebe modülü kapalı)", () => {
    expect(invoiceLinkLabel(taslakli, false)).toBeNull();
  });

  it("bağ hedefi faturanın kendi id'sidir", () => {
    expect(internalInvoiceOf(taslakli)?.id).toBe("inv-1");
  });
});
