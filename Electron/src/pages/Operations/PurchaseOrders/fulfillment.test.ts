// =============================================================================
// BEKÇİ — karşılanma hesabı
// =============================================================================
// Dört iddia, dördü de sahada bir kez yanlış yapılmış olsa pahalıya patlar:
//  ⭐ FAZLA GELEN MAL EKSİ RAKAM ÜRETMEZ — "−5" bir hata koduna benzer; kural
//     "5 fazla geldi" cümlesidir.
//  ⭐ Decimal STRING gelir ("500") ve hesap yine doğru çalışır.
//  ⭐ Fazla gelende çubuk 100'ü AŞMAZ.
//  ⭐ Sipariş özeti kalem kalem toplanır — bir kalemdeki fazlalık, diğerindeki
//     eksiği MAHSUP ETMEZ.
// =============================================================================
import { describe, it, expect } from "vitest";
import { fulfillmentOf, orderProgress, remainingText } from "./fulfillment";

describe("fulfillmentOf", () => {
  it("hiç gelmemiş kalem: NONE, kalan = sipariş", () => {
    const f = fulfillmentOf({ qty: 500, receivedQty: 0 });
    expect(f.state).toBe("NONE");
    expect(f.remaining).toBe(500);
    expect(f.excess).toBe(0);
    expect(f.percent).toBe(0);
  });

  it("kısmen gelmiş kalem: PARTIAL + yüzde", () => {
    const f = fulfillmentOf({ qty: 500, receivedQty: 200 });
    expect(f.state).toBe("PARTIAL");
    expect(f.remaining).toBe(300);
    expect(f.percent).toBe(40);
  });

  it("tam karşılanmış kalem: COMPLETE, kalan 0", () => {
    const f = fulfillmentOf({ qty: 500, receivedQty: 500 });
    expect(f.state).toBe("COMPLETE");
    expect(f.remaining).toBe(0);
    expect(f.excess).toBe(0);
    expect(f.percent).toBe(100);
  });

  it("⭐ FAZLA GELEN: kalan EKSİYE düşmez, fazlalık ayrı alanda", () => {
    const f = fulfillmentOf({ qty: 500, receivedQty: 530 });
    expect(f.state).toBe("OVER");
    expect(f.remaining).toBe(0);
    expect(f.excess).toBe(30);
  });

  it("⭐ fazla gelende çubuk 100'de durur (taşmaz)", () => {
    expect(fulfillmentOf({ qty: 100, receivedQty: 400 }).percent).toBe(100);
  });

  it("⭐ Decimal STRING gelir ve hesap bozulmaz", () => {
    // Prisma `Decimal` JSON'a string düşer — arayüzler `number` diye tiplese de
    // çalışma zamanında gelen budur.
    const f = fulfillmentOf({ qty: "500", receivedQty: "200.5" });
    expect(f.ordered).toBe(500);
    expect(f.received).toBe(200.5);
    expect(f.remaining).toBe(299.5);
  });

  it("bozuk/eksik miktar NaN yüzde üretmez", () => {
    const f = fulfillmentOf({ qty: 0, receivedQty: 0 });
    expect(Number.isFinite(f.percent)).toBe(true);
    expect(f.percent).toBe(0);
  });
});

describe("remainingText", () => {
  it("⭐ fazlalık EKSİ İŞARETLE değil, cümleyle söylenir", () => {
    const text = remainingText(fulfillmentOf({ qty: 500, receivedQty: 505 }), "MT");
    expect(text).toBe("5 mt fazla geldi");
    expect(text).not.toContain("-");
    expect(text).not.toContain("−");
  });

  it("tamamlanan kalemde miktar tekrar edilmez", () => {
    expect(remainingText(fulfillmentOf({ qty: 500, receivedQty: 500 }))).toBe("Tamamlandı");
  });

  it("hiç gelmemiş ile kısmen gelmiş AYRI cümle kurar", () => {
    expect(remainingText(fulfillmentOf({ qty: 500, receivedQty: 0 }), "MT")).toBe("500 mt bekleniyor");
    expect(remainingText(fulfillmentOf({ qty: 500, receivedQty: 100 }), "MT")).toBe("400 mt kaldı");
  });

  it("birim verilmezse boşluk artığı bırakmaz", () => {
    expect(remainingText(fulfillmentOf({ qty: 10, receivedQty: 4 }))).toBe("6 kaldı");
  });
});

describe("orderProgress", () => {
  it("kalemleri ayrı ayrı sayar", () => {
    const p = orderProgress([
      { qty: 100, receivedQty: 0 }, // NONE
      { qty: 100, receivedQty: 50 }, // PARTIAL
      { qty: 100, receivedQty: 100 }, // COMPLETE
      { qty: 100, receivedQty: 120 }, // OVER
    ]);
    expect(p).toMatchObject({
      lineCount: 4,
      waitingLines: 1,
      partialLines: 1,
      completeLines: 1,
      overLines: 1,
      percent: 50, // tam + fazla = 2/4
    });
  });

  it("⭐ bir kalemdeki fazlalık, diğerindeki eksiği MAHSUP ETMEZ", () => {
    // Tek çıkarmayla (200 sipariş ↔ 200 gelen) bu sipariş "tamamlandı"
    // görünürdü; oysa bir kalem hiç gelmemiş, diğerine iki katı gelmiştir.
    const p = orderProgress([
      { qty: 100, receivedQty: 200 },
      { qty: 100, receivedQty: 0 },
    ]);
    expect(p.waitingLines).toBe(1);
    expect(p.overLines).toBe(1);
    expect(p.percent).toBe(50);
  });

  it("kalemsiz sipariş NaN üretmez", () => {
    expect(orderProgress([]).percent).toBe(0);
  });
});
