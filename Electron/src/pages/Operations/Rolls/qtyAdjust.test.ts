// =============================================================================
// BEKÇİ — Sayım metraj düzeltmesi görünürlüğü (G4)
// =============================================================================
// ⭐ ASIL İDDİA: bu yüzey FABRİKADA HİÇ ÇIKMAZ. Ticaret paketinin değişmez
// kuralı "fabrika sıfır-fark"tır — `financeEnabled` koşulu bir gün "zaten
// faydalı, herkese açalım" diye düşerse fabrikanın envanter ekranında,
// istasyon akışını (kurşun/tambur ölçümü) atlayan bir metraj kapısı sessizce
// belirir. Fabrikada metraj istasyonun işidir; ticarette sayım gerçeğidir.
// (`quickShip.test.ts` emsali.)
// =============================================================================
import { describe, it, expect } from "vitest";
import { canAdjustRollQty, QTY_ADJUST_STATUSES } from "./qtyAdjustService";

const ALL_STATUSES = [
  "STOCK",
  "IN_PRODUCTION",
  "WAREHOUSE",
  "A1_STOCK",
  "SHIPPED",
  "SCRAP",
  "CANCELLED",
  "AT_SUBCONTRACTOR",
  "RETURNED_FROM_SUBCONTRACTOR",
  "SUBCONTRACTOR_CONSUMED",
  "TAMBUR_CONSUMED",
  "AT_KARTELA",
  "KARTELA_CONSUMED",
];

const free = (status: string) => ({ status, sackId: null, shipmentId: null, currentStep: null });

describe("Metraj Düzelt görünürlüğü", () => {
  it("⭐ FABRİKADA (finance kapalı) HİÇBİR statüde çıkmaz", () => {
    const gorunen = ALL_STATUSES.filter((s) => canAdjustRollQty(free(s), false));
    expect(gorunen).toEqual([]);
  });

  it("ticaret rejiminde YALNIZ serbest stok statülerinde çıkar", () => {
    const gorunen = ALL_STATUSES.filter((s) => canAdjustRollQty(free(s), true));
    expect(gorunen).toEqual([...QTY_ADJUST_STATUSES]);
  });

  it("çuvaldaki / sevkteki / adıma bağlı top çıkmaz (backend kapsamının aynası)", () => {
    // Aynası olmasaydı menü, sürekli 409 üreten ölü bir yol vaat ederdi.
    expect(canAdjustRollQty({ ...free("WAREHOUSE"), sackId: "cv-1" }, true)).toBe(false);
    expect(canAdjustRollQty({ ...free("WAREHOUSE"), shipmentId: "svk-1" }, true)).toBe(false);
    expect(canAdjustRollQty({ ...free("STOCK"), currentStep: { id: "adim-1" } }, true)).toBe(false);
  });

  it("liste satırı ilişkileri taşımıyorsa (undefined) serbest sayılır — backend yine guard'lar", () => {
    expect(canAdjustRollQty({ status: "WAREHOUSE" }, true)).toBe(true);
  });
});
