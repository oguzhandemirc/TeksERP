// =============================================================================
// BEKÇİ — İş emri listesi "Müşteri" hücresi: 0 / 1 / 2+ üç hâl + önizleme taşması + export metni
// =============================================================================
import { describe, it, expect } from "vitest";
import { customerCellView } from "./customer-cell";
import { workOrderColumns } from "./columns";
import type { WorkOrder } from "./types";

const c = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Firma ${String.fromCharCode(65 + i)}` }));

describe("İş emri listesi — Müşteri hücresi", () => {
  it("0 müşteri (bağsız/stok iş emri) → tire; export boş", () => {
    expect(customerCellView({ customers: [], customerCount: 0 })).toEqual({ first: null, extra: 0, all: "" });
    expect(customerCellView({})).toEqual({ first: null, extra: 0, all: "" });
  });

  it("1 müşteri → ad, rozet yok", () => {
    expect(customerCellView({ customers: c(1), customerCount: 1 })).toEqual({ first: "Firma A", extra: 0, all: "Firma A" });
  });

  it("⭐ 2+ müşteri → ilk ad + N-1 rozeti; tooltip hepsi", () => {
    expect(customerCellView({ customers: c(3), customerCount: 3 })).toEqual({ first: "Firma A", extra: 2, all: "Firma A, Firma B, Firma C" });
  });

  it("⭐ önizleme (5) toplamı (8) kapsamıyor → rozet TOPLAMDAN, tooltip '… (+3)'", () => {
    const v = customerCellView({ customers: c(5), customerCount: 8 });
    expect(v.extra).toBe(7);
    expect(v.all).toBe("Firma A, Firma B, Firma C, Firma D, Firma E … (+3)");
  });

  it("kolon kataloğunda `customer` var, etiketi Müşteri, export'u tooltip metni", () => {
    const col = workOrderColumns.find((x) => x.id === "customer");
    expect(col?.meta?.label).toBe("Müşteri");
    const exportValue = col?.meta?.exportValue as ((wo: WorkOrder) => unknown) | undefined;
    expect(exportValue?.({ customers: c(2), customerCount: 2 } as unknown as WorkOrder)).toBe("Firma A, Firma B");
  });
});
