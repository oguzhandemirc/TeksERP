// =============================================================================
// BEKÇİ — İKİNCİ AKTİF DEPO UYARISI
// =============================================================================
// ⭐ ASIL İDDİA: modül KAPALIYKEN ikinci aktif depo açan kullanıcı uyarılır,
// AÇIKKEN uyarılmaz ve mevcut deposunu düzenleyen kimse yanlış yere uyarılmaz.
// Kural bir bileşen içindeki `&&` zincirinde bırakılsaydı tersine çevrilmesi
// hiçbir testi kırmazdı.
// =============================================================================
import { describe, expect, it } from "vitest";
import { shouldWarnMultiWarehouseClosed } from "./multiWarehouseWarning";

const base = {
  depoMultiEnabled: false,
  activeWarehouseIds: ["w1"],
  editingId: null as string | null,
  willBeActive: true,
};

describe("ikinci aktif depo uyarısı", () => {
  it("⭐ modül KAPALI + zaten bir aktif depo var + yeni kayıt → UYAR", () => {
    expect(shouldWarnMultiWarehouseClosed(base)).toBe(true);
  });

  it("modül AÇIKSA uyarı yok (beklenen davranış zaten gelecek)", () => {
    expect(shouldWarnMultiWarehouseClosed({ ...base, depoMultiEnabled: true })).toBe(false);
  });

  it("İLK depo açılırken uyarı yok (ikinci depo yok ki)", () => {
    expect(shouldWarnMultiWarehouseClosed({ ...base, activeWarehouseIds: [] })).toBe(false);
  });

  it("⭐ SAYIM KENDİNİ DIŞLAR: tek depolu kurulumda o depoyu düzenlemek uyarmaz", () => {
    expect(
      shouldWarnMultiWarehouseClosed({ ...base, activeWarehouseIds: ["w1"], editingId: "w1" }),
    ).toBe(false);
  });

  it("iki aktif depodan birini düzenlemek yine uyarır (diğeri duruyor)", () => {
    expect(
      shouldWarnMultiWarehouseClosed({
        ...base,
        activeWarehouseIds: ["w1", "w2"],
        editingId: "w1",
      }),
    ).toBe(true);
  });

  it("PASİFE alınan depo uyarı üretmez (aktif sayısı artmıyor)", () => {
    expect(shouldWarnMultiWarehouseClosed({ ...base, willBeActive: false })).toBe(false);
  });
});
