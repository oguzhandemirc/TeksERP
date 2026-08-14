// =============================================================================
// BEKÇİ — Kalem fiyatı türetme katmanı
// =============================================================================
// ⭐ ASIL İDDİA: "kart varsayılanı" ile "müşteri istisnası" ekranda ASLA aynı
// kutuya düşmez, ve "fiyat girilmemiş" ASLA sıfıra çökmez. İkisi de sessiz
// bozulabilecek kurallardır: karışırlarsa hata çıkmaz, yalnız kullanıcı hangi
// fiyatın geçerli olduğunu bilemez; sıfıra çökerse fatura bedavaya onaylanır.
// =============================================================================
import { describe, it, expect } from "vitest";
import {
  baseFor,
  buildDefaultCells,
  buildExceptionViews,
  currenciesInPlay,
  customerLabelOf,
  deltaPercent,
  describeRemoval,
  findExisting,
  isDefaultRow,
  splitRows,
} from "./prices";
import type { ItemPriceRow } from "./service";

function row(over: Partial<ItemPriceRow> & { id: string }): ItemPriceRow {
  return {
    itemId: "item-1",
    customerId: null,
    kind: "SALE",
    currency: "TRY",
    // Decimal kolonları JSON'a STRING düşer — fixture bilerek string kullanır.
    price: "42",
    createdAt: "2026-08-14T08:00:00.000Z",
    updatedAt: "2026-08-14T08:00:00.000Z",
    ...over,
  } as ItemPriceRow;
}

const DEFAULT_SALE = row({ id: "d1", customerId: null, kind: "SALE", price: "42" });
const DEFAULT_BUY = row({ id: "d2", customerId: null, kind: "PURCHASE", price: "30" });
const EXC_PATOS = row({
  id: "e1",
  customerId: "cust-1",
  kind: "SALE",
  price: "45",
  customer: { id: "cust-1", code: "PATOS", name: "Patos Tekstil" },
});
const EXC_USD = row({
  id: "e2",
  customerId: "cust-2",
  kind: "SALE",
  currency: "USD",
  price: "1.5",
  customer: { id: "cust-2", code: "MAVI", name: "Mavi Kumaş" },
});

describe("varsayılan ↔ istisna ayrımı", () => {
  it("⭐ customerId = null VARSAYILANDIR (müşterisi silinmiş satır değil)", () => {
    expect(isDefaultRow(DEFAULT_SALE)).toBe(true);
    expect(isDefaultRow(EXC_PATOS)).toBe(false);
  });

  it("⭐ iki küme AYRI listelenir — hiçbir satır iki kümede birden görünmez", () => {
    const { defaults, exceptions } = splitRows([DEFAULT_SALE, DEFAULT_BUY, EXC_PATOS]);
    expect(defaults.map((r) => r.id)).toEqual(["d1", "d2"]);
    expect(exceptions.map((r) => r.id)).toEqual(["e1"]);
  });

  it("varsayılan satırın etiketi müşteri adı gibi okunmaz", () => {
    expect(customerLabelOf(DEFAULT_SALE)).toBe("Kart varsayılanı");
    expect(customerLabelOf(EXC_PATOS)).toBe("PATOS — Patos Tekstil");
  });
});

