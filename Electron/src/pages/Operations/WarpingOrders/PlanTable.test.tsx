// B6 — devere "İplik planı" tablosunda satır başına uygulanan fire yüzdesi + kaynak; iplik kartı firesi çözgü firesinin
// yerine geçtiğinde görünür not. Karar sunucuda (`resolveYarnWastePct`); tablo yalnız gösterir.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PlanTable, planColumns, planWasteCell, type PlanRow } from "./PlanTable";

const row = (p: Partial<PlanRow>): PlanRow => ({
  yarnItemId: "y", code: "C", name: "PES", sourceWarpSpecId: "s", endsCount: 3000, denier: "150", wastePct: "0.00", netKg: "50.000", grossKg: "50.000", ...p,
});
const A = row({ yarnItemId: "a", name: "PES 150", letter: "A", wastePct: "4.00", wasteSource: "IPLIK", specWastePct: "2.00", grossKg: "52.083" });
const B = row({ yarnItemId: "b", name: "PES 75", letter: "B", wastePct: "2.00", wasteSource: "KART", specWastePct: "2.00", grossKg: "51.020" });
const C = row({ yarnItemId: "c", name: "Lurex", letter: "C", wastePct: "0.00", wasteSource: "KART", specWastePct: null });

describe("İplik planı fire sütunu (B6)", () => {
  it("⭐ satır hücresi: yüzde · kaynak · iplik firesinde uygulanmayan çözgü firesi notu", () => {
    expect(planWasteCell(A)).toEqual({ pct: "%4", source: "iplik kartı", note: "Bu iplik için iplik kartındaki %4 kullanılıyor (çözgü firesi %2 uygulanmaz)." });
    expect(planWasteCell(B)).toEqual({ pct: "%2", source: "çözgü kartı", note: null });
    expect(planWasteCell(C)).toEqual({ pct: "—", source: null, note: null });
  });

  it("kayıtlı siparişte kaynak dışarıdan (önizleme) gelir", () => {
    const saved = row({ wastePct: "3.00" });
    expect(planWasteCell(saved, () => "açılıştaki değer").source).toBe("açılıştaki değer");
  });

  it("fire sütunu yalnız fire varken; tabloda not satırı görünür", () => {
    expect(planColumns({ hasWaste: false, yarns: [C] }).waste).toBe(false);
    render(<PlanTable yarns={[A, B, C]} hasWaste totals={{ netKg: "150.000", grossKg: "153.103" }} />);
    expect(screen.getByRole("columnheader", { name: "Fire" })).toBeTruthy();
    const rows = within(screen.getByRole("table", { name: "İplik planı" })).getAllByRole("row");
    expect(rows[1]!.textContent).toContain("%4iplik kartı");
    expect(rows[2]!.textContent).toContain("%2çözgü kartı");
    expect(screen.getAllByTestId("plan-waste-note").map((n) => n.textContent)).toEqual([
      "A · PES 150: Bu iplik için iplik kartındaki %4 kullanılıyor (çözgü firesi %2 uygulanmaz).",
    ]);
  });
});
