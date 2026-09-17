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
