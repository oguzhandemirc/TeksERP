// =============================================================================
// BEKÇİ — tahsilat/ödeme süzgeci (B4)
// =============================================================================
// ⭐ BOŞ DEĞER GÖNDERİLMEZ: sunucunun falsy elemesine güvenmek, sözleşmeyi
//    başkasının iç `if`ine emanet etmektir.
// ⭐ BOZUK TARİH BİR GÜNE ÇEVRİLMEZ: eski `Cheques/dates` hatası **1 Ocak 1900**
//    üretiyordu ve liste sessizce boşalıyordu.
// ⭐ GÜN SINIRI: başlangıç yerel 00:00, bitiş yerel 23:59:59.999 — bitişi
//    00:00'a bağlamak, seçilen günün TAMAMINI listeden düşürürdü.
// =============================================================================
import { describe, it, expect } from "vitest";
import {
  EMPTY_PAYMENT_FILTERS,
  buildPaymentListQuery,
  isPaymentFilterDirty,
  paymentFilterKey,
} from "./paymentFilters";

describe("buildPaymentListQuery", () => {
  it("⭐ hiçbir filtre yokken TEK parametre üretilmez (bugünkü istek korunur)", () => {
    const q = buildPaymentListQuery(EMPTY_PAYMENT_FILTERS);
    expect(Object.values(q).every((v) => v === undefined)).toBe(true);
  });

  it("seçilen değerler gönderilir", () => {
    const q = buildPaymentListQuery({
      ...EMPTY_PAYMENT_FILTERS,
      direction: "IN",
      status: "CANCELLED",
      method: "CASH",
      cariId: "cari-1",
      search: "MKB",
    });
    expect(q).toMatchObject({
      direction: "IN",
      status: "CANCELLED",
      method: "CASH",
      cariId: "cari-1",
      search: "MKB",
    });
  });

  it("⭐ yalnız boşluk içeren arama GÖNDERİLMEZ", () => {
    expect(buildPaymentListQuery({ ...EMPTY_PAYMENT_FILTERS, search: "   " }).search).toBeUndefined();
  });

  it("⭐ tarih aralığı yerel gün sınırlarına kurulur (başlangıç 00:00, bitiş 23:59:59.999)", () => {
    const q = buildPaymentListQuery({ ...EMPTY_PAYMENT_FILTERS, from: "2026-08-01", to: "2026-08-15" });
    const from = new Date(q.from as string);
    const to = new Date(q.to as string);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(from.getDate()).toBe(1);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(to.getDate()).toBe(15);
  });

  it("⭐ BOZUK/BOŞ tarih `undefined` döner — 1900'e düşmez", () => {
    const q = buildPaymentListQuery({ ...EMPTY_PAYMENT_FILTERS, from: "", to: "31-08-2026" });
    expect(q.from).toBeUndefined();
    expect(q.to).toBeUndefined();
  });
});

describe("isPaymentFilterDirty", () => {
  it("boş durumda temizle düğmesi çıkmaz", () => {
    expect(isPaymentFilterDirty(EMPTY_PAYMENT_FILTERS)).toBe(false);
  });

  it("her alan tek başına 'kirli' sayılır", () => {
    const dirty = [
      { direction: "OUT" },
      { status: "ACTIVE" },
      { method: "OTHER" },
      { cariId: "c1" },
      { search: "x" },
      { from: "2026-08-01" },
      { to: "2026-08-01" },
    ];
    for (const patch of dirty) {
      expect(isPaymentFilterDirty({ ...EMPTY_PAYMENT_FILTERS, ...patch })).toBe(true);
    }
  });
});

describe("paymentFilterKey", () => {
  it("⭐ anahtar SORGUDAN türetilir — '  ' ile '' aynı önbellek girdisi", () => {
    expect(paymentFilterKey({ ...EMPTY_PAYMENT_FILTERS, search: "   " })).toBe(
      paymentFilterKey(EMPTY_PAYMENT_FILTERS),
    );
  });

  it("farklı süzgeç farklı anahtar üretir (liste bayat kalmasın)", () => {
    expect(paymentFilterKey({ ...EMPTY_PAYMENT_FILTERS, direction: "IN" })).not.toBe(
      paymentFilterKey({ ...EMPTY_PAYMENT_FILTERS, direction: "OUT" }),
    );
  });
});
