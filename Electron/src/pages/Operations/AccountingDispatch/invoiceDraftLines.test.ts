// =============================================================================
// BEKÇİ — sevkiyattan fatura taslağı satırları (C1 panel yarısı)
// =============================================================================
// ⭐ DECIMAL STRING → NUMBER dönüşümü: uç `qty: "500"` döndürür. String bir
//    miktar/fiyat forma girdiğinde hata ÇIKMAZ; yalnız biçimlendirme sessizce
//    bozulur ve tutar önizlemesi kullanıcının göreceği son savunma hattıdır.
// ⭐ ÇELİŞKİ CÜMLESİ: backend aynı ürüne farklı sipariş fiyatı düşerse ortalama
//    ALMAZ — kart fiyatına düşer ve sayacı doldurur. O sayaç ekranda basılmazsa
//    muhasebeci sözleşme fiyatı sandığı bir kart fiyatını onaylar.
// =============================================================================
import { describe, it, expect } from "vitest";
import { draftPriceNotice, toPrefillLines, type ShipmentDraftLinesDto } from "./invoiceDraftLines";

const DTO: ShipmentDraftLinesDto = {
  lines: [
    { itemId: "i1", description: "PATOS GRİ 280cm.", qty: "512.5", unit: "m", unitPrice: "42.50", vatRate: 20 },
    { itemId: "i2", description: "MAVİ", qty: 100, unit: "m", unitPrice: 0, vatRate: 20 },
  ],
  orderPriced: 1,
  orderConflicts: 0,
  currency: "TRY",
};

describe("toPrefillLines", () => {
  it("⭐ Decimal STRING alanlar sayıya çevrilir (biçimlendirme sessizce bozulmasın)", () => {
    const lines = toPrefillLines(DTO);
    expect(lines[0]?.qty).toBe(512.5);
    expect(lines[0]?.unitPrice).toBe(42.5);
    expect(typeof lines[0]?.qty).toBe("number");
    expect(typeof lines[0]?.unitPrice).toBe("number");
  });

  it("⭐ `itemId` TAŞINIR — fiyat önerisi ve açıklama ön-dolumu ona bağlı", () => {
    expect(toPrefillLines(DTO)[0]?.itemId).toBe("i1");
  });

  it("açıklama ve birim backend'den olduğu gibi gelir (defterin birimi 'm')", () => {
    const lines = toPrefillLines(DTO);
    expect(lines[0]?.description).toBe("PATOS GRİ 280cm.");
    expect(lines[0]?.unit).toBe("m");
  });

  it("fiyatı çözülemeyen satır 0 ile geçer — onay seddi zaten yakalar", () => {
    expect(toPrefillLines(DTO)[1]?.unitPrice).toBe(0);
  });

  it("bozuk sayı NaN yazmaz (form alanı sessizce ölmesin)", () => {
    const lines = toPrefillLines({
      ...DTO,
      lines: [{ itemId: "", description: "X", qty: "abc", unit: "m", unitPrice: null as never, vatRate: 20 }],
    });
    expect(lines[0]?.qty).toBe(0);
    expect(lines[0]?.unitPrice).toBe(0);
    expect(lines[0]?.itemId).toBeNull();
    expect(lines[0]?.unit).toBe("m");
  });

  it("⭐ birim OLDUĞU GİBİ geçer — 'kg' 'm'e çevrilmez, boş 'm' UYDURULMAZ (birim miktarın kaynağını izler)", () => {
    const lines = toPrefillLines({
      ...DTO,
      lines: [
        { itemId: "i1", description: "X", qty: 1, unit: "kg", unitPrice: 1, vatRate: 20 },
        { itemId: "i2", description: "Y", qty: 1, unit: "", unitPrice: 1, vatRate: 20 },
      ],
    });
    expect(lines[0]?.unit).toBe("kg");
    expect(lines[1]?.unit).toBe("");
  });

  it("yanıt yoksa boş dizi (diyalog satırsız açılmaz, çağıran bekler)", () => {
    expect(toPrefillLines(null)).toEqual([]);
    expect(toPrefillLines(undefined)).toEqual([]);
  });
});

describe("draftPriceNotice", () => {
  it("⭐ ÇELİŞKİ VARSA AMBER not basılır ve KONTROL istenir", () => {
    const n = draftPriceNotice({ ...DTO, orderConflicts: 2, orderPriced: 3 });
    expect(n?.tone).toBe("warn");
    expect(n?.message).toContain("2 kalemde");
    expect(n?.message).toMatch(/KART fiyatıyla/);
    expect(n?.message).toMatch(/kontrol edin/);
  });

  it("⭐ ÇELİŞKİ, bilgi notunu EZER (kontrol gerektiren cümle gömülmesin)", () => {
    const n = draftPriceNotice({ ...DTO, orderConflicts: 1, orderPriced: 9 });
    expect(n?.tone).toBe("warn");
  });

  it("çelişki yoksa ve sipariş fiyatı kullanıldıysa bilgi notu", () => {
    const n = draftPriceNotice({ ...DTO, orderConflicts: 0, orderPriced: 4 });
    expect(n?.tone).toBe("info");
    expect(n?.message).toContain("4 kalemin");
  });

  it("sipariş fiyatı hiç kullanılmadıysa cümle basılmaz (gürültü yok)", () => {
    expect(draftPriceNotice({ ...DTO, orderConflicts: 0, orderPriced: 0 })).toBeNull();
    expect(draftPriceNotice(null)).toBeNull();
  });
});
