// BEKÇİ — Ürünler listesi: iplik/sarf satırında renk/özellik hücresi BOŞ (yalnız kumaş liste taşır, 2026-09-17).
import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import type { CellContext } from "@tanstack/react-table";
import { itemColumns } from "./columns";
import type { Item } from "./types";

const cell = (id: string, original: Partial<Item>) => {
  const col = itemColumns.find((c) => c.id === id)!;
  const ctx = { row: { original } } as unknown as CellContext<Item, unknown>;
  return render(<>{(col.cell as (c: CellContext<Item, unknown>) => ReactNode)(ctx)}</>).container.textContent;
};

describe("itemColumns — renk/özellik hücresi", () => {
  it("⭐ kumaş: boş liste 'Tümü', dolu liste adları", () => {
    expect(cell("allowedColors", { itemType: "FABRIC", allowedColors: [] })).toBe("Tümü");
    expect(cell("allowedColors", { itemType: "FABRIC", allowedColors: [{ colorId: "c1", color: { id: "c1", code: "K", name: "Krem", hex: null } }] })).toContain("Krem");
    expect(cell("allowedProperties", { itemType: "FABRIC", allowedProperties: [] })).toBe("Tümü");
  });

  it("⭐ iplik/sarf: hücre BOŞ (—) — eski kartta liste kalmış olsa bile", () => {
    for (const itemType of ["YARN", "CONSUMABLE"] as const) {
      expect(cell("allowedColors", { itemType, allowedColors: [{ colorId: "c1", color: { id: "c1", code: "K", name: "Krem", hex: null } }] })).toBe("—");
      expect(cell("allowedProperties", { itemType, allowedProperties: [] })).toBe("—");
    }
  });
});

describe("itemColumns — D3/K10 teknik sütunlar (Desen · Mamul en)", () => {
  const exportOf = (id: string, r: Partial<Item>) => {
    const col = itemColumns.find((c) => c.id === id)!;
    return (col.meta as { exportValue: (r: Item) => unknown }).exportValue(r as Item);
  };
  it("⭐ Desen: kod + mekanizma · örgü (ekran ve Excel aynı)", () => {
    const r = { weaveDesign: { id: "d1", code: "D-102", name: "Balık", shedMechanism: "DOBBY", weaveStructure: "LENO" } };
    expect(cell("weaveDesign", r)).toBe("D-102 · Armür · Döner");
    expect(exportOf("weaveDesign", r)).toBe("D-102 · Armür · Döner");
    // Eski kart (yalnız `kind`) aynı eşlemeyle türetilir.
    expect(cell("weaveDesign", { weaveDesign: { id: "d2", code: "J-1", name: "J", kind: "JACQUARD" } })).toBe("J-1 · Jakar");
  });
  it("desen yok / eski sunucu → '—', Excel boş", () => {
    expect(cell("weaveDesign", {})).toBe("—");
    expect(exportOf("weaveDesign", {})).toBe("");
  });
  it("⭐ Mamul en: Decimal metin biçimlenir; boşsa '—'", () => {
    expect(cell("widthCm", { widthCm: "280.50" })).toBe("280,5");
    expect(exportOf("widthCm", { widthCm: "280.50" })).toBe("280,5");
    expect(cell("widthCm", { widthCm: null })).toBe("—");
    expect(exportOf("widthCm", {})).toBe("");
  });
  it("kolon sırası: Kumaş türü · Desen · Mamul en birlikte (1440'ta görünür kalsın diye öne yakın)", () => {
    const ids = itemColumns.map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey);
    const i = ids.indexOf("fabricType");
    expect(ids.slice(i, i + 3)).toEqual(["fabricType", "weaveDesign", "widthCm"]);
  });
});