describe("varsayılan matrisi", () => {
  it("⭐ TANIMSIZ kombinasyon için BOŞ hücre üretir (eksiklik ekrandan silinmez)", () => {
    const cells = buildDefaultCells([DEFAULT_SALE]);
    const sale = cells.find((c) => c.kind === "SALE" && c.currency === "TRY");
    const purchase = cells.find((c) => c.kind === "PURCHASE" && c.currency === "TRY");
    expect(sale?.row?.id).toBe("d1");
    // Hücre VAR ama satırı YOK: ekran "Fiyat girilmemiş" basar, 0,00 değil.
    expect(purchase).toBeDefined();
    expect(purchase?.row).toBeNull();
  });

  it("TRY her zaman listede — hiç satır olmasa bile", () => {
    expect(currenciesInPlay([])).toEqual(["TRY"]);
    expect(buildDefaultCells([])).toHaveLength(2);
  });

  it("⭐ yalnız İSTİSNADA geçen para birimi de listeye girer (yalnız kalan istisna olmaz)", () => {
    expect(currenciesInPlay([EXC_USD])).toEqual(["TRY", "USD"]);
    const usdDefault = buildDefaultCells([EXC_USD]).find(
      (c) => c.currency === "USD" && c.kind === "SALE",
    );
    expect(usdDefault?.row).toBeNull();
  });

  it("aynı kutuya ikinci yazım tespit edilir (üzerine yazılacak uyarısı)", () => {
    const rows = [DEFAULT_SALE, EXC_PATOS];
    expect(findExisting(rows, { customerId: null, kind: "SALE", currency: "TRY" })?.id).toBe("d1");
    expect(findExisting(rows, { customerId: "cust-1", kind: "SALE", currency: "TRY" })?.id).toBe("e1");
    expect(findExisting(rows, { customerId: "cust-9", kind: "SALE", currency: "TRY" })).toBeUndefined();
  });
});

describe("istisna ↔ varsayılan karşılaştırması", () => {
  it("taban AYNI yön + AYNI para biriminden seçilir", () => {
    const rows = [DEFAULT_SALE, DEFAULT_BUY, EXC_PATOS, EXC_USD];
    expect(baseFor(rows, EXC_PATOS)?.id).toBe("d1");
    // USD istisnasının TRY varsayılanıyla karşılaştırılması ANLAMSIZ olurdu.
    expect(baseFor(rows, EXC_USD)).toBeNull();
  });

  it("yüzde fark hesaplanır", () => {
    expect(deltaPercent("45", "42")).toBeCloseTo(7.142, 2);
    expect(deltaPercent("40", "50")).toBeCloseTo(-20, 5);
  });

  it("⭐ taban YOK ya da SIFIR ise oran uydurulmaz (null)", () => {
    expect(deltaPercent("45", null)).toBeNull();
    expect(deltaPercent("45", "0")).toBeNull();
  });

  it("istisna listesi müşteri adına göre sıralı gelir", () => {
    const views = buildExceptionViews([DEFAULT_SALE, EXC_USD, EXC_PATOS]);
    expect(views.map((v) => v.row.id)).toEqual(["e2", "e1"]);
    expect(views[0]?.base).toBeNull();
    expect(views[1]?.base?.id).toBe("d1");
  });
});

describe("silme onayı — somut ve sonucu söyleyen", () => {
  it("⭐ VARSAYILAN silinince 'boş kalır' der, 'sıfır olur' DEMEZ", () => {
    const text = describeRemoval(DEFAULT_SALE, [DEFAULT_SALE, EXC_PATOS], "STK-1 — Poplin");
    expect(text).toContain("VARSAYILAN");
    expect(text).toContain("BOŞ gelir");
    expect(text).toContain("girilmemiş");
    // Etkilenmeyen istisna SAYIYLA söylenir — kullanıcı yan etkiyi bilmeli.
    expect(text).toContain("1 müşteri istisnası ETKİLENMEZ");
    expect(text).toContain("dondurduğu için etkilenmez");
  });

  it("⭐ İSTİSNA silinince müşterinin varsayılana DÖNECEĞİ tutarla yazılır", () => {
    const text = describeRemoval(EXC_PATOS, [DEFAULT_SALE, EXC_PATOS], "STK-1 — Poplin");
    expect(text).toContain("İSTİSNASI");
    expect(text).toContain("kart varsayılanını");
    expect(text).toContain("PATOS — Patos Tekstil");
  });

  it("⭐ varsayılan YOKKEN istisna silinirse 'boş kalacak' uyarısı verilir", () => {
    const text = describeRemoval(EXC_USD, [EXC_USD], "STK-1 — Poplin");
    expect(text).toContain("kart varsayılanı YOK");
    expect(text).toContain("BOŞ gelir");
  });
});
