// =============================================================================
// BEKÇİ — "Satış İade Faturası" düğmesi + iade satır kırılımı
// =============================================================================
// Kilitlenen iddialar:
//  ⭐ FABRİKADA HİÇ ÇIKMAZ (ticaret paketinin sıfır-fark kuralı).
//  ⭐ İPTAL EDİLMİŞ iadede çıkmaz — mal sevkiyatına geri döndü, ortada iade yok.
//  ⭐ ZATEN FATURALANMIŞ grupta çıkmaz — backend "bir iade grubu → tek aktif
//     fatura" diyor; düğmenin çıkması kullanıcıyı kesin bir 409'a yürütürdü.
//  ⭐ Satır = ÜRÜN kırılımı (top değil) ve sıra iade BELGESİYLE aynı.
// =============================================================================
import { describe, it, expect } from "vitest";
import {
  canDraftReturnInvoice,
  buildReturnInvoiceLines,
  returnProductLabel,
  type ReturnGroupMember,
} from "./returnInvoice";

const musteri = { id: "cust-1" };
const acik = { cancelledAt: null, customer: musteri };
const iptalli = { cancelledAt: "2026-08-14T09:00:00.000Z", customer: musteri };
const faturali = { cancelledAt: null, customer: musteri, invoiceDocNo: "SIF-2026-0001" };

describe("Satış iade faturası düğmesi görünürlüğü", () => {
  it("⭐ FABRİKADA (finance kapalı) hiçbir satırda çıkmaz", () => {
    expect(canDraftReturnInvoice(acik, false)).toBe(false);
    expect(canDraftReturnInvoice(iptalli, false)).toBe(false);
    expect(canDraftReturnInvoice(faturali, false)).toBe(false);
  });

  it("ticaret rejiminde aktif + faturasız iadede çıkar", () => {
    expect(canDraftReturnInvoice(acik, true)).toBe(true);
  });

  it("⭐ İPTAL EDİLMİŞ iadede çıkmaz (mal sevkiyatına geri döndü)", () => {
    expect(canDraftReturnInvoice(iptalli, true)).toBe(false);
  });

  it("⭐ zaten faturalanmış grupta çıkmaz (tek aktif fatura kuralı)", () => {
    expect(canDraftReturnInvoice(faturali, true)).toBe(false);
  });

  it("boş string belge no 'faturalanmamış' sayılır", () => {
    // Fatura iptal edilince bağ düşer; boş string yine de "numara yok" demektir
    // ve düğme çıkmalı (aksi halde grup sonsuza dek faturalanamaz görünürdü).
    expect(canDraftReturnInvoice({ ...acik, invoiceDocNo: "" }, true)).toBe(true);
  });

  it("müşterisi çözülemeyen kayıtta çıkmaz (carisiz fatura açılmaz)", () => {
    expect(canDraftReturnInvoice({ cancelledAt: null, customer: null }, true)).toBe(false);
  });
});

// -----------------------------------------------------------------------------

const uye = (p: Partial<ReturnGroupMember> & { createdAt: string }): ReturnGroupMember => ({
  qty: 10,
  width: 150,
  item: { id: "it-1", name: "PATOS" },
  color: { id: "cl-1", name: "GRİ" },
  ...p,
});

describe("İade satır kırılımı", () => {
  it("⭐ aynı ürün+renk+en'deki TOPLAR tek satırda toplanır (top başına satır yok)", () => {
    const lines = buildReturnInvoiceLines([
      uye({ createdAt: "2026-08-14T10:00:00.000Z", qty: 48.5 }),
      uye({ createdAt: "2026-08-14T10:00:01.000Z", qty: 51.25 }),
      uye({ createdAt: "2026-08-14T10:00:02.000Z", qty: 100 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty).toBe(199.75);
    expect(lines[0]!.description).toBe("PATOS GRİ 150cm.");
    expect(lines[0]!.unit).toBe("m");
    expect(lines[0]!.itemId).toBe("it-1");
  });

  it("farklı renk / farklı en AYRI satırdır", () => {
    const lines = buildReturnInvoiceLines([
      uye({ createdAt: "2026-08-14T10:00:00.000Z" }),
      uye({ createdAt: "2026-08-14T10:00:01.000Z", color: { id: "cl-2", name: "LACİVERT" } }),
      uye({ createdAt: "2026-08-14T10:00:02.000Z", width: 220 }),
    ]);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.description)).toEqual([
      "PATOS GRİ 150cm.",
      "PATOS LACİVERT 150cm.",
      "PATOS GRİ 220cm.",
    ]);
  });

  it("⭐ AYNI ADLI iki katalog kaydı KARIŞMAZ — anahtar kimliktir, ad değil", () => {
    const lines = buildReturnInvoiceLines([
      uye({ createdAt: "2026-08-14T10:00:00.000Z", qty: 10 }),
      uye({ createdAt: "2026-08-14T10:00:01.000Z", qty: 20, item: { id: "it-2", name: "PATOS" } }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.itemId)).toEqual(["it-1", "it-2"]);
  });

  it("⭐ sıra createdAt ARTAN — liste yeniden-eskiye dönse de belge sırası korunur", () => {
    const lines = buildReturnInvoiceLines([
      uye({ createdAt: "2026-08-14T10:00:05.000Z", item: { id: "it-9", name: "SON" } }),
      uye({ createdAt: "2026-08-14T10:00:01.000Z", item: { id: "it-1", name: "ILK" } }),
    ]);
    expect(lines.map((l) => l.itemId)).toEqual(["it-1", "it-9"]);
  });

  it("metraj Decimal(12,3) hassasiyetine yuvarlanır (float artığı sızmaz)", () => {
    const lines = buildReturnInvoiceLines([
      uye({ createdAt: "2026-08-14T10:00:00.000Z", qty: 0.1 }),
      uye({ createdAt: "2026-08-14T10:00:01.000Z", qty: 0.2 }),
    ]);
    expect(lines[0]!.qty).toBe(0.3);
  });

  it("kumaşsız/renksiz/ensiz kayıt satırı boş açıklama üretmez", () => {
    const m = uye({ createdAt: "2026-08-14T10:00:00.000Z", item: null, color: null, width: null });
    expect(returnProductLabel(m)).toBe("Kumaş (tanımsız)");
    expect(buildReturnInvoiceLines([m])[0]!.itemId).toBeNull();
  });

  it("boş grup boş satır listesi döndürür", () => {
    expect(buildReturnInvoiceLines([])).toEqual([]);
  });
});
