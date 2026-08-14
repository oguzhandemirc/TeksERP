// =============================================================================
// BEKÇİ — mal kabul formundaki sipariş alanları
// =============================================================================
// İki iddia grubu:
//  ⭐ FABRİKADA HİÇ ÇIKMAZ (ticaret paketinin "sıfır görünür fark" kuralı) ve
//     yetkisiz kullanıcıya da çıkmaz.
//  ⭐ KUMAŞTA METRAJ ÖN DOLDURULMAZ. Doldurulsaydı 500 m bekleyen kalem, sisteme
//     500 metrelik TEK bir top olarak girerdi (gerçekte 5 top × ~100 m) —
//     barkod sayısı, kesim, sevk ve iade akışlarının tamamı yanlışlanır ve
//     hiçbir yerde hata çıkmazdı.
// =============================================================================
import { describe, it, expect } from "vitest";
import { describeFill, fillLinesFromOrder, showPurchaseOrderFields } from "./receiptOrderFields";
import type { FillSourceLine } from "./receiptOrderFields";

const kumas: FillSourceLine["item"] = {
  id: "item-kumas",
  name: "PATOS GRİ",
  unit: "MT",
  itemType: "FABRIC",
};
const iplik: FillSourceLine["item"] = {
  id: "item-iplik",
  name: "30/1 PENYE",
  unit: "KG",
  itemType: "YARN",
};

describe("showPurchaseOrderFields", () => {
  it("⭐ FABRİKADA (finance kapalı) çizilmez — yetki olsa bile", () => {
    expect(showPurchaseOrderFields({ financeEnabled: false, canReadPurchaseOrders: true })).toBe(false);
  });

  it("⭐ yetkisiz kullanıcıya çizilmez — rejim açık olsa bile", () => {
    expect(showPurchaseOrderFields({ financeEnabled: true, canReadPurchaseOrders: false })).toBe(false);
  });

  it("ticaret rejimi + okuma yetkisi → çizilir", () => {
    expect(showPurchaseOrderFields({ financeEnabled: true, canReadPurchaseOrders: true })).toBe(true);
  });

  it("ikisi de yoksa çizilmez", () => {
    expect(showPurchaseOrderFields({ financeEnabled: false, canReadPurchaseOrders: false })).toBe(false);
  });
});

describe("fillLinesFromOrder", () => {
  it("⭐ KUMAŞTA metraj BOŞ kalır (metre TOP BAŞINA, sipariş kalanı TOPLAM)", () => {
    const r = fillLinesFromOrder([{ item: kumas, remainingQty: 500, unitPrice: 42.5 }]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.itemId).toBe("item-kumas");
    expect(r.lines[0]!.initialQty).toBe(0);
    expect(r.lines[0]!.count).toBe(1);
    // Bekleyen miktar kaybolmaz — ekranda referans olarak gösterilsin diye döner.
    expect(r.blank).toEqual([{ name: "PATOS GRİ", remaining: 500, unit: "MT" }]);
    expect(r.prefilled).toEqual([]);
  });

  it("⭐ İPLİKTE miktar ön doldurulur (kalem = tek kg hareketi, 'top başına' yok)", () => {
    const r = fillLinesFromOrder([{ item: iplik, remainingQty: "250.5", unitPrice: null }]);
    expect(r.lines[0]!.initialQty).toBe(250.5);
    expect(r.lines[0]!.count).toBe(1);
    expect(r.prefilled).toEqual(["30/1 PENYE"]);
    expect(r.blank).toEqual([]);
  });

  it("anlaşılan fiyat taşınır; fiyatsız kalem 0'a düşmez (null kalır)", () => {
    const r = fillLinesFromOrder([
      { item: kumas, remainingQty: 100, unitPrice: "42.5" },
      { item: iplik, remainingQty: 10, unitPrice: null },
    ]);
    expect(r.lines[0]!.unitPrice).toBe(42.5);
    // "fiyat bilinmiyor" ile "bedava" aynı şey değildir.
    expect(r.lines[1]!.unitPrice).toBeNull();
  });

  it("karşılanmış kalem satır üretmez", () => {
    const r = fillLinesFromOrder([
      { item: kumas, remainingQty: 0, unitPrice: null },
      { item: iplik, remainingQty: -5, unitPrice: null },
    ]);
    expect(r.lines).toEqual([]);
  });

  it("her satır KENDİ anahtarını taşır (React key çakışması / kopya satır yok)", () => {
    const r = fillLinesFromOrder([
      { item: kumas, remainingQty: 100, unitPrice: null },
      { item: iplik, remainingQty: 100, unitPrice: null },
    ]);
    expect(r.lines[0]!.key).not.toBe(r.lines[1]!.key);
  });
});

describe("describeFill", () => {
  it("⭐ metrajın NEDEN boş kaldığı cümlede yazar (sessiz başarı yok)", () => {
    const text = describeFill(fillLinesFromOrder([{ item: kumas, remainingQty: 500, unitPrice: null }]));
    expect(text).toContain("TOP BAŞINA");
  });

  it("bekleyen kalem yoksa bunu açıkça söyler", () => {
    expect(describeFill(fillLinesFromOrder([]))).toContain("bekleyen kalem kalmamış");
  });

  it("iplik ve kumaş bir arada: ikisi de anlatılır", () => {
    const text = describeFill(
      fillLinesFromOrder([
        { item: kumas, remainingQty: 100, unitPrice: null },
        { item: iplik, remainingQty: 50, unitPrice: null },
      ]),
    );
    expect(text).toContain("2 satır eklendi");
    expect(text).toContain("iplik");
    expect(text).toContain("kumaş");
  });
});
