// K4P-TANIM: hata tipi 4 puan alanları modül bayrağına bağlı. Kapalıyken kolon/alan/payload anahtarı YOK
// (eski panel davranışı); açıkken sabit puan + sıra kolonu, sıralama yalnız değişen satırları yazar.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const flags = vi.hoisted(() => ({ kg: false }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useKaliteGuvenceEnabled: () => flags.kg }));
vi.mock("@/components/layout/CrudPage", () => ({
  CrudPage: ({ columns, headerExtra }: { columns: Array<{ id?: string; accessorKey?: string }>; headerExtra?: React.ReactNode }) => (
    <div><ul>{columns.map((c) => <li key={c.id ?? c.accessorKey}>{c.id ?? c.accessorKey}</li>)}</ul>{headerExtra}</div>
  ),
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./DefectTypeSortDialog", () => ({ DefectTypeSortDialog: () => null }));

import { DefectTypesPage, buildPayload } from "./DefectTypesPage";
import { defectTypeFormDefaults } from "./schema";
import { orderDefectTypes, sortOrderChanges } from "./defectSort";
import type { DefectType } from "./types";

const dt = (id: string, name: string, sortOrder: number): DefectType =>
  ({ id, code: id, name, description: null, severity: null, defectGroup: null, isActive: true, isDefault: false, sortOrder, createdAt: "", updatedAt: "" });

describe("DefectTypes — 4 puan kolonları modül bayrağıyla", () => {
  it("modül kapalı: sabit puan/sıra kolonu ve 'Tablet sırası' düğmesi YOK", () => {
    flags.kg = false;
    renderWithProviders(<DefectTypesPage />);
    expect(screen.queryByText("fixedPoints")).toBeNull();
    expect(screen.queryByText("sortOrder")).toBeNull();
    expect(screen.queryByRole("button", { name: /Tablet sırası/ })).toBeNull();
  });
  it("modül açık: iki kolon açıklamadan önce eklenir + sıralama düğmesi", () => {
    flags.kg = true;
    renderWithProviders(<DefectTypesPage />);
    const keys = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(keys.indexOf("fixedPoints")).toBeLessThan(keys.indexOf("description"));
    expect(keys).toContain("sortOrder");
    expect(screen.getByRole("button", { name: /Tablet sırası/ })).toBeInTheDocument();
  });
  it("payload: modül kapalıyken fixedPoints anahtarı gitmez; açıkken '' → null, '3' → 3", () => {
    const v = { ...defectTypeFormDefaults, name: "Delik", fixedPoints: "3" as const };
    expect("fixedPoints" in buildPayload(v, null, false)).toBe(false);
    expect(buildPayload(v, null, true).fixedPoints).toBe(3);
    expect(buildPayload({ ...v, fixedPoints: "" }, null, true).fixedPoints).toBeNull();
  });
});

describe("defectSort", () => {
  it("sıra küçük önce, eşitlikte ada göre; yalnız değişen satırlar yazılır", () => {
    const rows = orderDefectTypes([dt("b", "Boncuk", 10), dt("a", "Atkı kaçığı", 0), dt("c", "Çözgü", 10)]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(sortOrderChanges(rows)).toEqual([{ id: "c", sortOrder: 20 }]);
    expect(sortOrderChanges([rows[2]!, rows[0]!, rows[1]!])).toEqual([{ id: "c", sortOrder: 0 }, { id: "a", sortOrder: 10 }, { id: "b", sortOrder: 20 }]);
  });
});
